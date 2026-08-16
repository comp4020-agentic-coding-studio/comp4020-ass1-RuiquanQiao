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
import { crossings, describe, toSegment } from "./occlusion.ts";
import type { Placed } from "./occlusion.ts";
import { radiusFor } from "./render.ts";
import { TOUCH, fitRadius } from "./viewport.ts";
import type { Snapshot } from "./graph.ts";

const SEED = 20260809;
const SEPARATE_LOG_EVERY = 250;
const CORE_RADIUS = 0.42; // the main component fills this disc
const RING_INNER = 0.45; // everything unattached to it sits beyond here

const snapshot = JSON.parse(readFileSync("data/nobel.json", "utf8")) as Snapshot;
const graph = buildGraph(snapshot);
const groups = components(graph);
const main = groups[0] ?? [];
const rest = groups.slice(1);

console.log(`main component: ${main.length}; other groups: ${rest.length}`);

// --- radial tree, main component only ---------------------------------------
//
// This used to be Fruchterman-Reingold, and the picture it made was a hairball.
// A hairball cannot satisfy the rule that a straight line never touches a node
// it is not attached to, and that is not an opinion -- at the phone canvas the
// clear zones around 1143 nodes in a disc of radius 0.34 covered 103% of it.
// There was no route for any line anywhere, and four thousand iterations of a
// separation force confirmed it by flattening out at 884 crossings.
//
// What makes it solvable is what the data actually is. The main component has
// 1143 people and 1335 relations: 1142 of those would be a tree, so only 193
// are extra. Laid out radially -- depth sets the radius, and every subtree owns
// a wedge of angle nobody else uses -- a tree edge runs from one ring to the
// next inside its own wedge, through an annulus with nothing in it. Those 1142
// cannot cross anybody by construction. Only the 193 chords can, and 193 is a
// number a separation pass can actually finish.
//
// It also happens to be the honest shape for the thing: this is an academic
// genealogy, and a genealogy is a tree.

const n = main.length;
const index = new Map(main.map((id, at) => [id, at]));
const x = new Float64Array(n);
const y = new Float64Array(n);

const springs: [number, number][] = [];
for (const id of main) {
  const from = index.get(id)!;
  for (const edge of graph.neighbours.get(id) ?? []) {
    const to = index.get(otherEnd(edge, id));
    if (to !== undefined && from < to) springs.push([from, to]);
  }
}

const dx = new Float64Array(n);
const dy = new Float64Array(n);

