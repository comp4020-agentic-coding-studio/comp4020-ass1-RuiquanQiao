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
//
// The picture is composed, not just simulated. A first version threw all 1684
// people into one simulation and got an evenly spaced field of dots: the 247
// laureates with no recorded relation have no springs holding them anywhere, so
// they diluted the tree into a halftone pattern and the structure disappeared.
// They are not part of the tree, and drawing them as though they were made the
// picture say nothing. Now the main component gets the middle and everything
// else sits outside it, which is the honest arrangement and also the legible
// one: a dense mass, and a scatter of dots that connect to nothing.

import { readFileSync, writeFileSync } from "node:fs";
import { buildGraph, components, otherEnd } from "./graph.ts";
import type { Snapshot } from "./graph.ts";

const SEED = 20260809;
const ITERATIONS = 500;
const CORE_RADIUS = 0.34; // the main component fills this disc
const RING_INNER = 0.4; // everything unattached to it sits beyond here

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

const random = seeded(SEED);
const snapshot = JSON.parse(readFileSync("data/nobel.json", "utf8")) as Snapshot;
const graph = buildGraph(snapshot);
const groups = components(graph);
const main = groups[0] ?? [];
const rest = groups.slice(1);

console.log(`main component: ${main.length}; other groups: ${rest.length}`);

// --- force layout, main component only --------------------------------------
// Fruchterman-Reingold. The earlier version normalised each node's displacement
// to a fixed step, so every node moved exactly the same distance every tick
// regardless of the force on it -- which is precisely how you build a lattice.
// Here displacement is proportional to force and merely *capped* by the
// temperature, so a node in a tight cluster settles while a loose one travels.

const n = main.length;
const index = new Map(main.map((id, at) => [id, at]));
const x = new Float64Array(n);
const y = new Float64Array(n);

for (let i = 0; i < n; i += 1) {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * 0.45;
  x[i] = 0.5 + Math.cos(angle) * radius;
  y[i] = 0.5 + Math.sin(angle) * radius;
}

const springs: [number, number][] = [];
for (const id of main) {
  const from = index.get(id)!;
  for (const edge of graph.neighbours.get(id) ?? []) {
    const to = index.get(otherEnd(edge, id));
    if (to !== undefined && from < to) springs.push([from, to]);
  }
}

const k = Math.sqrt(1 / Math.max(n, 1)) * 0.9; // ideal edge length
const dx = new Float64Array(n);
const dy = new Float64Array(n);

for (let step = 0; step < ITERATIONS; step += 1) {
  dx.fill(0);
  dy.fill(0);

  // Every pair, no spatial index.
  //
  // The first version bucketed nodes into 0.06-wide cells and only repelled
  // within a 3x3 neighbourhood. With an ideal edge length of about 0.027 that
  // cutoff sits right where the force still matters, so the truncation acted as
  // a periodic potential and the core came out as a visible lattice -- neat
  // rows and columns of dots that looked like halftone, not like a genealogy.
  // At 1143 nodes the exact calculation costs a couple of seconds in a script
  // that runs by hand, which is a bargain for a picture that is not a lie about
  // the shape of the data.
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      let ox = x[i]! - x[j]!;
      let oy = y[i]! - y[j]!;
      let d = Math.hypot(ox, oy);
      if (d < 1e-6) {
        ox = (random() - 0.5) * 1e-3;
        oy = (random() - 0.5) * 1e-3;
        d = Math.hypot(ox, oy);
      }
      const force = (k * k) / d;
      const ux = (ox / d) * force;
      const uy = (oy / d) * force;
      dx[i] += ux;
      dy[i] += uy;
      dx[j] -= ux;
      dy[j] -= uy;
    }
  }

  for (const [i, j] of springs) {
    const ox = x[j]! - x[i]!;
    const oy = y[j]! - y[i]!;
    const d = Math.hypot(ox, oy) || 1e-6;
    const force = (d * d) / k;
    dx[i] += (ox / d) * force;
    dy[i] += (oy / d) * force;
    dx[j] -= (ox / d) * force;
    dy[j] -= (oy / d) * force;
  }

  // Weak pull to the centre keeps loosely-attached branches from drifting off,
  // without which the normalisation at the end squashes the core to nothing.
  for (let i = 0; i < n; i += 1) {
    dx[i] += (0.5 - x[i]!) * 0.35;
    dy[i] += (0.5 - y[i]!) * 0.35;
  }

  const heat = 0.06 * (1 - step / ITERATIONS) ** 1.5 + 0.0008;
  for (let i = 0; i < n; i += 1) {
    x[i] += Math.max(-heat, Math.min(heat, dx[i]!));
    y[i] += Math.max(-heat, Math.min(heat, dy[i]!));
  }
}

// Normalise the core into a disc rather than a square, so the ring outside it
// reads as "outside the tree" at every viewport shape.
let cx = 0;
let cy = 0;
for (let i = 0; i < n; i += 1) {
  cx += x[i]!;
  cy += y[i]!;
}
cx /= n || 1;
cy /= n || 1;

let reach = 1e-9;
for (let i = 0; i < n; i += 1) {
  reach = Math.max(reach, Math.hypot(x[i]! - cx, y[i]! - cy));
}
const scale = CORE_RADIUS / reach;

const positions: Record<string, [number, number]> = {};
const round = (value: number) => Math.round(value * 10000) / 10000;
for (let i = 0; i < n; i += 1) {
  positions[main[i]!] = [round(0.5 + (x[i]! - cx) * scale), round(0.5 + (y[i]! - cy) * scale)];
}

// --- everything that is not in the main component ---------------------------
// Placed on a golden-angle spiral in the band outside the core: deterministic,
// evenly spread, and visibly not part of the mass in the middle. Members of the
// same small group are nudged together so a 14-person lineage reads as a
// cluster rather than as scattered noise.

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const outside = rest.length;
rest.forEach((group, at) => {
  const angle = at * GOLDEN;
  const radial = RING_INNER + (0.5 - RING_INNER) * Math.sqrt((at + 0.5) / Math.max(outside, 1));
  const gx = 0.5 + Math.cos(angle) * radial;
  const gy = 0.5 + Math.sin(angle) * radial;
  const spread = 0.004 + Math.min(group.length, 20) * 0.0016;
  group.forEach((id, member) => {
    const memberAngle = member * GOLDEN;
    const memberRadius = group.length === 1 ? 0 : spread * Math.sqrt((member + 0.5) / group.length);
    positions[id] = [
      round(gx + Math.cos(memberAngle) * memberRadius),
      round(gy + Math.sin(memberAngle) * memberRadius),
    ];
  });
});

writeFileSync(
  "data/layout.json",
  `${JSON.stringify({ seed: SEED, iterations: ITERATIONS, core: CORE_RADIUS, positions }, null, 0)}\n`,
);
console.log(`wrote data/layout.json: ${Object.keys(positions).length} positions, seed ${SEED}`);
