import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../graph.ts";

// The portraits, held to the same standard as the edges.
//
// CLAUDE.md's honesty rules are about not saying things the data cannot
// support. Pictures raise two more of the same kind. A face is a claim that
// this is what somebody looked like, so it needs a source the reader can open,
// the same as a claim about who taught whom. And 404 of these are CC BY or
// CC BY-SA, where naming the creator is a condition of use rather than a
// courtesy -- so an entry without one is not untidy, it is a licence breach.

const DIR = resolve("public/portraits");

interface Credit {
  file: string;
  artist: string;
  licence: string;
  commons: string;
  ext: string;
}

/** What a file actually is, from its first bytes. */
function sniff(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  if (bytes.subarray(0, 4).toString() === "RIFF") return "webp";
  return null;
}

const book = JSON.parse(readFileSync(resolve("data/portraits.json"), "utf8")) as {
  fetchedAt: string;
  width: number;
  laureates: number;
  portraits: Record<string, Credit>;
};

const snapshot = JSON.parse(readFileSync(resolve("data/nobel.json"), "utf8")) as Snapshot;
const people = new Map(snapshot.people.map((person) => [person.id, person]));
const laureates = snapshot.people.filter((person) => person.laureate);
const entries = Object.entries(book.portraits);

/**
 * Excluded on purpose, and the reason is in refresh-portraits.ts: GFDL 1.2
 * requires shipping the licence text in full, and CC SA 1.0 is a deprecated
 * share-alike with nothing modern to point a reader at.
 */
const EXCLUDED = ["GFDL 1.2", "GFDL", "CC SA 1.0"];

describe("the manifest describes a real snapshot", () => {
  it("is dated and says what it was fetched at", () => {
    expect(book.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(book.width).toBeGreaterThan(0);
  });

  it("counts the same laureates the graph does", () => {
    expect(book.laureates).toBe(laureates.length);
  });

  it("has portraits for most laureates but not all, and does not pretend otherwise", () => {
    expect(entries.length).toBeGreaterThan(laureates.length * 0.9);
    // The gap is the point. Nineteen laureates have no P18 on Wikidata and a
    // handful more were dropped on licence, and the page says so rather than
    // letting a missing face read as a failed load.
    expect(entries.length).toBeLessThan(laureates.length);
  });
});

describe("every portrait is somebody this graph actually draws", () => {
  it("belongs to a laureate, every time", () => {
    for (const [id] of entries) {
      const person = people.get(id);
      expect(person, `${id} is in the manifest but not in the graph`).toBeTruthy();
      expect(person!.laureate, `${person?.name} is not a laureate`).toBe(true);
    }
  });

  it("never gives a face to somebody who did not win", () => {
    // CLAUDE.md: the tree is held together by people who never won anything,
    // and they are never presented as laureates. Portraits are one more way
    // that could go wrong, so it is asserted rather than assumed.
    const others = snapshot.people.filter((person) => !person.laureate);
    expect(others.length).toBeGreaterThan(0);
    for (const person of others) {
      expect(book.portraits[person.id], `${person.name} never won anything`).toBeUndefined();
    }
  });
});

describe("every portrait carries its provenance", () => {
  it("names a creator, a licence and a page the reader can open", () => {
    for (const [id, credit] of entries) {
      const who = people.get(id)?.name ?? id;
      expect(credit.artist, `${who} has no creator recorded`).toBeTruthy();
      expect(credit.licence, `${who} has no licence recorded`).toBeTruthy();
      expect(credit.file, `${who} has no source filename`).toBeTruthy();
      expect(credit.commons, `${who} has no Commons page`).toMatch(
        /^https:\/\/commons\.wikimedia\.org\//,
      );
    }
  });

  it("ships nothing under a licence this site cannot honour", () => {
    for (const [id, credit] of entries) {
      expect(EXCLUDED, `${people.get(id)?.name} is ${credit.licence}`).not.toContain(
        credit.licence,
      );
    }
  });

  // Commons renders its Artist field to HTML, and stripping the tags naively
  // concatenates nested elements that repeat the same text: `<a>Unknown
  // author</a>` inside a matching `<span>` became "Unknown authorUnknown
  // author" in 101 of 729 credits, and it was visible on the page before
  // anything caught it. Entities survived the same way.
  it("credits a creator once, in text rather than in markup", () => {
    for (const [id, credit] of entries) {
      const who = people.get(id)?.name ?? id;
      expect(credit.artist, `${who}: markup leaked into the credit`).not.toMatch(/[<>]|&[a-z]+;/i);
      const halves = credit.artist.match(/^(.+?)\s*\1$/);
      expect(halves, `${who}: "${credit.artist}" is the same name twice`).toBeNull();
    }
  });

  it("says 'unknown' where Commons records no creator, rather than inventing one", () => {
    // Free-form wikitext is often simply absent, including on CC BY files. The
    // honest rendering is to say so; the dishonest one is a blank that reads
    // as though nobody needed crediting.
    const unknown = entries.filter(([, credit]) => credit.artist === "unknown");
    expect(unknown.length).toBeLessThan(entries.length / 2);
  });
});

describe("every portrait is actually on disk", () => {
  const files = existsSync(DIR) ? readdirSync(DIR) : [];

  it("has a file for every entry in the manifest", () => {
    for (const [id, credit] of entries) {
      expect(credit.ext, `${id} does not say what kind of file it is`).toBeTruthy();
      expect(
        existsSync(resolve(DIR, `${id}.${credit.ext}`)),
        `${id}.${credit.ext} is missing`,
      ).toBe(true);
    }
  });

  // The bug this catches shipped once. Commons only rasterises what a browser
  // cannot display, so PNG and GIF originals come back unchanged -- and 25
  // files were written as .jpg with PNG and GIF bytes inside. Browsers sniff
  // content and rendered them perfectly, which is exactly why nothing noticed.
  it("names every file after what is actually inside it", () => {
    for (const [id, credit] of entries) {
      const path = resolve(DIR, `${id}.${credit.ext}`);
      const actual = sniff(readFileSync(path));
      expect(actual, `${id}.${credit.ext} is really a ${actual}`).toBe(credit.ext);
    }
  });

  it("ships no file the manifest does not describe", () => {
    // An orphan is a portrait with no credit attached, which is the licence
    // problem again in the other direction.
    for (const file of files) {
      const id = file.replace(/\.[a-z0-9]+$/, "");
      expect(book.portraits[id], `${file} has no entry in the manifest`).toBeTruthy();
    }
    expect(files.length).toBe(entries.length);
  });

  it("keeps them small enough that the page is not a download", () => {
    let total = 0;
    for (const file of files) total += statSync(resolve(DIR, file)).size;
    expect(total / 1024 / 1024).toBeLessThan(8);
    // And none of them is a photograph that came back re-encoded as a PNG the
    // size of the original. Two did, at 396 KB for a 96px portrait.
    for (const file of files) {
      expect(statSync(resolve(DIR, file)).size / 1024, file).toBeLessThan(80);
    }
  });
});
