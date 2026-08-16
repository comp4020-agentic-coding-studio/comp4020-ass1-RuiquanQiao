import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph, directOf, reachedFrom } from "../graph.ts";
import type { Snapshot } from "../graph.ts";
import {
  EDGE_ORDER,
  NODE_ORDER,
  background,
  baseRadius,
  contrast,
  edgeStyle,
  edgeTier,
  nodeStyle,
  radiusFor,
  tierOf,
} from "../render.ts";
import type { NodeStyle, Theme, Tier } from "../render.ts";

// What clicking somebody actually does to the picture, in either theme.
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
// These claims are stated in **contrast against the background**, not
// brightness. That is not pedantry: the first version of this file said
// "not dimmer than at rest", which is precisely backwards on paper, where lit
// means darker. Contrast is the thing that was meant, and it is the only
// phrasing that can hold both themes to the same promise.

const snapshot = JSON.parse(readFileSync(resolve("data/nobel.json"), "utf8")) as Snapshot;
const graph = buildGraph(snapshot);

const THEMES: Theme[] = ["dark", "light"];
const LIT: Tier[] = ["resting", "reached", "direct", "seed"];

/** The colour a dot actually reads as: its ring if it has one, else its fill. */
const ink = (style: NodeStyle) => style.stroke ?? style.fill;

/** How hard a dot is to miss against the page it sits on. */
const standout = (style: NodeStyle, theme: Theme) => contrast(ink(style), background(theme));

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

for (const theme of THEMES) {
  describe(`${theme}: clicking never hides what it reaches`, () => {
    // The regression, stated as the thing that was false. A laureate you can
    // still get to must not stand out less than they did before you clicked;
    // that is what #7a6334-where-#e8b552-belongs did, and it made a selection
    // look like it had *shrunk* the tree.
    for (const laureate of [true, false]) {
      const who = laureate ? "a laureate" : "a teacher or relative";

      it(`keeps ${who} in the reached tier at least as visible as at rest`, () => {
        expect(standout(nodeStyle(laureate, "reached", theme), theme)).toBeGreaterThanOrEqual(
          standout(nodeStyle(laureate, "resting", theme), theme),
        );
      });

      it(`keeps ${who} in the reached tier at least as large as at rest`, () => {
        // Per person: the same degree, two tiers. Size across people means how
        // many relations they have, so the comparison has to hold degree fixed.
        for (const degree of [0, 2, 15]) {
          expect(radiusFor(degree, laureate, "reached", theme)).toBeGreaterThanOrEqual(
            radiusFor(degree, laureate, "resting", theme),
          );
        }
      });

      it(`pushes ${who} out of reach below every lit tier`, () => {
        const out = standout(nodeStyle(laureate, "out", theme), theme);
        for (const tier of LIT) {
          expect(out).toBeLessThan(standout(nodeStyle(laureate, tier, theme), theme));
        }
      });

      it(`keeps ${who} out of reach faint rather than invisible`, () => {
        // Still a dot. The picture is showing you a graph you cannot get to,
        // not deleting it -- the shape of the rest of the tree is information.
        expect(standout(nodeStyle(laureate, "out", theme), theme)).toBeGreaterThan(1.05);
      });

      it(`sizes ${who} seed over direct over reached, for the same person`, () => {
        for (const degree of [0, 2, 15]) {
          expect(radiusFor(degree, laureate, "seed", theme)).toBeGreaterThan(
            radiusFor(degree, laureate, "direct", theme),
          );
          expect(radiusFor(degree, laureate, "direct", theme)).toBeGreaterThan(
            radiusFor(degree, laureate, "reached", theme),
          );
        }
      });
    }

    it("marks only the seed, so a selection is findable in a hairball", () => {
      for (const tier of NODE_ORDER) {
        expect(nodeStyle(true, tier, theme).halo === null).toBe(tier !== "seed");
        expect(nodeStyle(false, tier, theme).halo === null).toBe(tier !== "seed");
      }
    });
  });

  describe(`${theme}: laureates and everybody else never look alike`, () => {
    // CLAUDE.md: non-laureates stay in the graph and are never dressed up as
    // somebody who won something. Hollow versus solid says that before colour
    // does, which is also what the relations list borrows.
    it("draws a lit non-laureate hollow and a lit laureate solid", () => {
      for (const tier of ["resting", "reached", "direct"] as Tier[]) {
        expect(nodeStyle(false, tier, theme).stroke).not.toBeNull();
        expect(nodeStyle(true, tier, theme).stroke).toBeNull();
      }
    });

    it("never lends a non-laureate the gold that means laureate", () => {
      const golds = new Set(
        NODE_ORDER.map((tier) => nodeStyle(true, tier, theme).fill.toLowerCase()),
      );
      for (const tier of ["resting", "reached", "direct"] as Tier[]) {
        expect(golds.has(ink(nodeStyle(false, tier, theme)).toLowerCase())).toBe(false);
      }
    });

    it("fills a hollow dot with the page, so no edge shows through it", () => {
      for (const tier of ["resting", "reached", "direct", "seed"] as Tier[]) {
        expect(nodeStyle(false, tier, theme).fill).toBe(background(theme));
      }
    });
  });

  describe(`${theme}: relations are drawn by how far they are from the selection`, () => {
    it("brightens a relation the closer it is to the person selected", () => {
      const against = (tier: "resting" | "reached" | "direct") =>
        contrast(edgeStyle(tier, theme).stroke, background(theme));
      expect(against("direct")).toBeGreaterThan(against("reached"));
      expect(against("reached")).toBeGreaterThan(against("resting"));
    });
  });
}

