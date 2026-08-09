// Computes a fixed layout for the graph and writes data/layout.json.
//
//   node layout-nobel.ts
//
// Run by hand after refresh-nobel.ts, never by a build. Two reasons the layout
// is precomputed rather than simulated in the browser:
//
//   1. A force simulation over a few thousand nodes janks on a phone, and the
//      artefact band names a slow connection and a mid-interaction resize as
//      the things that have to hold up.
//   2. This file gets committed, so it has to be reproducible. The PRNG is
//      seeded for exactly that reason -- `Math.random()` here would mean the
//      diff churned on every run and no test could ever assert a position.

import { readFileSync, writeFileSync } from "node:fs";
import { buildGraph, otherEnd } from "./graph.ts";
import type { Snapshot } from "./graph.ts";

const SEED = 20260809;
const ITERATIONS = 400;
const REPULSION = 0.0016;
const ATTRACTION = 0.02;
const CELL = 0.05; // repulsion is only computed within a neighbourhood this wide

/** mulberry32: small, fast, and identical on every machine. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const snapshot = JSON.parse(readFileSync("data/nobel.json", "utf8")) as Snapshot;
const graph = buildGraph(snapshot);
const ids = [...graph.people.keys()].sort(); // sorted so the run is order-independent
const index = new Map(ids.map((id, at) => [id, at]));
const n = ids.length;

const random = seeded(SEED);
const x = new Float64Array(n);
const y = new Float64Array(n);
for (let i = 0; i < n; i += 1) {
  // Start on a disc rather than a square: no corners for the simulation to
  // spend its first hundred iterations unpicking.
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * 0.5;
  x[i] = 0.5 + Math.cos(angle) * radius;
  y[i] = 0.5 + Math.sin(angle) * radius;
}

// Pin the largest hub near the centre so the picture does not drift off-frame.
let hub = 0;
for (let i = 0; i < n; i += 1) {
  const degree = graph.neighbours.get(ids[i]!)?.length ?? 0;
  if (degree > (graph.neighbours.get(ids[hub]!)?.length ?? 0)) hub = i;
}

const springs: [number, number][] = [];
for (const id of ids) {
  const from = index.get(id)!;
  for (const edge of graph.neighbours.get(id) ?? []) {
    const to = index.get(otherEnd(edge, id))!;
    if (from < to) springs.push([from, to]);
  }
}

const dx = new Float64Array(n);
const dy = new Float64Array(n);

for (let step = 0; step < ITERATIONS; step += 1) {
  dx.fill(0);
  dy.fill(0);

  // Repulsion, restricted to a spatial grid. Every pair would be O(n^2) per
  // iteration, which for a few thousand nodes is minutes; a neighbourhood is
  // visually indistinguishable because distant repulsion is negligible anyway.
  const cells = new Map<string, number[]>();
  for (let i = 0; i < n; i += 1) {
    const key = `${Math.floor(x[i]! / CELL)}:${Math.floor(y[i]! / CELL)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  }

  for (const [key, bucket] of cells) {
    const [cx, cy] = key.split(":").map(Number) as [number, number];
    const near: number[] = [];
    for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
      for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
        const other = cells.get(`${gx}:${gy}`);
        if (other) near.push(...other);
      }
    }
    for (const i of bucket) {
      for (const j of near) {
        if (i === j) continue;
        let ox = x[i]! - x[j]!;
        let oy = y[i]! - y[j]!;
        let d2 = ox * ox + oy * oy;
        if (d2 < 1e-9) {
          // Perfectly coincident nodes have no direction to push apart in.
          ox = (random() - 0.5) * 1e-4;
          oy = (random() - 0.5) * 1e-4;
          d2 = ox * ox + oy * oy;
        }
        const force = REPULSION / d2;
        const d = Math.sqrt(d2);
        dx[i] += (ox / d) * force;
        dy[i] += (oy / d) * force;
      }
    }
  }

  for (const [i, j] of springs) {
    const ox = x[j]! - x[i]!;
    const oy = y[j]! - y[i]!;
    const d = Math.hypot(ox, oy) || 1e-6;
    const pull = ATTRACTION * d;
    dx[i] += (ox / d) * pull;
    dy[i] += (oy / d) * pull;
    dx[j] -= (ox / d) * pull;
    dy[j] -= (oy / d) * pull;
  }

  // Cool down, so late iterations settle instead of sloshing.
  const heat = 0.02 * (1 - step / ITERATIONS) + 0.002;
  for (let i = 0; i < n; i += 1) {
    const d = Math.hypot(dx[i]!, dy[i]!) || 1e-9;
    const capped = Math.min(d, heat);
    x[i] += (dx[i]! / d) * capped;
    y[i] += (dy[i]! / d) * capped;
  }

  const ox = 0.5 - x[hub]!;
  const oy = 0.5 - y[hub]!;
  for (let i = 0; i < n; i += 1) {
    x[i] += ox;
    y[i] += oy;
  }
}

// Normalise into the unit square with a small margin, so the renderer only ever
// has to scale by the canvas size and never has to know about the simulation.
let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
for (let i = 0; i < n; i += 1) {
  minX = Math.min(minX, x[i]!);
  maxX = Math.max(maxX, x[i]!);
  minY = Math.min(minY, y[i]!);
  maxY = Math.max(maxY, y[i]!);
}
const span = Math.max(maxX - minX, maxY - minY) || 1;
const round = (value: number) => Math.round(value * 10000) / 10000;

const positions: Record<string, [number, number]> = {};
for (let i = 0; i < n; i += 1) {
  positions[ids[i]!] = [
    round(0.02 + ((x[i]! - minX) / span) * 0.96),
    round(0.02 + ((y[i]! - minY) / span) * 0.96),
  ];
}

writeFileSync(
  "data/layout.json",
  `${JSON.stringify({ seed: SEED, iterations: ITERATIONS, positions }, null, 0)}\n`,
);
console.log(`wrote data/layout.json: ${n} positions, seed ${SEED}`);
