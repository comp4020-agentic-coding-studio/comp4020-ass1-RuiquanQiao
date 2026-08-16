// Rebuilds data/nobel.json from Wikidata. Run by hand, never by a build:
//
//   node refresh-nobel.ts
//
// The build must not touch the network. Wikidata's SPARQL endpoint rate-limits
// and occasionally 502s, and betting a deploy on someone else's query service
// is the same mistake as scraping a live site in CI. The snapshot carries its
// own fetch date and the page displays it.
//
// Every rule this script obeys is written down in CLAUDE.md under "Honesty
// rules", and spec/data.test.ts fails if the output breaks one of them. The
// contract was written before this script was.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ENDPOINT, LANGUAGES, chunk, qid, sleep, sparql } from "./wikidata.ts";

// Verified against Wikidata rather than assumed: physics 230, chemistry 198,
// medicine 233, economics 99 award statements at time of writing.
const PRIZES: Record<string, string> = {
  Q38104: "physics",
  Q44585: "chemistry",
  Q80061: "medicine",
  Q47170: "economics",
};

// Kinship properties, and the direction each one is stored in. parent/child are
// the same fact twice, so P40 (child) is inverted into a parent edge and P25
// (mother) and P22 (father) both become parent edges. spouse and sibling are
// symmetric and stored once.
const KIN: Record<string, { kind: "parent" | "spouse" | "sibling"; invert: boolean }> = {
  P22: { kind: "parent", invert: false }, // father: subject's parent is the value
  P25: { kind: "parent", invert: false }, // mother
  P40: { kind: "parent", invert: true }, // child: subject is the parent
  P26: { kind: "spouse", invert: false },
  P3373: { kind: "sibling", invert: false },
};

// Ancestors only. Walking upward through advisors is what reproduces the
// genealogy; walking downward through students would pull in most of academia
// and drown the finding in people who are on the page for no reason.
//
// This was 15 and 15 was binding, not slack: the log still showed +9 ancestors
// arriving in the last generation, so the chain was being cut mid-lineage and
// the page would have understated its own connectivity while looking finished.
// The frontier shrinks fast, so the extra generations are cheap.
const MAX_GENERATIONS = 60;
const BATCH = 150;

// Wikidata models "there is an advisor but we do not know who" as a blank node,
// which comes back as a bare hash instead of a QID. The first pull happily
// admitted one as a person: it would have drawn a dot whose name was
// f28801020c4cd14710f9c0193b259ec0. It is not a person, it is the absence of
// one, and the honesty rules say absent means absent.
const isPerson = (id: string) => /^Q\d+$/.test(id);

// Every entity admitted here must be `instance of: human`.
//
// Wikidata's "award received" does not imply a person, and the first pull
// proved it: it admitted Q629583 -- Sheldon Cooper, a television character who
// wins the Nobel Prize in physics on the show -- and Q56509417, which is a
// *family*, not a member of one. Both would have been drawn as laureates.
// Of 1686 entities in that pull, exactly 2 lacked P31=Q5 and both were these,
// so the filter costs nothing real and catches the thing that matters.
const HUMAN = "?person wdt:P31 wd:Q5 .";

interface Prize {
  category: string;
  year: number | null;
}

interface Person {
  id: string;
  name: string;
  laureate: boolean;
  prizes: Prize[];
}

interface Edge {
  from: string;
  to: string;
  type: "supervised" | "kin";
  kin: "parent" | "spouse" | "sibling" | null;
  provenance: "official" | "wikidata-sourced" | "wikidata-unsourced";
  references: number;
  source: string;
}

const people = new Map<string, Person>();
const edges = new Map<string, Edge>();

function remember(id: string, name: string): Person {
  const existing = people.get(id);
  if (existing) {
    // A label can arrive twice; prefer a real name over a bare QID fallback.
    if (existing.name.startsWith("Q") && !name.startsWith("Q")) existing.name = name;
    return existing;
  }
  const person: Person = { id, name, laureate: false, prizes: [] };
  people.set(id, person);
  return person;
}

function connect(edge: Edge): void {
  const forward = `${edge.type}:${edge.kin}:${edge.from}:${edge.to}`;
  const symmetric = edge.kin === "spouse" || edge.kin === "sibling";
  const mirror = `${edge.type}:${edge.kin}:${edge.to}:${edge.from}`;
  if (edges.has(forward)) return;
  if (symmetric && edges.has(mirror)) return;
  edges.set(forward, edge);
}

