import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../graph.ts";
import type { Snapshot } from "../graph.ts";
import { radiusFor, tierOf } from "../render.ts";
import { GAP, fitRadius, routeAround, screenOf, trimToEdge } from "../viewport.ts";
import type { Obstacle, View } from "../viewport.ts";

// Does a line ever touch somebody it has nothing to do with? Asked of the real
// graph, at real sizes, rather than of three circles on a number line.
//
// The pixel version of this question cannot answer it. At 1x there are 1682
// dots in an 821px box, so a ring sampled just outside any dot is full of ink
// belonging to its neighbours, and "a line is crossing me" and "somebody is
// standing next to me" look identical. Geometry can answer it: route every
// edge, then measure every point of every path against every node the path
// runs near.
//
// The first attempt at this feature painted a disc of background over each
// node after drawing the edges. That hides a crossing rather than removing it.
// This file is what makes the difference checkable.

const snapshot = JSON.parse(readFileSync(resolve("data/nobel.json"), "utf8")) as Snapshot;
const layout = JSON.parse(readFileSync(resolve("data/layout.json"), "utf8")) as {
  positions: Record<string, [number, number]>;
};
const graph = buildGraph(snapshot);
const ids = [...graph.people.keys()].filter((id) => layout.positions[id]);

const SIZE = { width: 913, height: 760 };
const side = Math.min(SIZE.width, SIZE.height);

/** Nearest neighbour in layout units, the same grid main.ts builds at load. */
const nearest = new Map<string, number>();
{
  const CELL = 0.01;
  const buckets = new Map<string, string[]>();
  for (const id of ids) {
    const [x, y] = layout.positions[id]!;
    const at = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    const bucket = buckets.get(at);
    if (bucket) bucket.push(id);
    else buckets.set(at, [id]);
  }
  for (const id of ids) {
    const [x, y] = layout.positions[id]!;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    let best = Infinity;
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (const other of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (other === id) continue;
          const [ox, oy] = layout.positions[other]!;
          const d = Math.hypot(x - ox, y - oy);
          if (d < best) best = d;
        }
      }
    }
    nearest.set(id, Number.isFinite(best) ? best : 1);
  }
}

/** Every node's screen position and drawn radius, exactly as the page has it. */
function place(view: View, seed: string | null) {
  const direct = new Set<string>();
  const reached = new Set<string>();
  const where = new Map<string, { x: number; y: number; radius: number }>();
  for (const id of ids) {
    const tier = tierOf(id, seed, direct, reached);
    const person = graph.people.get(id)!;
    const degree = graph.neighbours.get(id)?.length ?? 0;
    const [x, y] = screenOf(layout.positions[id]!, view, SIZE);
    const radius = fitRadius(
      radiusFor(degree, person.laureate, tier, "dark"),
      view.scale,
      nearest.get(id)! * side * view.scale,
    );
    where.set(id, { x, y, radius });
  }
  return where;
}

/** How many points of how many lines end up inside somebody they do not touch. */
function survey(view: View) {
  const where = place(view, null);
  let routed = 0;
  let intrusions = 0;
  let worst = 0;
  let worstEdge = "";

  for (const edge of graph.edges) {
    const a = where.get(edge.from);
    const b = where.get(edge.to);
    if (!a || !b) continue;

    const from = trimToEdge([a.x, a.y], [b.x, b.y], a.radius + GAP);
    const to = trimToEdge([b.x, b.y], [a.x, a.y], b.radius + GAP);

    // Everyone whose clear zone the straight line would have crossed.
    const blocking: Obstacle[] = [];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = dx * dx + dy * dy;
    for (const [id, node] of where) {
      if (id === edge.from || id === edge.to) continue;
      const keepOut = node.radius + GAP;
      if (Math.abs(node.x - from[0]) > length + keepOut) continue;
      const t =
        length < 1e-9
          ? 0
          : Math.max(0, Math.min(1, ((node.x - from[0]) * dx + (node.y - from[1]) * dy) / length));
      const d = Math.hypot(node.x - (from[0] + dx * t), node.y - (from[1] + dy * t));
      if (d < keepOut) blocking.push({ x: node.x, y: node.y, keepOut });
    }
    if (!blocking.length) continue;

    routed += 1;
    const path = routeAround(from, to, blocking);
    // The ends belong to this edge's own two nodes and are allowed to be where
    // they are; everything between them must be clear of everybody else.
    for (const point of path.slice(1, -1)) {
      for (const o of blocking) {
        const d = Math.hypot(point[0] - o.x, point[1] - o.y);
        if (d < o.keepOut - 1e-6) {
          intrusions += 1;
          if (o.keepOut - d > worst) {
            worst = o.keepOut - d;
            worstEdge = `${graph.people.get(edge.from)?.name} — ${graph.people.get(edge.to)?.name}`;
          }
        }
      }
    }
  }
  return { routed, intrusions, worst, worstEdge };
}

describe("no line touches a person it is not about", () => {
  for (const scale of [1, 4, 12, 40]) {
    it(`${scale}x: every routed line clears every node it passes`, () => {
      const result = survey({ scale, x: 0, y: 0 });
      expect(
        result.intrusions,
        `${result.intrusions} intrusion(s) across ${result.routed} routed lines; ` +
          `deepest ${result.worst.toFixed(2)}px on ${result.worstEdge}`,
      ).toBe(0);
    });
  }

  it("has something to route at all, or the assertions above are empty", () => {
    // If the straight lines never crossed anybody there would be nothing to
    // prove, and a change that broke the routing would still pass.
    expect(survey({ scale: 1, x: 0, y: 0 }).routed).toBeGreaterThan(50);
  });
});
