import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The honesty contract for the snapshot in data/.
//
// This file was written before the data it constrains existed, and the bulk
// import had to satisfy it rather than the other way round. Every rule here is
// a rule in CLAUDE.md under "Honesty rules"; if the two ever disagree, one of
// them is a lie and both need fixing.
//
// The page makes claims about real people. An edge without a source is not a
// rough edge, it is an assertion about who taught whom that nobody can check.

const SNAPSHOT = resolve("data/nobel.json");

const PROVENANCE = ["official", "wikidata-sourced", "wikidata-unsourced"] as const;
const EDGE_TYPES = ["supervised", "kin"] as const;
const KIN_KINDS = ["parent", "spouse", "sibling"] as const;
const PRIZE_CATEGORIES = ["physics", "chemistry", "medicine", "economics"] as const;

// Outbound links are validated by CI's link check from a datacentre IP, so
// every host a source can point at is listed here deliberately.
const SOURCE_HOSTS = ["www.wikidata.org", "www.nobelprize.org"];

type Provenance = (typeof PROVENANCE)[number];
type EdgeType = (typeof EDGE_TYPES)[number];
type KinKind = (typeof KIN_KINDS)[number];

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
  type: EdgeType;
  kin: KinKind | null;
  provenance: Provenance;
  references: number;
  source: string;
}

