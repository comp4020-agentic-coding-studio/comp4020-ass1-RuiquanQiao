import { describe, expect, it } from "vitest";
import {
  GAP,
  HOME,
  MAX_DOT,
  MAX_SCALE,
  MIN_SCALE,
  PORTRAIT_RADIUS,
  clampView,
  dotRadius,
  fitRadius,
  graphOf,
  onScreen,
  panBy,
  screenOf,
  showsPortrait,
  zoomAt,
} from "../viewport.ts";
import type { Size, View } from "../viewport.ts";

// The transform, both directions.
//
// The failure this file is here to prevent is a quiet one. If the draw loop and
// the hit test ever disagree about where a node is, clicking a face selects the
// person beside them and the page looks completely fine while lying about who
// is related to whom. There is one transform and these are its promises.

const DESKTOP: Size = { width: 1064, height: 821 };
const PHONE: Size = { width: 358, height: 358 };
const WIDE: Size = { width: 1200, height: 400 };

const SIZES: [string, Size][] = [
  ["desktop", DESKTOP],
  ["phone", PHONE],
  ["wide", WIDE],
];

const POINTS: [number, number][] = [
  [0, 0],
  [0.5, 0.5],
  [1, 1],
  [0.23, 0.81],
  [0.99, 0.02],
];

describe("the transform round-trips", () => {
  for (const [name, size] of SIZES) {
    for (const view of [HOME, { scale: 3.7, x: -420, y: -260 }, { scale: 12, x: -900, y: -700 }]) {
      it(`${name} at ${view.scale}x returns every point it was given`, () => {
        for (const point of POINTS) {
          const back = graphOf(screenOf(point, view, size), view, size);
          expect(back[0]).toBeCloseTo(point[0], 9);
          expect(back[1]).toBeCloseTo(point[1], 9);
        }
      });
    }
  }

  it("puts the layout in a centred square, so a wide box does not stretch it", () => {
    // The marker resizes mid-interaction and the canvas is not always square.
    const a = screenOf([0, 0], HOME, WIDE);
    const b = screenOf([1, 1], HOME, WIDE);
    expect(b[0] - a[0]).toBeCloseTo(b[1] - a[1], 9);
    expect(b[1] - a[1]).toBeCloseTo(Math.min(WIDE.width, WIDE.height), 9);
  });

  it("is unchanged from the pre-zoom placement at rest", () => {
    // What the page did before this file existed, kept as an assertion so the
    // default view is not quietly re-framed by adding a zoom feature.
    const side = Math.min(DESKTOP.width, DESKTOP.height);
    const left = (DESKTOP.width - side) / 2;
    const top = (DESKTOP.height - side) / 2;
    expect(screenOf([0.25, 0.75], HOME, DESKTOP)).toEqual([
      left + 0.25 * side,
      top + 0.75 * side,
    ]);
  });
});

