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
// The theme is a parameter here for the same reason. It is never a branch
// inside draw() and never read back out of the DOM: a table indexed by theme
// is a thing spec/render.test.ts can check both halves of.
//
// Note what changed when the light theme arrived. The invariant used to be
// "nothing in reach may render *dimmer* than at rest", and on paper that is
// exactly backwards -- lit means darker on a light background. The claim that
// survives both themes is about **contrast against the background**, which is
// also the claim that was meant all along.

export type Theme = "dark" | "light";

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

const PAGE: Record<Theme, string> = {
  dark: "#0d0f14",
  light: "#faf7f2",
};

export function background(theme: Theme): string {
  return PAGE[theme];
}

/**
 * Laureates. Gold in both themes, because gold means laureate everywhere on
 * this page and no tier and no theme may borrow another category's colour.
 * Light mode darkens it rather than replacing it -- #e8b552 on paper is a
 * 1.9:1 smear, and swapping the hue would break the one thing the colour says.
 *
 * `reached` matches `resting` in hue and beats it in size in both themes:
 * selecting somebody may never make a laureate you can still get to look like
 * less than they did before you clicked.
 */
const LAUREATE: Record<Theme, Record<Tier, NodeStyle>> = {
  dark: {
    resting: { fill: "#e8b552", stroke: null, strokeWidth: 0, radius: 2.6, halo: null },
    seed: { fill: "#ffffff", stroke: "#ffffff", strokeWidth: 1.4, radius: 6, halo: "#8b6f37" },
    direct: { fill: "#ffdc93", stroke: null, strokeWidth: 0, radius: 4.4, halo: null },
    reached: { fill: "#e8b552", stroke: null, strokeWidth: 0, radius: 3.1, halo: null },
    out: { fill: "#23262d", stroke: null, strokeWidth: 0, radius: 2.2, halo: null },
  },
  light: {
    resting: { fill: "#8a5f00", stroke: null, strokeWidth: 0, radius: 2.6, halo: null },
    seed: { fill: "#1b1f26", stroke: "#1b1f26", strokeWidth: 1.4, radius: 6, halo: "#b08a3a" },
    direct: { fill: "#5c3f00", stroke: null, strokeWidth: 0, radius: 4.4, halo: null },
    reached: { fill: "#8a5f00", stroke: null, strokeWidth: 0, radius: 3.1, halo: null },
    out: { fill: "#e0dacd", stroke: null, strokeWidth: 0, radius: 2.2, halo: null },
  },
};

/**
 * Everyone else -- the teachers, parents and spouses who hold the tree
 * together. Hollow at every tier that is lit, in both themes, so the shape
 * says "not a laureate" before the colour does.
 */
const OTHER: Record<Theme, Record<Tier, NodeStyle>> = {
  dark: {
    resting: { fill: PAGE.dark, stroke: "#6b7280", strokeWidth: 1.1, radius: 1.7, halo: null },
    seed: { fill: PAGE.dark, stroke: "#ffffff", strokeWidth: 1.6, radius: 6, halo: "#5b6472" },
    direct: { fill: PAGE.dark, stroke: "#e2e8f0", strokeWidth: 1.4, radius: 4.4, halo: null },
    reached: { fill: PAGE.dark, stroke: "#a9b2bf", strokeWidth: 1.2, radius: 2.2, halo: null },
    out: { fill: "#1e2128", stroke: null, strokeWidth: 0, radius: 1.6, halo: null },
  },
  light: {
    resting: { fill: PAGE.light, stroke: "#8c93a1", strokeWidth: 1.1, radius: 1.7, halo: null },
    seed: { fill: PAGE.light, stroke: "#1b1f26", strokeWidth: 1.6, radius: 6, halo: "#9aa1ad" },
    direct: { fill: PAGE.light, stroke: "#1f2530", strokeWidth: 1.4, radius: 4.4, halo: null },
    reached: { fill: PAGE.light, stroke: "#4a5260", strokeWidth: 1.2, radius: 2.2, halo: null },
    out: { fill: "#ebe6dc", stroke: null, strokeWidth: 0, radius: 1.6, halo: null },
  },
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

export function nodeStyle(laureate: boolean, tier: Tier, theme: Theme): NodeStyle {
  return (laureate ? LAUREATE : OTHER)[theme][tier];
}

export type EdgeTier = "resting" | "direct" | "reached" | "out";

export interface EdgeStyle {
  stroke: string;
  width: number;
}

const EDGE: Record<Theme, Record<Exclude<EdgeTier, "out">, EdgeStyle>> = {
  dark: {
    resting: { stroke: "#1c2029", width: 0.6 },
    reached: { stroke: "#7a6134", width: 0.7 },
    direct: { stroke: "#d9a94e", width: 1.3 },
  },
  light: {
    resting: { stroke: "#e2dbcb", width: 0.6 },
    reached: { stroke: "#b1904f", width: 0.7 },
    direct: { stroke: "#7a5400", width: 1.3 },
  },
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

export function edgeStyle(tier: Exclude<EdgeTier, "out">, theme: Theme): EdgeStyle {
  return EDGE[theme][tier];
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
 * WCAG relative luminance, 0 to 1. sRGB linearised, not the raw channels.
 *
 * Three-digit shorthand is expanded because stylelint's `color-hex-length`
 * rewrites `#ffffff` to `#fff` in the stylesheet, and spec/theme.test.ts reads
 * those declared values straight out of the file to measure them.
 */
export function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? [...value].map((digit) => digit + digit).join("") : value;
  const channel = (at: number) => {
    const raw = parseInt(full.slice(at, at + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * WCAG contrast ratio between two colours, 1 to 21.
 *
 * This is the unit the canvas invariant is stated in, and it has to be:
 * "brighter" inverts between the two themes and "more contrast" does not. It
 * is also the unit spec/theme.test.ts holds the text colours to, so one
 * function answers both questions.
 */
export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}