interface Snapshot {
  fetchedAt: string;
  people: Person[];
  edges: Edge[];
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
const byId = new Map(snapshot.people.map((person) => [person.id, person]));

const edgeLabel = (edge: Edge) =>
  `${byId.get(edge.from)?.name ?? edge.from} -> ${byId.get(edge.to)?.name ?? edge.to}`;

describe("snapshot", () => {
  it("records when it was fetched, so the page can date itself", () => {
    expect(snapshot.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("holds people and edges", () => {
    expect(snapshot.people.length).toBeGreaterThan(0);
    expect(snapshot.edges.length).toBeGreaterThan(0);
  });

  it("gives every person a unique id", () => {
    expect(byId.size).toBe(snapshot.people.length);
  });
});

describe("people", () => {
  it("identifies everyone by a Wikidata QID", () => {
    for (const person of snapshot.people) {
      expect(person.id, `${person.name} has a non-QID id`).toMatch(/^Q\d+$/);
    }
  });

  it("gives everyone a name", () => {
    for (const person of snapshot.people) {
      expect(person.name.trim(), `${person.id} has no name`).not.toBe("");
    }
  });

  // The tree is held together by people who never won anything. Collapsing a
  // chain that runs through them into a direct laureate-to-laureate edge would
  // invent a supervision that never happened, so they stay -- which means
  // "laureate" has to be load-bearing and exact.
  it("only calls someone a laureate when a prize backs it", () => {
    for (const person of snapshot.people) {
      if (person.laureate) {
        expect(person.prizes.length, `${person.name} is a laureate with no prize`).toBeGreaterThan(0);
      } else {
        expect(person.prizes.length, `${person.name} is not a laureate but has prizes`).toBe(0);
      }
    }
  });

  it("keeps prizes inside the four categories the source dataset covers", () => {
    // Literature and peace are outside Tol (2024). The page says so rather than
    // implying the tree covers all six prizes.
    for (const person of snapshot.people) {
      for (const prize of person.prizes) {
        expect(PRIZE_CATEGORIES, `${person.name}: ${prize.category}`).toContain(prize.category);
      }
    }
  });

  // An undated prize is `null`, never `0`. A zero is a number that looks like
  // data: it survives a type check, passes a range test nobody wrote, and
  // renders as "physics 0" on a page about real people.
  it("says a prize is undated rather than inventing a year for it", () => {
    for (const person of snapshot.people) {
      for (const prize of person.prizes) {
        if (prize.year === null) continue;
        expect(prize.year, `${person.name}: ${prize.category}`).toBeGreaterThanOrEqual(1901);
      }
    }
  });

  // Regression. Wikidata's "award received" does not imply a person: the first
  // pull admitted Sheldon Cooper (Q629583), a television character who wins the
  // physics prize on the show, and Q56509417, which is a family rather than a
  // member of one. The importer now requires instance-of-human; this is the
  // trap that fires if that clause is ever dropped.
  it("admits nobody who is not a human being", () => {
    const ids = new Set(snapshot.people.map((person) => person.id));
    expect(ids.has("Q629583"), "Sheldon Cooper is not a Nobel laureate").toBe(false);
    expect(ids.has("Q56509417"), "a family is not a person").toBe(false);
  });

  // A bare QID as a name means the label service had nothing, which in this
  // dataset has meant the entity was not a person at all.
  it("never falls back to showing a QID where a name should be", () => {
    for (const person of snapshot.people) {
      expect(person.name, `${person.id} has no label`).not.toMatch(/^Q\d+$/);
    }
  });

  // Wikidata sometimes holds two items for one person: Henry De Wolf Smyth is
  // both Q102077024 and Q451199, and both appear in Rutherford's students.
  //
  // They are not merged. Deciding that two records are one person is a claim,
  // and matching on a normalised name would make that claim on a similarity
  // score -- which is how you eventually merge two real people who happen to
  // share a name. The duplicate is shown as the source has it and named in
  // about/. What this test does is stop the number growing quietly: a refresh
  // that pulls in a pile of new duplicates fails here instead of shipping.
  it("does not quietly accumulate people who are probably each other", () => {
    const seen = new Map<string, string[]>();
    for (const person of snapshot.people) {
      const key = person.name
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^a-z]/g, "");
      seen.set(key, [...(seen.get(key) ?? []), `${person.name} (${person.id})`]);
    }
    const collisions = [...seen.values()].filter((group) => group.length > 1);
    expect(collisions.length, `name collisions: ${JSON.stringify(collisions)}`).toBeLessThanOrEqual(3);
  });

  it("carries at least one non-laureate, or the graph is lying about its shape", () => {
    expect(snapshot.people.some((person) => !person.laureate)).toBe(true);
  });
});

describe("edges", () => {
  it("connects people who exist in the snapshot", () => {
    for (const edge of snapshot.edges) {
      expect(byId.has(edge.from), `unknown from: ${edge.from}`).toBe(true);
      expect(byId.has(edge.to), `unknown to: ${edge.to}`).toBe(true);
    }
  });

  it("never connects a person to themselves", () => {
    for (const edge of snapshot.edges) {
      expect(edge.from, `self edge on ${edgeLabel(edge)}`).not.toBe(edge.to);
    }
  });

  // "Colleague" was in the first scope and was cut: everyone at the Cavendish
  // was a colleague of everyone, so no such edge could carry a source, and a
  // "96% connected" headline propped up by undefined edges would be a
  // fabricated finding wearing a real number's clothes. A third relation type
  // may only arrive with a definition and a source, and this test is what makes
  // that a decision rather than a drift.
  it("admits only relation types that have a definition", () => {
    for (const edge of snapshot.edges) {
      expect(EDGE_TYPES, `${edgeLabel(edge)} has type "${edge.type}"`).toContain(edge.type);
    }
  });

  it("names the kind of every kinship edge, and only those", () => {
    for (const edge of snapshot.edges) {
      if (edge.type === "kin") {
        expect(KIN_KINDS, `${edgeLabel(edge)}`).toContain(edge.kin);
      } else {
        expect(edge.kin, `${edgeLabel(edge)} is not kin but names a kin kind`).toBeNull();
      }
    }
  });

  it("stores each relation once, in one direction", () => {
    // parent/child and student/advisor are the same fact twice. Keeping both
    // would double every count the page computes.
    const seen = new Set<string>();
    for (const edge of snapshot.edges) {
      const forward = `${edge.type}:${edge.kin}:${edge.from}:${edge.to}`;
      const symmetric = edge.kin === "spouse" || edge.kin === "sibling";
      const reverse = `${edge.type}:${edge.kin}:${edge.to}:${edge.from}`;
      expect(seen.has(forward), `duplicate: ${edgeLabel(edge)}`).toBe(false);
      if (symmetric) {
        expect(seen.has(reverse), `mirrored duplicate: ${edgeLabel(edge)}`).toBe(false);
      }
      seen.add(forward);
    }
  });
});

describe("provenance", () => {
  it("gives every edge a provenance the reader can be told about", () => {
    for (const edge of snapshot.edges) {
      expect(PROVENANCE, `${edgeLabel(edge)}`).toContain(edge.provenance);
    }
  });

  it("gives every edge a source that can be opened", () => {
    for (const edge of snapshot.edges) {
      const url = new URL(edge.source);
      expect(url.protocol, `${edgeLabel(edge)}`).toBe("https:");
      expect(SOURCE_HOSTS, `${edgeLabel(edge)} cites ${url.host}`).toContain(url.host);
    }
  });

  // Wikidata's P184 is uneven: many advisor claims carry zero references, and
  // in the raw response they are indistinguishable from sourced ones. Recording
  // the count is what keeps that distinction from being quietly lost.
  it("keeps the reference count consistent with the provenance it claims", () => {
    for (const edge of snapshot.edges) {
      expect(Number.isInteger(edge.references), `${edgeLabel(edge)}`).toBe(true);
      expect(edge.references, `${edgeLabel(edge)}`).toBeGreaterThanOrEqual(0);
      if (edge.provenance === "wikidata-sourced") {
        expect(edge.references, `${edgeLabel(edge)} claims sourced with no references`).toBeGreaterThan(0);
      }
      if (edge.provenance === "wikidata-unsourced") {
        expect(edge.references, `${edgeLabel(edge)} claims unsourced but has references`).toBe(0);
      }
    }
  });
});