{
  const degreeOf = (id: string) => (graph.neighbours.get(id) ?? []).length;
  // Root at the busiest person. Any root gives a valid tree; the busiest one
  // keeps the first ring wide and the whole thing shallow.
  const root = [...main].sort((a, b) => degreeOf(b) - degreeOf(a) || a.localeCompare(b))[0]!;

  const parent = new Map<string, string | null>([[root, null]]);
  const children = new Map<string, string[]>();
  const depth = new Map<string, number>([[root, 0]]);
  const order: string[] = [root];
  for (let head = 0; head < order.length; head += 1) {
    const current = order[head]!;
    const kids: string[] = [];
    // Sorted, so the layout is reproducible rather than dependent on the order
    // relations happen to sit in the snapshot.
    const neighbours = (graph.neighbours.get(current) ?? [])
      .map((edge) => otherEnd(edge, current))
      .filter((id) => index.has(id))
      .sort();
    for (const id of neighbours) {
      if (parent.has(id)) continue;
      parent.set(id, current);
      depth.set(id, depth.get(current)! + 1);
      kids.push(id);
      order.push(id);
    }
    children.set(current, kids);
  }
  const deepest = Math.max(...depth.values());

  // A subtree's share of the circle is its share of the leaves, so a lineage
  // with fifty descendants gets fifty times the room of one with a single
  // student, and no two wedges overlap.
  const leaves = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i]!;
    const kids = children.get(id) ?? [];
    leaves.set(id, kids.length ? kids.reduce((sum, kid) => sum + leaves.get(kid)!, 0) : 1);
  }

  const angle = new Map<string, number>();
  const place = (id: string, from: number, to: number) => {
    angle.set(id, (from + to) / 2);
    const kids = children.get(id) ?? [];
    const total = kids.reduce((sum, kid) => sum + leaves.get(kid)!, 0) || 1;
    let cursor = from;
    for (const kid of kids) {
      const span = ((to - from) * leaves.get(kid)!) / total;
      place(kid, cursor, cursor + span);
      cursor += span;
    }
  };
  place(root, 0, Math.PI * 2);

  // Turn the wedges so the chords get short.
  //
  // The 195 relations that are not tree edges are the whole problem: a chord
  // between two wedges on opposite sides of the disc crosses two dozen rings
  // of people on the way, and no amount of nudging individual nodes will clear
  // it. Ordering each node's children by where their chord partners currently
  // sit -- the barycentre heuristic, the standard move for this -- pulls
  // related branches next to each other, and a chord between neighbours cuts
  // across almost nothing. Nothing about the tree changes; only the order
  // siblings are drawn in, which the data does not specify.
  const chords: [string, string][] = [];
  for (const [a, b] of springs) {
    const from = main[a]!;
    const to = main[b]!;
    if (parent.get(from) === to || parent.get(to) === from) continue;
    chords.push([from, to]);
  }
  const partners = new Map<string, string[]>();
  for (const [a, b] of chords) {
    (partners.get(a) ?? partners.set(a, []).get(a)!).push(b);
    (partners.get(b) ?? partners.set(b, []).get(b)!).push(a);
  }

  /** Every chord partner of anybody in this subtree. */
  const subtreePartners = new Map<string, string[]>();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i]!;
    const own = [...(partners.get(id) ?? [])];
    for (const kid of children.get(id) ?? []) own.push(...subtreePartners.get(kid)!);
    subtreePartners.set(id, own);
  }

  for (let round = 0; round < 12; round += 1) {
    for (const id of order) {
      const kids = children.get(id) ?? [];
      if (kids.length < 2) continue;
      const key = new Map<string, number>();
      for (const kid of kids) {
        // Circular mean of where this branch's chord partners are, so a branch
        // whose partners are spread across the origin is not dragged to zero.
        let sx = 0;
        let sy = 0;
        let count = 0;
        for (const other of subtreePartners.get(kid)!) {
          const a = angle.get(other);
          if (a === undefined) continue;
          sx += Math.cos(a);
          sy += Math.sin(a);
          count += 1;
        }
        key.set(kid, count ? Math.atan2(sy, sx) : angle.get(kid)!);
      }
      kids.sort((a, b) => key.get(a)! - key.get(b)! || a.localeCompare(b));
    }
    place(root, 0, Math.PI * 2);
  }

  const chordLength = () => {
    let total = 0;
    for (const [a, b] of chords) {
      const gap = Math.abs(angle.get(a)! - angle.get(b)!);
      total += Math.min(gap, Math.PI * 2 - gap);
    }
    return total / Math.max(chords.length, 1);
  };
  console.log(`  mean chord span after ordering: ${(chordLength() * (180 / Math.PI)).toFixed(1)}°`);

  for (const id of main) {
    const i = index.get(id)!;
    // sqrt, so each ring gets area in proportion to how many people are on it
    // rather than crowding the outer rings where most of the graph lives.
    const radius = 0.5 * Math.sqrt(depth.get(id)! / deepest);
    const theta = angle.get(id)!;
    x[i] = 0.5 + Math.cos(theta) * radius;
    y[i] = 0.5 + Math.sin(theta) * radius;
  }

  const extra =
    springs.length === 0
      ? 0
      : springs.filter(([a, b]) => parent.get(main[a]!) !== main[b]! && parent.get(main[b]!) !== main[a]!)
          .length;
  console.log(
    `radial tree: root ${graph.people.get(root)!.name}, depth ${deepest}, ` +
      `${springs.length - extra} tree relations and ${extra} chords`,
  );
}

// --- separation: no line may pass through somebody it is not about ----------
//
// A relation between two people is a straight fact and gets a straight line.
// That leaves exactly one place to fix a line running through a third person:
// where the people are. Two earlier attempts did it in the renderer instead --
// painting background over the node, then bending the line around it -- and
// both are ways of not answering the question.
//
// So this is a second phase with the same springs and repulsion as above, plus
// a force that pushes a node off any line it is sitting on and pushes that
// line's two endpoints the other way. Clearance is the renderer's own number:
// the radius it will actually draw, capped by half the distance to the nearest
// neighbour, plus the gap -- measured at the *phone* canvas, because a dot is
// the same pixels on both and takes up more of a 358px box than an 821px one.
//
// It logs as it goes. There is no point optimising something you cannot watch.

const SEPARATE = 9000;
const PHONE_SIDE = 358;

const localIndex = main.map((_, i) => i);
const localLinks = springs.map(([from, to]) => ({ from, to }));
const degrees = main.map((id) => graph.neighbours.get(id)?.length ?? 0);
const isLaureate = main.map((id) => graph.people.get(id)!.laureate);