describe("zooming holds on to what you pointed at", () => {
  for (const [name, size] of SIZES) {
    it(`${name}: the graph point under the cursor does not move`, () => {
      const anchor: [number, number] = [size.width * 0.31, size.height * 0.66];
      let view: View = HOME;
      const before = graphOf(anchor, view, size);
      for (const factor of [1.2, 1.2, 1.2, 0.9, 1.5]) {
        view = zoomAt(view, factor, anchor, size);
        const after = graphOf(anchor, view, size);
        expect(after[0]).toBeCloseTo(before[0], 6);
        expect(after[1]).toBeCloseTo(before[1], 6);
      }
      expect(view.scale).toBeGreaterThan(1);
    });
  }

  it("still holds the anchor when the clamp bites", () => {
    // Requesting 100x when the ceiling is 12 must not shear the picture: the
    // realised factor, not the requested one, is what the pan correction uses.
    const anchor: [number, number] = [700, 300];
    const view = zoomAt(HOME, 100, anchor, DESKTOP);
    expect(view.scale).toBe(MAX_SCALE);
    const before = graphOf(anchor, HOME, DESKTOP);
    const after = graphOf(anchor, view, DESKTOP);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it("refuses to zoom out past the whole picture, or in past the ceiling", () => {
    expect(zoomAt(HOME, 0.01, [500, 400], DESKTOP).scale).toBe(MIN_SCALE);
    expect(clampView({ scale: 99, x: 0, y: 0 }, DESKTOP).scale).toBe(MAX_SCALE);
    expect(clampView({ scale: 0.01, x: 0, y: 0 }, DESKTOP).scale).toBe(MIN_SCALE);
  });
});

describe("panning cannot strand the reader on empty canvas", () => {
  it("is pinned at rest, because there is nowhere to go", () => {
    const view = panBy(HOME, -400, 300, DESKTOP);
    expect(view).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("keeps the picture covering the box at every zoom", () => {
    for (const scale of [1.5, 4, 12]) {
      for (const [dx, dy] of [
        [-9999, -9999],
        [9999, 9999],
        [3000, -3000],
      ]) {
        const view = panBy({ scale, x: 0, y: 0 }, dx!, dy!, DESKTOP);
        expect(view.x).toBeLessThanOrEqual(0);
        expect(view.y).toBeLessThanOrEqual(0);
        expect(view.x + DESKTOP.width * scale).toBeGreaterThanOrEqual(DESKTOP.width - 1e-9);
        expect(view.y + DESKTOP.height * scale).toBeGreaterThanOrEqual(DESKTOP.height - 1e-9);
      }
    }
  });
});

describe("when a dot becomes a face", () => {
  it("grows dots with the zoom, then stops", () => {
    expect(dotRadius(2.6, 1)).toBeCloseTo(2.6, 9);
    expect(dotRadius(2.6, 4)).toBeCloseTo(10.4, 9);
    expect(dotRadius(2.6, 100)).toBe(MAX_DOT);
    // The cap is not arbitrary: the source thumbnail is 96px, so past roughly
    // this size there is nothing further to reveal.
    expect(MAX_DOT * 2).toBeLessThanOrEqual(96);
  });

  it("decides on rendered pixels, never on the zoom level", () => {
    // The same threshold has to behave the same on a phone and a desktop, and
    // the scale that makes a dot 13px wide is not the same number on the two.
    expect(showsPortrait(PORTRAIT_RADIUS)).toBe(true);
    expect(showsPortrait(PORTRAIT_RADIUS - 0.01)).toBe(false);
    expect(showsPortrait(dotRadius(2.6, 2))).toBe(false);
    expect(showsPortrait(dotRadius(2.6, MAX_SCALE))).toBe(true);
  });

  it("shows a face for a selected person sooner than for a stranger", () => {
    // Seeds are drawn at 6 and resting laureates at 2.6, so the person you
    // clicked resolves first. That is the right way round.
    const scaleFor = (base: number) => PORTRAIT_RADIUS / base;
    expect(scaleFor(6)).toBeLessThan(scaleFor(2.6));
    expect(scaleFor(6)).toBeLessThan(MAX_SCALE);
  });
});

describe("two dots can never touch", () => {
  // Overlap is not cosmetic on this page. Two faces touching reads as a
  // relationship, and a relationship here is a claim about two real people --
  // the same reason an edge is not allowed to pass through a node it does not
  // connect to. So the radius is capped at half the distance to the nearest
  // neighbour, less the gap, and that is a geometric guarantee rather than a
  // constant somebody tuned until it looked right.
  it("shrinks both dots rather than letting them meet, at any distance", () => {
    for (const nearest of [0.4, 1, 4, 10, 26, 60, 400, 4000]) {
      const r = fitRadius(6, MAX_SCALE, nearest);
      // Two circles of this radius, centres `nearest` apart, must not touch.
      expect(2 * r, `${nearest}px apart`).toBeLessThanOrEqual(nearest + 1e-9);
    }
  });

  it("leaves a visible gap once there is any room to leave one", () => {
    for (const nearest of [26, 60, 400]) {
      const r = fitRadius(6, MAX_SCALE, nearest);
      expect(2 * r + 2 * GAP, `${nearest}px apart`).toBeLessThanOrEqual(nearest + 1e-9);
    }
  });

  it("keeps ordinary dots at their intended size, so the cap is not felt", () => {
    // The median pair in data/layout.json is 0.0092 apart, which is 7.6px at
    // 1x on an 821px canvas -- comfortably more than twice a 2.6px laureate.
    expect(fitRadius(2.6, 1, 7.6)).toBeCloseTo(2.6, 6);
  });

  it("still lets a dot reach portrait size when there is room", () => {
    expect(showsPortrait(fitRadius(2.6, MAX_SCALE, 200))).toBe(true);
  });

  // The ceiling exists because of this: the closest pair in data/layout.json
  // is 1.2e-3 apart in layout units, which on an 821px canvas is 30px at 40x
  // and only 12px at the old ceiling of 12x. Two 13px faces cannot both fit in
  // 12px, so no amount of zooming used to separate them.
  it("is high enough for the closest pair in the real layout", () => {
    const closest = 1.2e-3;
    const side = 821;
    const apart = closest * side * MAX_SCALE;
    expect(apart).toBeGreaterThan(2 * PORTRAIT_RADIUS + 2 * GAP);
  });
});

describe("culling", () => {
  it("keeps what is on screen and drops what is far off it", () => {
    expect(onScreen([10, 10], DESKTOP)).toBe(true);
    expect(onScreen([-40, 400], DESKTOP)).toBe(false);
    expect(onScreen([-40, 400], DESKTOP, 60)).toBe(true);
    expect(onScreen([DESKTOP.width + 1, 0], DESKTOP)).toBe(false);
  });
});
