import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph, directOf, reachedFrom } from "../graph.ts";
import type { Snapshot } from "../graph.ts";
import {
  EDGE_ORDER,
  NODE_ORDER,
  edgeStyle,
  edgeTier,
  luminance,
  nodeStyle,
  tierOf,
} from "../render.ts";
import type { NodeStyle, Tier } from "../render.ts";

// What clicking somebody actually does to the picture.
//
// spec/graph.test.ts proves the two tiers are computed right and
// spec/interaction.test.ts proves the readout is wired to them. Neither could
// see the bug that made this file necessary: both tiers were computed
// correctly, the readout reported them correctly, and then draw() painted
// every reached laureate in #7a6334 -- darker than the #e8b552 they were
// before the click. So the page's whole argument, look how much of the screen
// lights up, was inverted at the last step, inside a canvas call jsdom does
// not implement.
//
// The fix was to make appearance data. These are the claims that data has to
// keep true.

const snapshot = JSON.parse(readFileSync(resolve("data/nobel.json"), "utf8")) as Snapshot;
const graph = buildGraph(snapshot);

/** The colour a dot actually reads as: its ring if it has one, else its fill. */
const ink = (style: NodeStyle) => luminance(style.stroke ?? style.fill);

/** A laureate with more documented relations than anybody else in the file. */
const wellConnected = [...graph.people.values()]
  .filter((person) => person.laureate)
  .map((person) => ({ person, direct: directOf(graph, person.id).length }))
  .sort((a, b) => b.direct - a.direct)[0]!.person;

describe("tiers follow the selection", () => {
  it("puts everybody at rest when nothing is selected", () => {
    expect(tierOf("Q7085", null, new Set(), new Set())).toBe("resting");
  });

  it("separates the seed, the direct tier, the reached tier and the rest", () => {
    const seed = wellConnected.id;
    const direct = new Set(directOf(graph, seed));
    const reached = new Set(reachedFrom(graph, seed));
    const someoneDirect = [...direct][0]!;
    const someoneFurther = [...reached].find((id) => !direct.has(id))!;
    const someoneOut = [...graph.people.keys()].find((id) => id !== seed && !reached.has(id))!;

    expect(tierOf(seed, seed, direct, reached)).toBe("seed");
    expect(tierOf(someoneDirect, seed, direct, reached)).toBe("direct");
    expect(tierOf(someoneFurther, seed, direct, reached)).toBe("reached");
    expect(tierOf(someoneOut, seed, direct, reached)).toBe("out");
  });

  it("gives every reachable person a lit tier, not just the direct ones", () => {
    const seed = wellConnected.id;
    const direct = new Set(directOf(graph, seed));
    const reached = new Set(reachedFrom(graph, seed));
    const lit = [...reached].filter((id) => tierOf(id, seed, direct, reached) !== "out");
    // The whole component, not the handful of people standing next to them.
    expect(lit.length).toBe(reached.size);
    expect(reached.size).toBeGreaterThan(direct.size * 10);
  });
});

describe("clicking never dims what it reaches", () => {
  // The regression, stated as the thing that was false. A laureate you can
  // still get to must not be painted darker than they were before you clicked;
  // that is what #7a6334-where-#e8b552-belongs did, and it made a selection
  // look like it had *shrunk* the tree.
  for (const laureate of [true, false]) {
    const who = laureate ? "a laureate" : "a teacher or relative";

    it(`keeps ${who} in the reached tier at least as bright as at rest`, () => {
      expect(ink(nodeStyle(laureate, "reached"))).toBeGreaterThanOrEqual(
        ink(nodeStyle(laureate, "resting")),
      );
    });

    it(`keeps ${who} in the reached tier at least as large as at rest`, () => {
      expect(nodeStyle(laureate, "reached").radius).toBeGreaterThanOrEqual(
        nodeStyle(laureate, "resting").radius,
      );
    });

    it(`pushes ${who} out of reach below every lit tier`, () => {
      const out = ink(nodeStyle(laureate, "out"));
      for (const tier of ["resting", "reached", "direct", "seed"] as Tier[]) {
        expect(out).toBeLessThan(ink(nodeStyle(laureate, tier)));
      }
    });

    it(`sizes ${who} seed over direct over reached`, () => {
      expect(nodeStyle(laureate, "seed").radius).toBeGreaterThan(
        nodeStyle(laureate, "direct").radius,
      );
      expect(nodeStyle(laureate, "direct").radius).toBeGreaterThan(
        nodeStyle(laureate, "reached").radius,
      );
    });
  }

  it("marks only the seed, so a selection is findable in a hairball", () => {
    for (const tier of NODE_ORDER) {
      expect(nodeStyle(true, tier).halo === null).toBe(tier !== "seed");
      expect(nodeStyle(false, tier).halo === null).toBe(tier !== "seed");
    }
  });
});

describe("laureates and everybody else never look alike", () => {
  // CLAUDE.md: non-laureates stay in the graph and are never dressed up as
  // somebody who won something. Hollow versus solid says that before colour
  // does, which is also what the relations list borrows.
  it("draws a lit non-laureate hollow and a lit laureate solid", () => {
    for (const tier of ["resting", "reached", "direct"] as Tier[]) {
      expect(nodeStyle(false, tier).stroke).not.toBeNull();
      expect(nodeStyle(true, tier).stroke).toBeNull();
    }
  });

  it("never lends a non-laureate the gold that means laureate", () => {
    const golds = new Set(
      NODE_ORDER.map((tier) => nodeStyle(true, tier).fill.toLowerCase()),
    );
    for (const tier of ["resting", "reached", "direct"] as Tier[]) {
      const style = nodeStyle(false, tier);
      expect(golds.has((style.stroke ?? style.fill).toLowerCase())).toBe(false);
    }
  });
});

describe("relations are drawn by how far they are from the selection", () => {
  it("calls an edge resting, direct, reached or out", () => {
    const seed = "A";
    const reached = new Set(["B", "C"]);
    expect(edgeTier("A", "B", null, reached)).toBe("resting");
    expect(edgeTier("A", "B", seed, reached)).toBe("direct");
    expect(edgeTier("B", "C", seed, reached)).toBe("reached");
    expect(edgeTier("B", "Z", seed, reached)).toBe("out");
    expect(edgeTier("Y", "Z", seed, reached)).toBe("out");
  });

  it("brightens a relation the closer it is to the person selected", () => {
    expect(luminance(edgeStyle("direct").stroke)).toBeGreaterThan(
      luminance(edgeStyle("reached").stroke),
    );
    expect(luminance(edgeStyle("reached").stroke)).toBeGreaterThan(
      luminance(edgeStyle("resting").stroke),
    );
  });

  it("draws lit things last, so an unreachable dot cannot paint over them", () => {
    expect(NODE_ORDER.at(0)).toBe("out");
    expect(NODE_ORDER.at(-1)).toBe("seed");
    expect(EDGE_ORDER.at(-1)).toBe("direct");
    // Every tier is drawn exactly once, or something silently never appears.
    expect(new Set(NODE_ORDER).size).toBe(NODE_ORDER.length);
    expect(NODE_ORDER).toHaveLength(5);
  });
});
