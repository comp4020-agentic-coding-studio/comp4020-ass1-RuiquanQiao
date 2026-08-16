// Where a point in the layout lands on the screen, and how to get back.
//
// Same shape as render.ts and for the same reason: appearance and geometry
// both used to live inside draw(), where jsdom has no canvas and no test can
// reach them. The bug that taught this repo the lesson was a colour; the one
// this file exists to prevent is worse, because it is silent. If drawing used
// one transform and hit-testing used another, clicking a face would select the
// person next to them and nothing would look wrong.
//
// So there is exactly one transform, it is a pure function, and both the draw
// loop and `nearest()` go through it.

export interface View {
  /** 1 is the whole graph in the box. Above that, magnified. */
  scale: number;
  /** Pan, in screen pixels, applied after scaling. */
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const HOME: View = { scale: 1, x: 0, y: 0 };

export const MIN_SCALE = 1;

/**
 * 40, not 12, and the number is measured rather than chosen.
 *
 * The closest pair of nodes in the layout sits 1.2e-3 apart in layout units.
 * At 12x that is 12px between their centres, so two faces drawn at 13px each
 * necessarily overlapped and no amount of zooming could separate them. At 40x
 * every one of the 1682 nodes is at least 30px from its nearest neighbour --
 * room for two portraits and a gap. Zooming further always separates a pair,
 * which is what a zoom is for.
 */
export const MAX_SCALE = 40;

/** Clear space kept between two adjacent dots. */
export const GAP = 2.5;

/**
 * What a line must clear to count as not touching a dot: the dot, plus half
 * the widest stroke so the line's own thickness does not reach it.
 *
 * Deliberately *not* GAP. Requiring a line to stay 2.5px clear of every dot is
 * geometrically impossible here and that was measured, not guessed: at the
 * phone canvas the clear zones would cover 103% of the core disc, so there is
 * no route for any line anywhere. The rule that can be kept is the rule that
 * was asked for -- a line does not touch a node it is not about.
 */
export const TOUCH = 0.65;

/**
 * How much of the space to a neighbour a dot may claim.
 *
 * A third, not a half. Half guarantees two dots never overlap and nothing
 * else; a third leaves a corridor between every pair wide enough for a
 * straight line to pass without touching either, which is what makes a
 * crossing-free layout possible at all. In the dense core this is what binds,
 * and the dots there are a pixel wide either way.
 */
export const CROWDING = 3;

/**
 * Dots grow with the zoom, but not forever.
 *
 * Linear growth is what "zoom" means and what a map trains people to expect.
 * The cap exists because past about 26px a laureate is a portrait, and making
 * the portrait bigger stops adding information -- the source thumbnail is 96px
 * and there is nothing underneath to reveal.
 */
export const MAX_DOT = 26;

/** A dot wide enough to be a face rather than a smudge. */
export const PORTRAIT_RADIUS = 13;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** The side of the square the layout is drawn into, centred in the box. */
function square(size: Size): { side: number; left: number; top: number } {
  const side = Math.min(size.width, size.height);
  return { side, left: (size.width - side) / 2, top: (size.height - side) / 2 };
}

/**
 * Pan is bounded so the canvas can never show empty space beside the picture.
 *
 * At scale 1 this pins the view to the origin, which is correct: there is
 * nothing to pan to, and letting somebody drag the whole graph off the edge
 * and be left with a blank rectangle is a way to make a page look broken.
 */
export function clampView(view: View, size: Size): View {
  const scale = clamp(view.scale, MIN_SCALE, MAX_SCALE);
  return {
    scale,
    x: clamp(view.x, size.width * (1 - scale), 0),
    y: clamp(view.y, size.height * (1 - scale), 0),
  };
}

/** Layout coordinates (0..1 in both axes) to screen pixels. */
export function screenOf(point: readonly [number, number], view: View, size: Size): [number, number] {
  const { side, left, top } = square(size);
  return [
    (left + point[0] * side) * view.scale + view.x,
    (top + point[1] * side) * view.scale + view.y,
  ];
}

/** Screen pixels back to layout coordinates. The exact inverse of screenOf. */
export function graphOf(screen: readonly [number, number], view: View, size: Size): [number, number] {
  const { side, left, top } = square(size);
  return [
    ((screen[0] - view.x) / view.scale - left) / side,
    ((screen[1] - view.y) / view.scale - top) / side,
  ];
}

/**
 * Zoom by `factor` while the graph point under `anchor` stays under `anchor`.
 *
 * This is the whole difference between a zoom that feels like a map and one
 * that feels like a slot machine. Zooming about the centre instead throws away
 * whatever the reader was pointing at, which on a 1684-node hairball means
 * they lose their place every time they scroll.
 */
export function zoomAt(
  view: View,
  factor: number,
  anchor: readonly [number, number],
  size: Size,
): View {
  const wanted = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  // The realised factor, which is not the requested one once the clamp bites.
  const applied = wanted / view.scale;
  return clampView(
    {
      scale: wanted,
      x: anchor[0] - (anchor[0] - view.x) * applied,
      y: anchor[1] - (anchor[1] - view.y) * applied,
    },
    size,
  );
}

/** Pan by a screen-pixel delta. */
export function panBy(view: View, dx: number, dy: number, size: Size): View {
  return clampView({ scale: view.scale, x: view.x + dx, y: view.y + dy }, size);
}

export function dotRadius(base: number, scale: number): number {
  return Math.min(base * scale, MAX_DOT);
}

/**
 * The radius a dot may actually use, given how close its nearest neighbour is.
 *
 * Two portraits that overlap are worse than two small ones: an overlap reads
 * as a relationship, and on this page a relationship is a claim about real
 * people. So a dot never grows past half the distance to whoever is nearest,
 * less the gap. It is a hard geometric guarantee rather than a tuned constant
 * -- if two dots would touch, both shrink until they do not.
 *
 * `nearestPx` is the screen distance to the closest other node. At low zoom
 * that bites often; by 40x it never does, which is why the ceiling is there.
 */
export function fitRadius(base: number, scale: number, nearestPx: number): number {
  // A third of the way to the neighbour, so the corridor between any two dots
  // stays wide enough for a line to pass through untouched. There is no floor:
  // two nodes a pixel apart draw as sub-pixel specks, are indistinguishable at
  // that distance anyway, and separate as you zoom.
  return Math.min(dotRadius(base, scale), Math.max(0, nearestPx / CROWDING));
}

/**
 * Whether a dot this big should be drawn as a portrait.
 *
 * Keyed on the radius actually rendered, never on the zoom level, so it
 * behaves the same on a 390px phone as on a 1920px desktop -- the scale needed
 * to make a dot 13px wide is not the same number on the two, and a threshold
 * written as "scale >= 5" would put faces on one and not the other.
 */
export function showsPortrait(radiusPx: number): boolean {
  return radiusPx >= PORTRAIT_RADIUS;
}

/** Where a line should start so it leaves its own node's edge, not its centre. */
export function trimToEdge(
  from: readonly [number, number],
  to: readonly [number, number],
  radius: number,
): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return [from[0], from[1]];
  const t = Math.min(radius / length, 0.45);
  return [from[0] + dx * t, from[1] + dy * t];
}

/** Is this screen point worth drawing or loading an image for? */
export function onScreen(
  screen: readonly [number, number],
  size: Size,
  margin = 0,
): boolean {
  return (
    screen[0] >= -margin &&
    screen[1] >= -margin &&
    screen[0] <= size.width + margin &&
    screen[1] <= size.height + margin
  );
}
