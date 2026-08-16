// Rebuilds data/portraits.json and public/portraits/ from Wikidata and
// Wikimedia Commons. Run by hand, never by a build:
//
//   node refresh-portraits.ts
//
// Same contract as refresh-nobel.ts and the same reason: the build must not
// touch the network. This one also writes ~4 MB of images, which is a second
// reason never to put it anywhere near CI.
//
// Two things about other people's servers, both learned by measuring rather
// than by reading:
//
//   - upload.wikimedia.org's /<n>px- thumbnail path returns 400 for widths it
//     has not already rendered. Special:FilePath?width=N does not; it redirects
//     to the nearest rendition Commons actually has. That is the route used
//     here, and 96 lands on a ~6 KB file where 128 lands on the 250px
//     rendition at ~20 KB. Three times the bytes for pixels this page never
//     shows, so 96 it is.
//   - Commons only rasterises what a browser cannot display. TIFF comes back
//     as JPEG; PNG and GIF come back as resized PNG and GIF. An earlier version
//     of this script assumed everything arrived as JPEG and wrote 25 files with
//     a .jpg extension containing PNG and GIF data. Browsers sniff content and
//     rendered them anyway, which is exactly why that kind of mistake survives
//     -- so the type is read from the magic bytes and the file is named for
//     what it actually is.
//   - A photograph re-encoded as PNG is not small. Two of them came back at
//     396 KB for a 96px portrait, which is sixty times the median. Anything
//     over the budget is re-requested narrower once before being accepted.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { AGENT, LANGUAGES, chunk, getJson, qid, sleep, sparql } from "./wikidata.ts";

const WIDTH = 96;
const NARROW = 64;
/** Past this, ask again at NARROW. The median portrait is about 6 KB. */
const BUDGET = 60 * 1024;
const OUT_DIR = "public/portraits";

/** What this actually is, from the first bytes rather than from the URL. */
function extensionOf(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  if (bytes.subarray(0, 4).toString() === "RIFF") return "webp";
  return null;
}

/**
 * Licences excluded, and why.
 *
 * GFDL 1.2 used to be on this list. Its condition is that a copy of the
 * licence travels with the work, and the site now carries one at
 * `licences/gfdl-1.2/` -- twenty kilobytes of legalese for three more faces,
 * which is a trade worth making when the alternative is three laureates with
 * no picture. `spec/portraits.test.ts` fails if a GFDL portrait ships without
 * that page present.
 *
 * CC SA 1.0 stays out: a deprecated share-alike with no attribution clause and
 * nothing modern to point a reader at.
 */
const EXCLUDED = new Set(["CC SA 1.0"]);

/** Licences whose terms are met by shipping the text at this path. */
export const LICENCE_PAGES: Record<string, string> = {
  "GFDL 1.2": "licences/gfdl-1.2/",
  GFDL: "licences/gfdl-1.2/",
};

interface Snapshot {
  people: { id: string; laureate: boolean; name: string }[];
}

interface CommonsPage {
  title: string;
  imageinfo?: {
    descriptionurl?: string;
    extmetadata?: Record<string, { value: string } | undefined>;
  }[];
}

const snapshot = JSON.parse(readFileSync("data/nobel.json", "utf8")) as Snapshot;
const laureates = new Map(
  snapshot.people.filter((person) => person.laureate).map((person) => [person.id, person.name]),
);
console.log(`${laureates.size} laureates in the snapshot`);

// --- which laureates have a picture -----------------------------------------
// Driven by the committed graph, not by a fresh independent query. If the two
// disagreed, the page would show a face for somebody it never drew.

