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
export const MAX_SCALE = 12;

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
