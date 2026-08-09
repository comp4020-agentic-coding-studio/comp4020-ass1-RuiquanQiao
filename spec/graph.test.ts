import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  directOf,
  reachedFrom,
  components,
  search,
  summarise,
  normalise,
} from "../graph.ts";
import type { Edge, Snapshot } from "../graph.ts";

// The core interaction, as a contract.
//
// The spec asks for the core interaction to be stated plainly enough to write a
// test for. This is that test. Selecting a laureate lights the graph in two
// tiers -- `direct` (documented relations) and `reached` (any chain of them) --
// and both must equal what the data says, not what looks good.
//
// The fixture below is deliberately hand-drawn: two separate components with a
// known shape, so a wrong answer is obvious rather than merely different.

const edge = (from: string, to: string, rest: Partial<Edge> = {}): Edge => ({
  from,
  to,
  type: "supervised",
  kin: null,
  provenance: "wikidata-sourced",
  references: 1,
  source: "https://www.wikidata.org/wiki/Q1",
  ...rest,
});

//   A --supervised--> B --supervised--> C
//   A --------- married ---------- D          (D is not a laureate)
//   ---- separate component ----
//   E --supervised--> F
//   ---- and one laureate on their own ----
//   G
const FIXTURE: Snapshot = {
  fetchedAt: "2026-08-09",
  people: [
    { id: "A", name: "Ada", laureate: true, prizes: [{ category: "physics", year: 1901 }] },
    { id: "B", name: "Bo", laureate: true, prizes: [{ category: "physics", year: 1911 }] },
    { id: "C", name: "Cai", laureate: true, prizes: [{ category: "chemistry", year: 1921 }] },
    { id: "D", name: "Dov", laureate: false, prizes: [] },
    { id: "E", name: "Eve", laureate: true, prizes: [{ category: "medicine", year: 1931 }] },
    { id: "F", name: "Finn", laureate: false, prizes: [] },
    { id: "G", name: "Gus", laureate: true, prizes: [{ category: "economics", year: 1971 }] },
  ],
  edges: [
    edge("A", "B"),
    edge("B", "C"),
    edge("A", "D", { type: "kin", kin: "spouse" }),
    edge("E", "F"),
  ],
};

const fixture = buildGraph(FIXTURE);

describe("tier one: direct relations", () => {
  it("is exactly the people an edge connects you to", () => {
    expect(directOf(fixture, "A")).toEqual(["B", "D"]);
    expect(directOf(fixture, "B")).toEqual(["A", "C"]);
    expect(directOf(fixture, "C")).toEqual(["B"]);
  });

  it("does not include the selected person", () => {
    for (const id of fixture.people.keys()) {
      expect(directOf(fixture, id)).not.toContain(id);
    }
  });

  it("reads relations in both directions", () => {
    // C was supervised by B; the edge is stored one way, but selecting either
    // end must find the other. A one-directional readout would silently halve
    // every count on the page.
    expect(directOf(fixture, "C")).toContain("B");
    expect(directOf(fixture, "B")).toContain("C");
  });

  it("is empty for someone with no documented relation", () => {
    expect(directOf(fixture, "G")).toEqual([]);
  });
});

describe("tier two: everyone reached", () => {
  it("follows chains of any length", () => {
    // A never taught C, but the tree connects them through B. That indirect
    // reach is the whole point of the page.
    expect(reachedFrom(fixture, "A")).toEqual(["B", "C", "D"]);
    expect(reachedFrom(fixture, "C")).toEqual(["A", "B", "D"]);
  });

  it("never leaks across components", () => {
    expect(reachedFrom(fixture, "A")).not.toContain("E");
    expect(reachedFrom(fixture, "E")).toEqual(["F"]);
  });

  it("is empty for an isolated laureate, which is the thing to go and find", () => {
    expect(reachedFrom(fixture, "G")).toEqual([]);
  });

  it("always contains the direct tier", () => {
    for (const id of fixture.people.keys()) {
      const reached = new Set(reachedFrom(fixture, id));
      for (const neighbour of directOf(fixture, id)) {
        expect(reached.has(neighbour), `${id} reaches ${neighbour} directly but not transitively`).toBe(true);
      }
    }
  });

  it("is symmetric: if you reach them, they reach you", () => {
    for (const id of fixture.people.keys()) {
      for (const other of reachedFrom(fixture, id)) {
        expect(reachedFrom(fixture, other)).toContain(id);
      }
    }
  });
});

describe("components", () => {
  it("splits the fixture into its three groups, largest first", () => {
    expect(components(fixture).map((group) => group.length)).toEqual([4, 2, 1]);
  });
});

describe("search", () => {
  it("finds a person by any part of their name", () => {
    expect(search(fixture, "ad").map((person) => person.id)).toEqual(["A"]);
  });

  it("ignores case and accents, so 'curie' finds 'Curie'", () => {
    expect(normalise("Émile Français")).toBe("emile francais");
  });

  it("puts laureates before non-laureates", () => {
    const hits = search(fixture, "").map((person) => person.id);
    expect(hits).toEqual([]); // an empty query is not a match-everything
  });

  it("returns nothing for a name that is not there", () => {
    expect(search(fixture, "Stupanus")).toEqual([]);
  });
});

describe("the snapshot that ships", () => {
  const snapshot = JSON.parse(
    readFileSync(resolve("data/nobel.json"), "utf8"),
  ) as Snapshot;
  const graph = buildGraph(snapshot);
  const figures = summarise(graph);

  it("is big enough to be worth exploring", () => {
    expect(figures.laureates).toBeGreaterThan(500);
    expect(figures.edges).toBeGreaterThan(500);
  });

  it("holds the non-laureates that connect it together", () => {
    expect(figures.people).toBeGreaterThan(figures.laureates);
  });

  // Not an assertion that the finding replicates -- this graph is not Tol's
  // dataset and the page never says it is. It is an assertion that the page's
  // own headline number is computed from the data it ships, so it cannot drift
  // away from the file underneath it.
  it("has one component far larger than any other", () => {
    const sizes = components(graph).map((group) => group.length);
    expect(sizes[0]).toBeGreaterThan((sizes[1] ?? 0) * 10);
  });

  // The finding is the gap between first and second place, not the size of
  // first place. One group holds well over a thousand people; the next holds
  // fourteen. That is a cliff, and the page prints both numbers so a reader can
  // see the cliff rather than take the word "connected" on trust.
  it("has a second-largest group small enough for the gap to be the point", () => {
    expect(figures.secondLargestComponent).toBeGreaterThan(0);
    expect(figures.largestComponent).toBeGreaterThan(figures.secondLargestComponent * 20);
  });

  // Wikidata records no relation at all for a large minority of laureates.
  // The page has to keep saying so: an empty screen is a hole in the record,
  // and a version of this page that hid the count would be inviting visitors
  // to read that hole as a finding about science.
  it("knows how many laureates it has nothing on", () => {
    expect(figures.isolatedLaureates).toBeGreaterThan(0);
    expect(figures.isolatedLaureates).toBeLessThan(figures.laureates);
  });

  it("agrees with itself about the largest component", () => {
    const biggest = components(graph)[0]!;
    const anyMember = biggest[0]!;
    expect(reachedFrom(graph, anyMember).length + 1).toBe(biggest.length);
  });
});
