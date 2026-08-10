// What the picture looks like, decided outside the draw loop.
//
// CLAUDE.md's rule is that state never moves into the renderer. This file is
// that rule applied to appearance, and it exists because the rule was broken
// once and nothing caught it. Selecting somebody used to paint every laureate
// in the reached tier *darker* than it had been before the click -- #7a6334
// where a resting laureate is #e8b552 -- so the one thing the page argues,
// look how much of the screen lights up, was the one thing clicking hid. That
// decision lived as a branch inside draw(), where jsdom has no canvas and no
// test could ever reach it.
//
// Here it is data instead, and spec/render.test.ts holds the ordering: nothing
// in reach may render dimmer or smaller than it does at rest, and everything
// out of reach must render dimmer than both.

export const BACKGROUND = "#0d0f14";

/** Where a person stands relative to the current selection. */
export type Tier = "resting" | "seed" | "direct" | "reached" | "out";

export interface NodeStyle {
  fill: string;
  /** The ring. Non-laureates are hollow -- background fill, grey ring -- so
      they read as present and load-bearing without being dressed up as
      somebody who won something. */
  stroke: string | null;
  strokeWidth: number;
  radius: number;
  /** A faint circle drawn outside the dot, so the selection is findable in a
      hairball. Only the seed has one. */
  halo: string | null;
}

/**
 * Laureates. Gold throughout, because gold means laureate everywhere on this
 * page and a tier must never borrow another category's colour.
 *
 * `reached` matches `resting` in hue and beats it in size: selecting somebody
 * may never make a laureate you can still get to look like less than they did
 * before you clicked.
 */
const LAUREATE: Record<Tier, NodeStyle> = {
  resting: { fill: "#e8b552", stroke: null, strokeWidth: 0, radius: 2.6, halo: null },
  seed: { fill: "#ffffff", stroke: "#ffffff", strokeWidth: 1.4, radius: 6, halo: "#8b6f37" },
  direct: { fill: "#ffdc93", stroke: null, strokeWidth: 0, radius: 4.4, halo: null },
  reached: { fill: "#e8b552", stroke: null, strokeWidth: 0, radius: 3.1, halo: null },
  out: { fill: "#23262d", stroke: null, strokeWidth: 0, radius: 2.2, halo: null },
};

/**
 * Everyone else -- the teachers, parents and spouses who hold the tree
 * together. Hollow at every tier that is lit, so the shape says "not a
 * laureate" before the colour does.
 */
const OTHER: Record<Tier, NodeStyle> = {
  resting: { fill: BACKGROUND, stroke: "#6b7280", strokeWidth: 1.1, radius: 1.7, halo: null },
  seed: { fill: BACKGROUND, stroke: "#ffffff", strokeWidth: 1.6, radius: 6, halo: "#5b6472" },
  direct: { fill: BACKGROUND, stroke: "#e2e8f0", strokeWidth: 1.4, radius: 4.4, halo: null },
  reached: { fill: BACKGROUND, stroke: "#a9b2bf", strokeWidth: 1.2, radius: 2.2, halo: null },
  out: { fill: "#1e2128", stroke: null, strokeWidth: 0, radius: 1.6, halo: null },
};

export function tierOf(
  id: string,
  seed: string | null,
  direct: ReadonlySet<string>,
  reached: ReadonlySet<string>,
): Tier {
  if (seed === null) return "resting";
  if (id === seed) return "seed";
  if (direct.has(id)) return "direct";
  if (reached.has(id)) return "reached";
  return "out";
}

export function nodeStyle(laureate: boolean, tier: Tier): NodeStyle {
  return laureate ? LAUREATE[tier] : OTHER[tier];
}

export type EdgeTier = "resting" | "direct" | "reached" | "out";

export interface EdgeStyle {
  stroke: string;
  width: number;
}

const EDGE: Record<Exclude<EdgeTier, "out">, EdgeStyle> = {
  resting: { stroke: "#1c2029", width: 0.6 },
  reached: { stroke: "#7a6134", width: 0.7 },
  direct: { stroke: "#d9a94e", width: 1.3 },
};

/**
 * A relation is `direct` when the selected person is standing at one end of it,
 * `reached` when both ends are somewhere in their component, and `out` when it
 * belongs to a part of the graph this selection cannot get to. An `out` edge is
 * not drawn at all -- dimming it would only muddy the picture it is not part of.
 */
export function edgeTier(
  from: string,
  to: string,
  seed: string | null,
  reached: ReadonlySet<string>,
): EdgeTier {
  if (seed === null) return "resting";
  if (from === seed || to === seed) return "direct";
  const inReach = (id: string) => id === seed || reached.has(id);
  return inReach(from) && inReach(to) ? "reached" : "out";
}

export function edgeStyle(tier: Exclude<EdgeTier, "out">): EdgeStyle {
  return EDGE[tier];
}

/**
 * Painter's order for the two passes. It is load-bearing, not tidiness: 1684
 * dots overlap at this scale, so drawing them in id order lets an unreachable
 * dot paint over a lit one and eats the effect the click is meant to produce.
 * Lit things go last.
 */
export const NODE_ORDER: Tier[] = ["out", "resting", "reached", "direct", "seed"];
export const EDGE_ORDER: Exclude<EdgeTier, "out">[] = ["resting", "reached", "direct"];

/**
 * Perceived brightness of a hex colour, 0 to 1. Rec. 709 coefficients.
 *
 * Only spec/render.test.ts uses this, and that is the point: "the reached tier
 * is not dimmer than resting" is the claim that broke, so it needs to be a
 * number a test can compare rather than a judgement someone makes by squinting.
 */
export function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channel = (at: number) => parseInt(value.slice(at, at + 2), 16) / 255;
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