const fileOf = new Map<string, string>();
for (const batch of chunk([...laureates.keys()], 150)) {
  const values = batch.map((id) => `wd:${id}`).join(" ");
  const rows = await sparql(`
    SELECT ?person ?img WHERE {
      VALUES ?person { ${values} }
      ?person wdt:P18 ?img .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGUAGES}". }
    }
  `);
  for (const row of rows) {
    const id = qid(row.person!.value);
    // P18 can carry more than one image; the first is Wikidata's own preferred
    // rank order and picking a different one would be inventing an opinion.
    if (fileOf.has(id)) continue;
    const file = decodeURIComponent(row.img!.value.replace(/.*Special:FilePath\//, "")).replace(
      /_/g,
      " ",
    );
    fileOf.set(id, file);
  }
  await sleep(400);
}
console.log(`${fileOf.size} of them have a P18 image`);

// Hand-picked, and they override P18 where they disagree with it.
//
// P18 is one editor's choice of one file and it is often not a portrait, or is
// under a licence this site cannot honour, or points at a scan Commons has no
// small rendition of. Nothing automatic can tell a portrait from a lecture
// theatre, a gravestone, a thesis title page or the profile of Alfred Nobel on
// the medal -- searching these names returns all four. Each entry in
// data/portrait-extras.json was looked at first, and says so.
const extras = JSON.parse(readFileSync("data/portrait-extras.json", "utf8")) as {
  portraits: Record<string, { file: string; who: string; why: string }>;
};
let overridden = 0;
for (const [id, extra] of Object.entries(extras.portraits)) {
  if (!laureates.has(id)) {
    console.warn(`  extra for ${id} (${extra.who}) but that person is not a laureate here`);
    continue;
  }
  if (fileOf.get(id) !== extra.file) overridden += 1;
  fileOf.set(id, extra.file);
}
console.log(`${overridden} hand-picked portrait(s) override or add to P18`);

// --- what each picture is licensed as ---------------------------------------

interface Credit {
  file: string;
  artist: string;
  licence: string;
  commons: string;
  /** Set once the bytes have been seen. The page builds its URL from this. */
  ext?: string;
}

/**
 * Commons's `Artist` field is free-form wikitext rendered to HTML, and it
 * arrives in three shapes this has to survive.
 *
 * Nested elements repeating the same text -- `<a>Unknown author</a>` inside a
 * `<span>Unknown author</span>` -- which naive tag-stripping concatenates into
 * "Unknown authorUnknown author". That was 101 of 729 credits.
 *
 * HTML entities, which tag-stripping leaves behind, so a photographer called
 * "AB Lagrelius & Westphal" reads as "&amp;".
 *
 * And whole paragraphs of provenance prose where a name was expected. Those
 * are kept in full -- truncating an attribution to make it tidy is not a
 * trade this page gets to make -- and the readout clamps them visually while
 * the credits page carries every word.
 */
function strip(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Exactly doubled, with or without a separating space.
  const halves = text.match(/^(.+?)\s*\1$/);
  return halves ? halves[1]!.trim() : text;
}

const credits = new Map<string, Credit>();
const tally: Record<string, number> = {};
const dropped: { id: string; name: string; why: string }[] = [];

const byFile = new Map<string, string[]>();
for (const [id, file] of fileOf) {
  const list = byFile.get(file);
  if (list) list.push(id);
  else byFile.set(file, [id]);
}

for (const batch of chunk([...byFile.keys()], 50)) {
  const titles = batch.map((file) => `File:${file}`).join("|");
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2" +
    "&prop=imageinfo&iiprop=extmetadata|url&iiextmetadatafilter=" +
    "LicenseShortName|Artist|NonFree" +
    `&titles=${encodeURIComponent(titles)}`;
  const body = await getJson<{ query?: { pages?: CommonsPage[] } }>(url);

  for (const page of body.query?.pages ?? []) {
    const file = page.title.replace(/^File:/, "");
    const ids = byFile.get(file) ?? [];
    const info = page.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const licence = strip(meta.LicenseShortName?.value ?? "");
    const names = ids.map((id) => laureates.get(id) ?? id).join(", ");

    if (!info) {
      dropped.push({ id: ids.join("/"), name: names, why: "no Commons record" });
      continue;
    }
    // Zero images are flagged non-free today. The check stays so that stops
    // being true loudly rather than silently.
    if (meta.NonFree) {
      dropped.push({ id: ids.join("/"), name: names, why: "flagged non-free" });
      continue;
    }
    if (!licence) {
      dropped.push({ id: ids.join("/"), name: names, why: "no licence recorded" });
      continue;
    }
    if (EXCLUDED.has(licence)) {
      dropped.push({ id: ids.join("/"), name: names, why: licence });
      continue;
    }

    tally[licence] = (tally[licence] ?? 0) + 1;
    // "Artist" is free-form wikitext and is often absent even on CC BY files.
    // Saying "unknown" is the honest rendering; inventing one is not.
    const artist = strip(meta.Artist?.value ?? "") || "unknown";
    for (const id of ids) {
      credits.set(id, {
        file,
        artist,
        licence,
        commons:
          info.descriptionurl ??
          `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`,
      });
    }
  }
  process.stdout.write(".");
  await sleep(250);
}
console.log(`\n${credits.size} portraits cleared for use, ${dropped.length} dropped`);

// --- fetch them -------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

// Resumable, because it is a ten-minute crawl of somebody else's servers and
// re-running it to add six hand-picked files should not re-fetch 729 that have
// not changed. A file counts as already here only if the manifest names the
// same Commons file and the bytes on disk are within budget.
const previous: Record<string, Credit> = existsSync("data/portraits.json")
  ? (JSON.parse(readFileSync("data/portraits.json", "utf8")) as { portraits: Record<string, Credit> })
      .portraits
  : {};

let bytes = 0;
let failed = 0;
const kept = new Map<string, Credit>();
const ids = [...credits.keys()].sort();

let shrunk = 0;
let oversized = 0;

async function download(file: string, width: number): Promise<Buffer> {
  const url =
    `https://commons.wikimedia.org/wiki/Special:FilePath/` +
    `${encodeURIComponent(file.replace(/ /g, "_"))}?width=${width}`;
  const response = await fetch(url, { headers: { "User-Agent": AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

let reused = 0;
for (const [index, id] of ids.entries()) {
  const credit = credits.get(id)!;

  const already = previous[id];
  if (already && already.file === credit.file && already.ext) {
    const path = `${OUT_DIR}/${id}.${already.ext}`;
    if (existsSync(path) && statSync(path).size <= BUDGET) {
      // Keep the fresh licence and creator -- those come from this run -- but
      // do not re-download bytes that are already correct.
      kept.set(id, { ...credit, ext: already.ext });
      bytes += statSync(path).size;
      reused += 1;
      continue;
    }
  }

  try {
    let buffer = await download(credit.file, WIDTH);
    if (buffer.byteLength > BUDGET) {
      // A photograph stored as PNG does not shrink the way a JPEG does. Ask
      // once for a narrower rendition and take whichever is smaller.
      await sleep(120);
      const smaller = await download(credit.file, NARROW);
      if (smaller.byteLength < buffer.byteLength) {
        buffer = smaller;
        shrunk += 1;
      }
    }
    if (buffer.byteLength < 200) throw new Error("suspiciously small");
    // Some files have no rendition at any width -- Commons hands back the
    // original however narrow you ask. Two of the Wellcome Collection scans do
    // exactly that, at 395 KB for a portrait meant to be six. Shipping two
    // files worth 14% of the whole set so that two laureates out of 731 have a
    // face is the wrong trade; they keep a gold dot, the same as the nineteen
    // with no picture on Wikidata and the seven dropped on licence.
    if (buffer.byteLength > BUDGET) {
      dropped.push({
        id,
        name: laureates.get(id) ?? id,
        why: `no small rendition (${(buffer.byteLength / 1024).toFixed(0)} KB at any width)`,
      });
      oversized += 1;
      continue;
    }
    const ext = extensionOf(buffer);
    if (!ext) throw new Error("not an image this page can draw");
    writeFileSync(`${OUT_DIR}/${id}.${ext}`, buffer);
    bytes += buffer.byteLength;
    kept.set(id, { ...credit, ext });
  } catch (error) {
    failed += 1;
    console.warn(`\n  ${id} (${laureates.get(id)}): ${String(error)}`);
  }
  if (index % 25 === 0) process.stdout.write(".");
  await sleep(120); // somebody else's bandwidth
}

// --- write the manifest -----------------------------------------------------
// Only what actually landed on disk. A manifest listing a file the page cannot
// load would put a broken image where a person's face is meant to be.

const portraits = Object.fromEntries(
  [...kept.entries()].sort(([a], [b]) => a.localeCompare(b)),
);

// Anything on disk the manifest no longer names is a portrait with no credit
// attached, which is the licence problem in the other direction.
let orphans = 0;
for (const file of readdirSync(OUT_DIR)) {
  const id = file.replace(/\.[a-z0-9]+$/, "");
  if (kept.has(id) && `${id}.${kept.get(id)!.ext}` === file) continue;
  rmSync(`${OUT_DIR}/${file}`);
  orphans += 1;
}
if (orphans) console.log(`removed ${orphans} file(s) the manifest no longer names`);

writeFileSync(
  "data/portraits.json",
  `${JSON.stringify(
    {
      fetchedAt: new Date().toISOString().slice(0, 10),
      width: WIDTH,
      source: {
        note:
          "Portraits are Wikidata P18 resolved through Wikimedia Commons. Every one carries " +
          "its creator and licence; the page shows both. GFDL 1.2 and CC SA 1.0 are excluded.",
      },
      laureates: laureates.size,
      portraits,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `\n\nwrote ${kept.size} portraits (${(bytes / 1024 / 1024).toFixed(2)} MB), ` +
    `${reused} reused, ${failed} failed, ${shrunk} re-requested narrower, ` +
    `${oversized} dropped as oversized`,
);
const types: Record<string, number> = {};
for (const credit of kept.values()) types[credit.ext!] = (types[credit.ext!] ?? 0) + 1;
console.log(`formats: ${JSON.stringify(types)}`);
console.log(`coverage: ${kept.size} of ${laureates.size} laureates`);
console.log("\nlicences:");
for (const [licence, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${licence}`);
}
if (dropped.length) {
  console.log("\ndropped:");
  for (const drop of dropped) console.log(`  ${drop.name} — ${drop.why}`);
}