describe("edge tiers, which do not depend on the theme", () => {
  it("calls an edge resting, direct, reached or out", () => {
    const seed = "A";
    const reached = new Set(["B", "C"]);
    expect(edgeTier("A", "B", null, reached)).toBe("resting");
    expect(edgeTier("A", "B", seed, reached)).toBe("direct");
    expect(edgeTier("B", "C", seed, reached)).toBe("reached");
    expect(edgeTier("B", "Z", seed, reached)).toBe("out");
    expect(edgeTier("Y", "Z", seed, reached)).toBe("out");
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

describe("size says how many relations somebody has", () => {
  // The ordinary expectation of a knowledge graph, and the page was ignoring
  // it: every laureate was the same dot whether they had fifteen documented
  // relations or none.
  it("puts area in proportion to degree, not width", () => {
    // Nine times the relations should look like nine times the dot, and the
    // eye reads area. Radius therefore goes with the square root.
    const at = (degree: number) => baseRadius(degree, true) - baseRadius(0, true);
    expect(at(4) / at(1)).toBeCloseTo(2, 6);
    expect(at(9) / at(1)).toBeCloseTo(3, 6);
  });

  it("makes Rutherford's fifteen visibly bigger than the median two", () => {
    expect(baseRadius(15, true)).toBeGreaterThan(baseRadius(2, true) * 1.5);
  });

  it("still draws somebody with no relations at all", () => {
    // 247 laureates have none, and they are the page's second question rather
    // than an absence. Smallest dot, never no dot.
    expect(baseRadius(0, true)).toBeGreaterThan(1);
    expect(baseRadius(0, false)).toBeGreaterThan(0.5);
  });

  it("keeps a laureate larger than a non-laureate of the same degree", () => {
    for (const degree of [0, 2, 15]) {
      expect(baseRadius(degree, true)).toBeGreaterThan(baseRadius(degree, false));
    }
  });

  it("never returns something nonsensical for a degree it should not see", () => {
    expect(baseRadius(-3, true)).toBe(baseRadius(0, true));
  });
});

describe("contrast, since every claim above is counted with it", () => {
  it("agrees with the WCAG worked examples", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrast("#e8b552", "#e8b552")).toBeCloseTo(1, 5);
  });
});