// Wikidata's P184 is uneven: many advisor claims carry zero references and in
// the raw response look identical to sourced ones. The reference count is the
// only thing that separates them, so it is recorded rather than thrown away.
// "official" is deliberately never assigned here -- it means a nobelprize.org
// page was read, and this script has not read one.
function provenanceOf(references: number): Edge["provenance"] {
  return references > 0 ? "wikidata-sourced" : "wikidata-unsourced";
}

const wikidataUrl = (id: string) => `https://www.wikidata.org/wiki/${id}`;

async function loadLaureates(): Promise<void> {
  const values = Object.keys(PRIZES)
    .map((id) => `wd:${id}`)
    .join(" ");
  const rows = await sparql(`
    SELECT ?person ?personLabel ?prize ?when WHERE {
      VALUES ?prize { ${values} }
      ?person p:P166 ?award .
      ?award ps:P166 ?prize .
      ${HUMAN}
      OPTIONAL { ?award pq:P585 ?when . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGUAGES}". }
    }
  `);

  for (const row of rows) {
    const id = qid(row.person!.value);
    const person = remember(id, row.personLabel?.value ?? id);
    person.laureate = true;
    const category = PRIZES[qid(row.prize!.value)]!;
    // No date qualifier means Wikidata does not record when. `null` says that;
    // a `0` would be a number that looks like data and renders as "physics 0".
    const year = row.when ? Number(row.when.value.slice(0, 4)) : null;
    if (!person.prizes.some((prize) => prize.category === category && prize.year === year)) {
      person.prizes.push({ category, year });
    }
  }
  console.log(`laureates: ${people.size}`);
}

async function loadAncestors(): Promise<void> {
  let frontier = [...people.keys()];
  for (let generation = 1; generation <= MAX_GENERATIONS && frontier.length; generation += 1) {
    const found: string[] = [];
    for (const batch of chunk(frontier, BATCH)) {
      const values = batch.map((id) => `wd:${id}`).join(" ");
      const rows = await sparql(`
        SELECT ?student ?advisor ?advisorLabel (COUNT(?ref) AS ?refs) WHERE {
          VALUES ?student { ${values} }
          ?student p:P184 ?statement .
          ?statement ps:P184 ?advisor .
          ?advisor wdt:P31 wd:Q5 .
          OPTIONAL { ?statement prov:wasDerivedFrom ?ref . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGUAGES}". }
        } GROUP BY ?student ?advisor ?advisorLabel
      `);

      for (const row of rows) {
        const student = qid(row.student!.value);
        const advisor = qid(row.advisor!.value);
        if (student === advisor) continue; // a self-edge is a data error, not a fact
        if (!isPerson(advisor) || !isPerson(student)) continue;
        if (!people.has(advisor)) found.push(advisor);
        remember(advisor, row.advisorLabel?.value ?? advisor);
        const references = Number(row.refs?.value ?? 0);
        connect({
          from: advisor,
          to: student,
          type: "supervised",
          kin: null,
          provenance: provenanceOf(references),
          references,
          source: wikidataUrl(student),
        });
      }
      await sleep(400); // be a good citizen of someone else's free endpoint
    }
    console.log(`  generation ${generation}: +${found.length} ancestors (${people.size} people)`);
    frontier = found;
  }
}

async function loadKinship(): Promise<void> {
  const ids = [...people.keys()];
  for (const [property, { kind, invert }] of Object.entries(KIN)) {
    let added = 0;
    for (const batch of chunk(ids, BATCH)) {
      const values = batch.map((id) => `wd:${id}`).join(" ");
      const rows = await sparql(`
        SELECT ?subject ?other (COUNT(?ref) AS ?refs) WHERE {
          VALUES ?subject { ${values} }
          ?subject p:${property} ?statement .
          ?statement ps:${property} ?other .
          OPTIONAL { ?statement prov:wasDerivedFrom ?ref . }
        } GROUP BY ?subject ?other
      `);

      for (const row of rows) {
        const subject = qid(row.subject!.value);
        const other = qid(row.other!.value);
        // Kinship only counts when both ends are already in the graph. A
        // laureate's non-academic relatives are real people but they are not
        // part of this question, and pulling them in would pad the graph with
        // nodes that can never light anything up.
        if (subject === other || !people.has(other)) continue;
        if (!isPerson(subject) || !isPerson(other)) continue;
        const references = Number(row.refs?.value ?? 0);
        connect({
          from: invert ? subject : other,
          to: invert ? other : subject,
          type: "kin",
          kin: kind,
          provenance: provenanceOf(references),
          references,
          source: wikidataUrl(subject),
        });
        added += 1;
      }
      await sleep(400);
    }
    console.log(`  ${property} (${kind}): ${added} claims`);
  }
}