/** Half the distance to the nearest other node, which caps how big a dot gets. */
function nearestDistances(): Float64Array {
  const CELL = 0.02;
  const buckets = new Map<string, number[]>();
  for (const i of localIndex) {
    const key = `${Math.floor(x[i]! / CELL)},${Math.floor(y[i]! / CELL)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  }
  const out = new Float64Array(n);
  for (const i of localIndex) {
    const cx = Math.floor(x[i]! / CELL);
    const cy = Math.floor(y[i]! / CELL);
    let best = Infinity;
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (const j of buckets.get(`${cx + ox},${cy + oy}`) ?? []) {
          if (j === i) continue;
          const d = Math.hypot(x[i]! - x[j]!, y[i]! - y[j]!);
          if (d < best) best = d;
        }
      }
    }
    out[i] = Number.isFinite(best) ? best : 1;
  }
  return out;
}

function placedNow(nearest: Float64Array): Placed[] {
  return localIndex.map((i) => ({
    x: x[i]!,
    y: y[i]!,
    clearance:
      (fitRadius(radiusFor(degrees[i]!, isLaureate[i]!, "seed", "dark"), 1, nearest[i]! * PHONE_SIDE) +
        TOUCH) /
      PHONE_SIDE,
  }));
}

const homeX = Float64Array.from(x);
const homeY = Float64Array.from(y);

let placed = placedNow(nearestDistances());
console.log(`before separation: ${describe(crossings(placed, localLinks), localLinks.length)}`);

let best = crossings(placed, localLinks).length;
let bestX = Float64Array.from(x);
let bestY = Float64Array.from(y);

for (let step = 0; step < SEPARATE; step += 1) {
  // Clearance depends on where everybody is, so it is recomputed as they move
  // -- but not every tick, because the grid pass is the expensive part and the
  // answer barely moves between one step and the next.
  if (step % 8 === 0) placed = placedNow(nearestDistances());
  else for (const i of localIndex) { placed[i]!.x = x[i]!; placed[i]!.y = y[i]!; }

  const found = crossings(placed, localLinks);
  if (found.length < best) {
    best = found.length;
    bestX = Float64Array.from(x);
    bestY = Float64Array.from(y);
  }
  if (step % SEPARATE_LOG_EVERY === 0) {
    console.log(`  step ${String(step).padStart(4)}: ${describe(found, localLinks.length)}`);
  }
  if (!found.length) {
    console.log(`  step ${step}: clean`);
    break;
  }

  dx.fill(0);
  dy.fill(0);

  // Push the node off the line, and the line off the node. Both ends move so
  // the fix is shared rather than dumped on whoever happened to be in the way.
  for (const crossing of found) {
    const link = localLinks[crossing.link]!;
    const node = placed[crossing.node]!;
    const a = placed[link.from]!;
    const b = placed[link.to]!;
    const { cx, cy, t } = toSegment(node.x, node.y, a.x, a.y, b.x, b.y);
    let ux = node.x - cx;
    let uy = node.y - cy;
    let length = Math.hypot(ux, uy);
    if (length < 1e-9) {
      // Sitting exactly on the line. Perpendicular, deterministically.
      ux = -(b.y - a.y);
      uy = b.x - a.x;
      length = Math.hypot(ux, uy) || 1;
    }
    const push = crossing.depth * 1.4;
    ux = (ux / length) * push;
    uy = (uy / length) * push;
    dx[crossing.node] += ux * 2;
    dy[crossing.node] += uy * 2;
    dx[link.from] -= ux * (1 - t);
    dy[link.from] -= uy * (1 - t);
    dx[link.to] -= ux * t;
    dy[link.to] -= uy * t;
  }

  // Hold the tree, do not re-derive it.
  //
  // This used to run the springs and the pairwise repulsion again, and that is
  // what wrecked it: those forces want a hairball, so every step the
  // separation pass gained on the chords, they spent pulling the rings apart.
  // Crossings went from 210 relations to 583 while the count barely moved. The
  // radial arrangement *is* the answer for the 1155 tree relations, so the only
  // other force here pulls each person back toward where the tree put them.
  for (let i = 0; i < n; i += 1) {
    dx[i] += (homeX[i]! - x[i]!) * 0.08;
    dy[i] += (homeY[i]! - y[i]!) * 0.08;
  }

  const heat = 0.004 * (1 - step / SEPARATE) ** 0.6 + 0.0002;
  for (let i = 0; i < n; i += 1) {
    x[i] += Math.max(-heat, Math.min(heat, dx[i]!));
    y[i] += Math.max(-heat, Math.min(heat, dy[i]!));
  }
}

// Whatever ended up cleanest, not whatever the last tick happened to produce.
if (crossings(placedNow(nearestDistances()), localLinks).length > best) {
  x.set(bestX);
  y.set(bestY);
}
console.log(`after separation: ${describe(crossings(placedNow(nearestDistances()), localLinks), localLinks.length)}`);

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
  `${JSON.stringify({ seed: SEED, form: "radial-tree", separate: SEPARATE, core: CORE_RADIUS, positions }, null, 0)}\n`,
);
console.log(`wrote data/layout.json: ${Object.keys(positions).length} positions, seed ${SEED}`);
