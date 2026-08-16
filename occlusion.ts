// Does a straight line between two people pass through a third?
//
// This is the detector. It is deliberately a separate module used by three
// callers -- the layout script that has to fix the problem, the spec that
// refuses to let it come back, and a report you can run by hand -- so that the
// thing being optimised and the thing being asserted are the same code.
//
// The history matters. The first attempt at this drew a disc of background
// over each node after the edges, which hides a crossing rather than removing
// it. The second bent the lines around obstacles, which removes the crossing
// by making the line a lie about the relationship -- a relation between two
// people is a straight fact and should be a straight line. The fix belongs in
// where the nodes are, not in how the lines are drawn, and this file is what
// makes that fixable and checkable.

export interface Placed {
  /** Layout units, 0..1. */
  x: number;
  y: number;
  /** How far a line must stay from this centre. Layout units. */
  clearance: number;
}

export interface Link {
  from: number;
  to: number;
}

export interface Crossing {
  link: number;
  node: number;
  /** How far inside the clear zone the line reaches. Layout units. */
  depth: number;
}

/** Distance from a point to a segment, and where along the segment that is. */
export function toSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { distance: number; t: number; cx: number; cy: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length < 1e-15 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { distance: Math.hypot(px - cx, py - cy), t, cx, cy };
}

/**
 * Every place a straight line runs closer to a node than that node allows.
 *
 * Gridded, because the honest version is 1541 edges times 1682 nodes on every
 * iteration of a layout that runs for thousands of iterations.
 */
export function crossings(nodes: Placed[], links: Link[], cell = 0.02): Crossing[] {
  const buckets = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  let widest = 0;
  for (const [i, node] of nodes.entries()) {
    widest = Math.max(widest, node.clearance);
    const at = key(node.x, node.y);
    const bucket = buckets.get(at);
    if (bucket) bucket.push(i);
    else buckets.set(at, [i]);
  }
  const reach = Math.ceil(widest / cell) + 1;

  const found: Crossing[] = [];
  for (const [l, link] of links.entries()) {
    const a = nodes[link.from]!;
    const b = nodes[link.to]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / cell));
    const seen = new Set<number>();
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const cx = Math.floor((a.x + (b.x - a.x) * t) / cell);
      const cy = Math.floor((a.y + (b.y - a.y) * t) / cell);
      for (let dx = -reach; dx <= reach; dx += 1) {
        for (let dy = -reach; dy <= reach; dy += 1) {
          for (const i of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (i === link.from || i === link.to || seen.has(i)) continue;
            seen.add(i);
            const node = nodes[i]!;
            const { distance } = toSegment(node.x, node.y, a.x, a.y, b.x, b.y);
            if (distance < node.clearance) {
              found.push({ link: l, node: i, depth: node.clearance - distance });
            }
          }
        }
      }
    }
  }
  return found;
}

/** A one-line summary, for a log that has to be read at a glance. */
export function describe(found: Crossing[], links: number): string {
  if (!found.length) return `clean: 0 crossings across ${links} relations`;
  const deepest = found.reduce((worst, c) => Math.max(worst, c.depth), 0);
  const lines = new Set(found.map((c) => c.link)).size;
  return (
    `${found.length} crossing(s) on ${lines} of ${links} relations, ` +
    `deepest ${(deepest * 1000).toFixed(2)} per mille of the canvas`
  );
}
