// Reports where a straight line would pass through somebody it is not about.
//
//   node check-occlusion.ts
//
// Reads data/layout.json and data/nobel.json and says, for each viewport that
// matters and each selection state, how many relations cross a node they have
// nothing to do with. The layout script optimises against this and the spec
// asserts against it; this is the same measurement in a form you can run and
// read.
//
// Clearance is computed with the renderer's own formula, not an approximation
// of it, because a report that measures something slightly different from what
// is drawn is worse than no report.

import { readFileSync } from "node:fs";
import { buildGraph } from "./graph.ts";
import type { Snapshot } from "./graph.ts";
import { radiusFor } from "./render.ts";
import type { Tier } from "./render.ts";
import { TOUCH, fitRadius } from "./viewport.ts";
import { crossings, describe } from "./occlusion.ts";
import type { Link, Placed } from "./occlusion.ts";

const snapshot = JSON.parse(readFileSync("data/nobel.json", "utf8")) as Snapshot;
const layout = JSON.parse(readFileSync("data/layout.json", "utf8")) as {
  positions: Record<string, [number, number]>;
};
const graph = buildGraph(snapshot);
const ids = [...graph.people.keys()].filter((id) => layout.positions[id]);
const at = new Map(ids.map((id, i) => [id, i]));

/** Nearest neighbour in layout units, the same grid main.ts builds at load. */
export function nearestNeighbours(
  positions: Record<string, [number, number]>,
  order: string[],
): Map<string, number> {
  const CELL = 0.01;
  const buckets = new Map<string, string[]>();
  for (const id of order) {
    const [x, y] = positions[id]!;
    const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(id);
    else buckets.set(key, [id]);
  }
  const out = new Map<string, number>();
  for (const id of order) {
    const [x, y] = positions[id]!;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    let best = Infinity;
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (const other of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (other === id) continue;
          const [ox, oy] = positions[other]!;
          const d = Math.hypot(x - ox, y - oy);
          if (d < best) best = d;
        }
      }
    }
    out.set(id, Number.isFinite(best) ? best : 1);
  }
  return out;
}

/**
 * How far a line has to stay from this person, in layout units.
 *
 * Exactly what the renderer will draw: the tier's radius, capped by half the
 * distance to the nearest neighbour, plus the gap -- all divided back out of
 * the canvas so the answer is scale-free. Both terms scale with the zoom below
 * the 26px ceiling, so solving this at scale 1 solves it at every zoom; above
 * the ceiling the dots stop growing while the distances keep going, which only
 * makes it easier.
 */
export function clearanceOf(
  degree: number,
  laureate: boolean,
  nearest: number,
  side: number,
  tier: Tier,
): number {
  const radius = fitRadius(radiusFor(degree, laureate, tier, "dark"), 1, nearest * side);
  return (radius + TOUCH) / side;
}

export function placeAll(
  positions: Record<string, [number, number]>,
  order: string[],
  side: number,
  tier: Tier,
): Placed[] {
  const nearest = nearestNeighbours(positions, order);
  return order.map((id) => {
    const [x, y] = positions[id]!;
    return {
      x,
      y,
      clearance: clearanceOf(
        graph.neighbours.get(id)?.length ?? 0,
        graph.people.get(id)!.laureate,
        nearest.get(id)!,
        side,
        tier,
      ),
    };
  });
}

export const links: Link[] = graph.edges
  .filter((edge) => at.has(edge.from) && at.has(edge.to))
  .map((edge) => ({ from: at.get(edge.from)!, to: at.get(edge.to)! }));

if (process.argv[1]?.endsWith("check-occlusion.ts")) {
  console.log(`${ids.length} people, ${links.length} relations\n`);
  // 390 and 1920 are the two viewports this is marked at. The narrow one is
  // stricter: a dot is the same number of pixels either way, so it takes up
  // more of a 358px canvas than of an 821px one.
  for (const [label, side] of [
    ["390 phone (canvas 358px)", 358],
    ["1920 desktop (canvas 821px)", 821],
  ] as const) {
    console.log(label);
    for (const tier of ["resting", "reached", "direct", "seed"] as Tier[]) {
      const found = crossings(placeAll(layout.positions, ids, side, tier), links);
      console.log(`  ${tier.padEnd(8)} ${describe(found, links.length)}`);
    }
    console.log("");
  }
}