console.log("pulling laureates...");
await loadLaureates();
console.log("walking advisor chains upward...");
await loadAncestors();
console.log("pulling kinship among known people...");
await loadKinship();

// Wikidata is edited by anybody, and a label is the easiest field to change
// without leaving a mark. Q157255's English label read "Clark Gregg" -- an
// American actor -- on an item whose dates, prize and every other language
// said Merton Miller, and the page shipped that name to a marker. Overrides
// live in data/corrections.json with their evidence, and are announced rather
// than applied quietly.
interface Correction {
  name: string;
  wasSaying: string;
  why: string;
}
const corrections = JSON.parse(readFileSync("data/corrections.json", "utf8")) as {
  names: Record<string, Correction>;
};
for (const [id, fix] of Object.entries(corrections.names)) {
  const person = people.get(id);
  if (!person) {
    console.warn(`  correction for ${id} (${fix.name}) but that person is not in this pull`);
    continue;
  }
  if (person.name === fix.name) {
    console.log(`  ${id}: Wikidata now says "${fix.name}" itself -- the override is redundant`);
    continue;
  }
  if (person.name !== fix.wasSaying) {
    console.warn(
      `  ${id}: expected Wikidata to say "${fix.wasSaying}", it now says "${person.name}". ` +
        `The correction still applies but its evidence needs re-checking.`,
    );
  }
  console.log(`  ${id}: "${person.name}" -> "${fix.name}"`);
  person.name = fix.name;
}

// The check that would have caught it without anybody noticing by eye. A
// personal name should not differ between languages; where English disagrees
// with German and French, one of them has been edited.
{
  const laureateIds = [...people.values()].filter((p) => p.laureate).map((p) => p.id);
  let flagged = 0;
  for (const batch of chunk(laureateIds, 150)) {
    const values = batch.map((id) => `wd:${id}`).join(" ");
    const rows = await sparql(`
      SELECT ?person ?en ?de ?fr WHERE {
        VALUES ?person { ${values} }
        OPTIONAL { ?person rdfs:label ?en . FILTER(lang(?en) = "en") }
        OPTIONAL { ?person rdfs:label ?de . FILTER(lang(?de) = "de") }
        OPTIONAL { ?person rdfs:label ?fr . FILTER(lang(?fr) = "fr") }
      }
    `);
    for (const row of rows) {
      const id = qid(row.person!.value);
      const en = row.en?.value;
      const others = [row.de?.value, row.fr?.value].filter(Boolean) as string[];
      if (!en || others.length < 2) continue;
      const surname = (name: string) => name.split(/\s+/).pop()!.toLowerCase();
      // Names transliterate and pick up middle initials; a shared surname is
      // the weakest claim that still catches a wholesale replacement.
      if (others.every((other) => surname(other) !== surname(en))) {
        console.warn(`  label disagreement ${id}: en="${en}" de/fr="${others.join('", "')}"`);
        flagged += 1;
      }
    }
    await sleep(400);
  }
  console.log(`label cross-check: ${flagged} disagreement(s) between English and German/French`);
}

// Anyone who is neither a laureate nor connected to one is noise from a broken
// claim, not connective tissue. Drop them rather than render a stray dot.
const connected = new Set<string>();
for (const edge of edges.values()) {
  connected.add(edge.from);
  connected.add(edge.to);
}
for (const [id, person] of people) {
  if (!person.laureate && !connected.has(id)) people.delete(id);
}

const snapshot = {
  fetchedAt: new Date().toISOString().slice(0, 10),
  source: {
    endpoint: ENDPOINT,
    note: "Counts computed from this file are about this graph, not about Tol (2024). The two are never mixed in one sentence.",
  },
  people: [...people.values()].sort((a, b) => a.id.localeCompare(b.id)),
  edges: [...edges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
};

mkdirSync("data", { recursive: true });
writeFileSync("data/nobel.json", `${JSON.stringify(snapshot, null, 2)}\n`);

const laureates = snapshot.people.filter((person) => person.laureate).length;
const unsourced = snapshot.edges.filter((edge) => edge.provenance === "wikidata-unsourced").length;
console.log(
  `\nwrote data/nobel.json: ${snapshot.people.length} people (${laureates} laureates), ` +
    `${snapshot.edges.length} edges, ${unsourced} of them unsourced`,
);
