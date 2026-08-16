import snapshotJson from "./data/nobel.json";
import layoutJson from "./data/layout.json";
import portraitsJson from "./data/portraits.json";
import {
  buildGraph,
  describeEdge,
  directOf,
  initialsOf,
  laureatesAmong,
  otherEnd,
  reachedFrom,
  search,
  summarise,
} from "./graph.ts";
import type { Edge, Person, Snapshot } from "./graph.ts";
import {
  EDGE_ORDER,
  NODE_ORDER,
  background,
  edgeStyle,
  edgeTier,
  nodeStyle,
  tierOf,
} from "./render.ts";
import type { EdgeTier, Tier } from "./render.ts";
import { currentTheme, onThemeChange } from "./theme.ts";
import {
  GAP,
  HOME,
  MAX_DOT,
  MAX_SCALE,
  MIN_SCALE,
  clampView,
  dotRadius,
  fitRadius,
  onScreen,
  panBy,
  routeAround,
  screenOf,
  showsPortrait,
  trimToEdge,
  zoomAt,
} from "./viewport.ts";
import type { Obstacle, View } from "./viewport.ts";

// The page. Everything it knows about who is related to whom comes from
// graph.ts; this file only turns that into pixels and DOM. CLAUDE.md's rule:
// state never moves into the renderer, because the keyboard path and the tests
// both have to read it from outside the draw loop.

const snapshot = snapshotJson as unknown as Snapshot;
const layout = layoutJson as unknown as { positions: Record<string, [number, number]> };
const graph = buildGraph(snapshot);
const figures = summarise(graph);

interface Credit {
  file: string;
  artist: string;
  licence: string;
  commons: string;
  /** jpg, png or gif -- read from the bytes when they were fetched, because
      Commons only converts what a browser cannot display and serves PNG and
      GIF unchanged. Naming them all .jpg worked, which is the problem. */
  ext: string;
}

const portraitBook = portraitsJson as unknown as {
  fetchedAt: string;
  laureates: number;
  portraits: Record<string, Credit>;
};
const credits = portraitBook.portraits;

const ids = [...graph.people.keys()].filter((id) => layout.positions[id]);

/**
 * How close each node's nearest neighbour is, in layout units.
 *
 * Computed once, through a grid rather than 1682^2 comparisons. The draw loop
 * turns it into screen pixels and refuses to grow any dot past half of it, so
 * two portraits can never overlap -- see fitRadius in viewport.ts. Overlap is
 * not a cosmetic problem here: two faces touching reads as a relationship, and
 * a relationship on this page is a claim about real people.
 */
const nearestNeighbour = new Map<string, number>();
{
  const CELL = 0.01;
  const buckets = new Map<string, string[]>();
  const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  for (const id of ids) {
    const [x, y] = layout.positions[id]!;
    const at = key(x, y);
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
          const distance = Math.hypot(x - ox, y - oy);
          if (distance < best) best = distance;
        }
      }
    }
    // Alone in its neighbourhood: nothing to collide with, so no cap.
    nearestNeighbour.set(id, Number.isFinite(best) ? best : 1);
  }
}

/**
 * For each relation, the handful of people its line runs near.
 *
 * Computed once, because it can be: the view is a uniform scale and a
 * translation, so which nodes lie near which line is a fact about the layout
 * and not about the zoom. The first version asked that question per edge per
 * frame and a single redraw took 1.1 seconds, which makes panning unusable.
 *
 * The threshold is the widest a clear zone can ever be -- a 26px dot plus the
 * gap -- expressed in layout units at the scale where that is largest, which
 * is 1. Anything further away than this can never be in the way at any zoom.
 */
const NEAR_EDGE = (MAX_DOT + GAP) / 760;
const edgeObstacles = new Map<Edge, string[]>();
{
  const CELL = 0.04;
  const buckets = new Map<string, string[]>();
  for (const id of ids) {
    const [x, y] = layout.positions[id]!;
    const at = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    const bucket = buckets.get(at);
    if (bucket) bucket.push(id);
    else buckets.set(at, [id]);
  }
  /** Distance from a point to a segment, in layout units. */
  const toSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  };

  for (const edge of graph.edges) {
    const a = layout.positions[edge.from];
    const b = layout.positions[edge.to];
    if (!a || !b) continue;
    const found = new Set<string>();
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / CELL));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const cx = Math.floor((a[0] + (b[0] - a[0]) * t) / CELL);
      const cy = Math.floor((a[1] + (b[1] - a[1]) * t) / CELL);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const id of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (id === edge.from || id === edge.to || found.has(id)) continue;
            const [px, py] = layout.positions[id]!;
            if (toSegment(px, py, a[0], a[1], b[0], b[1]) <= NEAR_EDGE) found.add(id);
          }
        }
      }
    }
    if (found.size) edgeObstacles.set(edge, [...found]);
  }
}

function pick<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element: ${selector}`);
  return found;
}

const canvas = pick<HTMLCanvasElement>('[data-testid="canvas"]');
const searchBox = pick<HTMLInputElement>('[data-testid="search"]');
const resultList = pick<HTMLUListElement>('[data-testid="results"]');
const readout = pick<HTMLDivElement>('[data-testid="readout"]');
const finder = pick<HTMLFormElement>('[data-testid="finder"]');
const zoomGroup = pick<HTMLDivElement>('[data-testid="zoom"]');
const zoomLevel = pick<HTMLParagraphElement>('[data-testid="zoom-level"]');

// --- state -----------------------------------------------------------------
// Four values, and they are the whole truth about what the page is showing.
// The canvas reads them; it does not own them.
//
// `view` is the newest and the only one that is not about the data. It is kept
// out here with the others rather than inside the draw loop because the hit
// test needs it too -- if drawing and clicking ever disagreed about where a
// node is, clicking a face would select the person beside them and the page
// would look perfectly fine while lying.

let selected: string | null = null;
let direct = new Set<string>();
let reached = new Set<string>();
let view: View = HOME;

function select(id: string | null): void {
  selected = id !== null && graph.people.has(id) ? id : null;
  direct = new Set(selected ? directOf(graph, selected) : []);
  reached = new Set(selected ? reachedFrom(graph, selected) : []);
  drawReadout();
  drawResults(searchBox.value);
  draw();
}

/** Zoom and pan change the view and nothing else. Selection is not theirs. */
function setView(next: View): void {
  view = clampView(next, { width, height });
  const shown = `${view.scale.toFixed(1)}×`;
  // Only touch the DOM when the rounded figure actually moves. This node is
  // aria-live, and a wheel gesture fires dozens of times a second: without
  // this a screen reader would be read a number it cannot keep up with.
  if (zoomLevel.textContent !== shown) zoomLevel.textContent = shown;
  pick<HTMLButtonElement>('[data-testid="zoom-out"]').disabled = view.scale <= MIN_SCALE;
  pick<HTMLButtonElement>('[data-testid="zoom-in"]').disabled = view.scale >= MAX_SCALE;
  schedule();
}

// --- canvas ----------------------------------------------------------------

let width = 0;
let height = 0;

/**
 * Bring the canvas backing store in line with its CSS box, if it isn't already.
 *
 * Called at the top of every draw rather than only on resize, because a canvas
 * whose bitmap has drifted from its box renders at the wrong scale and there is
 * nothing on screen to tell you so. It drifts more easily than you would think:
 * a measurement taken while the tab is backgrounded or the pane is not
 * compositing can come back as a few pixels, and if no further resize arrives
 * the canvas simply stays wrong. Re-checking here means any later draw repairs
 * it, and the check is two integer comparisons.
 *
 * `size` is the observed box when a ResizeObserver hands one over. Trusting the
 * observer beats re-measuring: the observer reports the size it actually saw,
 * while a fresh getBoundingClientRect races whatever layout is in flight.
 */
function syncCanvas(size?: { width: number; height: number }): void {
  const box = size ?? canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const nextWidth = Math.max(1, Math.round(box.width));
  const nextHeight = Math.max(1, Math.round(box.height));
  const bitmapWidth = Math.max(1, Math.round(nextWidth * ratio));
  const bitmapHeight = Math.max(1, Math.round(nextHeight * ratio));
  if (
    width === nextWidth &&
    height === nextHeight &&
    canvas.width === bitmapWidth &&
    canvas.height === bitmapHeight
  ) {
    return;
  }
  width = nextWidth;
  height = nextHeight;
  canvas.width = bitmapWidth;
  canvas.height = bitmapHeight;
  const context = canvas.getContext("2d");
  if (context) context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

/**
 * Where a person is on screen right now. The one transform, used by the draw
 * loop and by the hit test alike -- see viewport.ts for why that matters.
 */
function at(id: string): [number, number] {
  return screenOf(layout.positions[id]!, view, { width, height });
}

// --- portraits --------------------------------------------------------------
// 731 faces, 96px each, sitting in public/portraits/ because CLAUDE.md forbids
// the build from touching the network and a page that fetched them from Commons
// at read time would be betting the whole prototype on somebody else's uptime.
//
// They are loaded on demand: only for nodes drawn large enough to show one, only
// while those nodes are on screen, and never more than a handful at a time. A
// fast zoom across the graph would otherwise ask for several hundred images
// nobody will look at.

const IMAGES_AT_ONCE = 12;

const loaded = new Map<string, HTMLImageElement>();
const failed = new Set<string>();
const asking = new Set<string>();

function portrait(id: string): HTMLImageElement | null {
  const ready = loaded.get(id);
  if (ready) return ready;
  const credit = credits[id];
  if (failed.has(id) || asking.has(id) || !credit) return null;
  if (asking.size >= IMAGES_AT_ONCE) return null; // a later draw will ask again

  asking.add(id);
  const image = new Image();
  image.decoding = "async";
  image.addEventListener("load", () => {
    asking.delete(id);
    loaded.set(id, image);
    schedule();
  });
  image.addEventListener("error", () => {
    asking.delete(id);
    // A missing file leaves a gold dot, which is what a laureate without a
    // portrait looks like anyway. Never a broken-image glyph where a face goes.
    failed.add(id);
  });
  // Document-relative on purpose: vite's `base: "./"` means the deployed site
  // lives under a path, and only this page ever loads one of these.
  image.src = `portraits/${id}.${credit.ext}`;
  return null;
}

/**
 * Draw a face in the circle the dot would have occupied.
 *
 * Cropped square from the middle, but biased upward: 672 of the 761 source
 * images are taller than they are wide, and in a standing portrait the head is
 * nearer the top than the centre. Taking the middle would frame a lot of
 * chests.
 */
function drawPortrait(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  radius: number,
): void {
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (!side) return;
  const sx = (image.naturalWidth - side) / 2;
  const sy = (image.naturalHeight - side) * 0.2;
  context.save();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.clip();
  context.drawImage(image, sx, sy, side, side, x - radius, y - radius, radius * 2, radius * 2);
  context.restore();
}

let queued = 0;

/** Coalesce redraws, so a wheel gesture paints once a frame and not per event. */
function schedule(): void {
  if (queued) return;
  queued = requestAnimationFrame(() => {
    queued = 0;
    draw();
  });
}

/**
 * Two passes, each in painter's order, each batching one path per tier.
 *
 * The order is load-bearing rather than tidy. A thousand-odd dots overlap at
 * this scale, so drawing them in id order lets an out-of-reach dot paint over
 * a lit one, and the whole point of a click is how much of the screen answers
 * it. Which colour each tier gets is render.ts's business, not this loop's --
 * that decision used to live here, where no test could see it, and it was
 * wrong for months.
 */
function draw(): void {
  syncCanvas();
  const context = canvas.getContext("2d");
  if (!context) return;
  // Read once per draw rather than per dot. The canvas paints its own
  // background because a transparent one would show the page through the
  // hollow non-laureate rings.
  const theme = currentTheme();
  context.fillStyle = background(theme);
  context.fillRect(0, 0, width, height);

  // Nodes are placed first now, because the edges have to be routed around
  // them and cannot be if they do not yet exist.
  const nodeTiers = new Map<Tier, string[]>();
  for (const id of ids) {
    const tier = tierOf(id, selected, direct, reached);
    const bucket = nodeTiers.get(tier);
    if (bucket) bucket.push(id);
    else nodeTiers.set(tier, [id]);
  }
  const box = { width, height };
  const side = Math.min(width, height);

  /** Everything about a node the passes below need. */
  const placed: { id: string; tier: Tier; x: number; y: number; radius: number }[] = [];
  const where = new Map<string, { x: number; y: number; radius: number }>();
  for (const tier of NODE_ORDER) {
    for (const id of nodeTiers.get(tier) ?? []) {
      const person = graph.people.get(id)!;
      const style = nodeStyle(person.laureate, tier, theme);
      const [x, y] = at(id);
      // Half the distance to the nearest neighbour is the ceiling, so two dots
      // can never touch however far in you go.
      const radius = fitRadius(
        style.radius,
        view.scale,
        nearestNeighbour.get(id)! * side * view.scale,
      );
      // Culling is what keeps a deep zoom cheap: at 40x nearly all of the graph
      // is off the edge, and neither its arcs nor its images are worth asking
      // for.
      if (!onScreen([x, y], box, radius + 8)) continue;
      placed.push({ id, tier, x, y, radius });
      where.set(id, { x, y, radius });
    }
  }

  /**
   * Of the people this line runs near, the ones actually in its way right now.
   *
   * The candidate list is precomputed; all that is left per frame is a
   * distance test against however few of them there are, which is usually
   * none. That is the difference between a 1.1 second redraw and a usable one.
   */
  const inTheWay = (edge: Edge, ax: number, ay: number, bx: number, by: number): Obstacle[] => {
    const candidates = edgeObstacles.get(edge);
    if (!candidates) return [];
    const found: Obstacle[] = [];
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    for (const id of candidates) {
      const node = where.get(id);
      if (!node) continue;
      const keepOut = node.radius + GAP;
      const t =
        length < 1e-9 ? 0 : Math.max(0, Math.min(1, ((node.x - ax) * dx + (node.y - ay) * dy) / length));
      const distance = Math.hypot(node.x - (ax + dx * t), node.y - (ay + dy * t));
      if (distance < keepOut) found.push({ x: node.x, y: node.y, keepOut });
    }
    return found;
  };

  const edgeTiers = new Map<EdgeTier, Edge[]>();
  for (const edge of graph.edges) {
    if (!where.has(edge.from) && !where.has(edge.to)) continue;
    if (!layout.positions[edge.from] || !layout.positions[edge.to]) continue;
    const tier = edgeTier(edge.from, edge.to, selected, reached);
    // An out-of-reach relation is not dimmed, it is not drawn: dimming it would
    // only muddy the picture it is not part of.
    if (tier === "out") continue;
    const bucket = edgeTiers.get(tier);
    if (bucket) bucket.push(edge);
    else edgeTiers.set(tier, [edge]);
  }
  for (const tier of EDGE_ORDER) {
    const bucket = edgeTiers.get(tier);
    if (!bucket) continue;
    const style = edgeStyle(tier, theme);
    context.strokeStyle = style.stroke;
    context.lineWidth = style.width;
    context.beginPath();
    for (const edge of bucket) {
      const a = at(edge.from);
      const b = at(edge.to);
      // Start and end at the rim of the dots this edge belongs to, not at
      // their centres, so a relation reaches its two people and touches
      // nothing else on the way.
      const from = trimToEdge(a, b, (where.get(edge.from)?.radius ?? 0) + GAP);
      const to = trimToEdge(b, a, (where.get(edge.to)?.radius ?? 0) + GAP);
      const blocking = inTheWay(edge, from[0], from[1], to[0], to[1]);
      // The overwhelming majority of lines run clear of everything, and a
      // straight one costs two calls instead of fourteen.
      if (!blocking.length) {
        context.moveTo(from[0], from[1]);
        context.lineTo(to[0], to[1]);
        continue;
      }
      const path = routeAround(from, to, blocking);
      context.moveTo(path[0]![0], path[0]![1]);
      for (let i = 1; i < path.length; i += 1) context.lineTo(path[i]![0], path[i]![1]);
    }
    context.stroke();
  }

  for (const { id, tier, x: nx, y: ny, radius } of placed) {
    const person = graph.people.get(id)!;
    const style = nodeStyle(person.laureate, tier, theme);

    if (style.halo !== null) {
      // Inside the cleared disc, so marking the selection cannot reach across
      // into the space belonging to the node beside it.
      context.beginPath();
      context.arc(nx, ny, radius + GAP, 0, Math.PI * 2);
      context.strokeStyle = style.halo;
      context.lineWidth = 1;
      context.stroke();
    }

    // A face, once there is room for one. Only laureates have portraits, so
    // this quietly reinforces the rule the rest of the page is built on:
    // nobody who did not win is ever dressed up as somebody who did.
    const big = person.laureate && showsPortrait(radius);
    const face = big ? portrait(id) : null;

    // Twenty-two laureates have no picture anybody has released under a
    // licence this page can honour. Left as a plain dot they read as a failed
    // load sitting among faces. Their initials say the opposite: this is a
    // person, we know exactly who, and what is missing is the photograph.
    if (big && !face && !credits[id]) {
      context.beginPath();
      context.arc(nx, ny, radius, 0, Math.PI * 2);
      context.fillStyle = style.fill;
      context.fill();
      context.fillStyle = background(theme);
      context.font = `600 ${(radius * 0.9).toFixed(1)}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(initialsOf(person.name), nx, ny + radius * 0.04);
      continue;
    }

    if (face) {
      drawPortrait(context, face, nx, ny, radius);
      // The tier still has to read, so the ring stays and says which of the
      // four states this person is in. A portrait replaces the fill, never
      // the answer to the question the page is asking.
      context.beginPath();
      context.arc(nx, ny, radius, 0, Math.PI * 2);
      context.strokeStyle = style.stroke ?? style.fill;
      context.lineWidth = Math.max(style.strokeWidth, 2);
      context.stroke();
      continue;
    }

    context.beginPath();
    context.arc(nx, ny, radius, 0, Math.PI * 2);
    context.fillStyle = style.fill;
    context.fill();
    if (style.stroke !== null) {
      context.strokeStyle = style.stroke;
      context.lineWidth = style.strokeWidth;
      context.stroke();
    }
  }
}

function nearest(clientX: number, clientY: number): string | null {
  const rect = canvas.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  let best: string | null = null;
  // Generous, because a 2.6px dot is not a touch target -- but no longer
  // generous *enough* on its own once dots grow: at 12x a face is 26px across
  // and clicking its edge has to hit it. Whichever is larger wins.
  let bestDistance = Math.max(14, dotRadius(6, view.scale));
  for (const id of ids) {
    const [nx, ny] = at(id);
    const distance = Math.hypot(nx - px, ny - py);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }
  return best;
}

// --- panel -----------------------------------------------------------------

function label(person: Person): string {
  if (!person.laureate) return `${person.name} — no Nobel Prize`;
  const prizes = person.prizes
    .map((prize) => (prize.year === null ? `${prize.category} (undated)` : `${prize.category} ${prize.year}`))
    .join(", ");
  return `${person.name} — ${prizes}`;
}

function drawResults(query: string): void {
  const hits = search(graph, query, 12);
  resultList.replaceChildren();
  for (const person of hits) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result";
    button.textContent = label(person);
    button.dataset.id = person.id;
    if (person.id === selected) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => select(person.id));
    item.append(button);
    resultList.append(item);
  }
}

function drawReadout(): void {
  readout.replaceChildren();
  if (selected === null) {
    const empty = document.createElement("p");
    empty.className = "readout-empty";
    empty.textContent = "Nobody selected yet.";
    readout.append(empty);
    return;
  }

  const person = graph.people.get(selected)!;
  const heading = document.createElement("h2");
  heading.className = "readout-name";
  heading.textContent = label(person);
  readout.append(heading);

  // The headline number is laureates, not people. Reaching 1142 people sounds
  // enormous and means less than it sounds: two thirds of them are the teachers
  // carrying the connection. "How many other laureates" is what a visitor came
  // to find out, so it goes first and the rest goes after it.
  const reachedLaureates = laureatesAmong(graph, [...reached]);
  const others = person.laureate ? "other Nobel laureates" : "Nobel laureates";

  const counts = document.createElement("p");
  counts.className = "readout-counts";
  counts.dataset.testid = "counts";
  counts.dataset.direct = String(direct.size);
  counts.dataset.reached = String(reached.size);
  counts.dataset.laureates = String(reachedLaureates);
  if (reached.size === 0) {
    counts.textContent = "Nobody at all — no recorded relation to anyone here.";
  } else {
    const big = document.createElement("strong");
    big.className = "readout-number";
    big.textContent = `${reachedLaureates} ${others}`;
    counts.append(
      big,
      document.createTextNode(
        `, reached through ${reached.size - reachedLaureates} teachers and relatives who never won one. ` +
          `${direct.size} of them ${direct.size === 1 ? "is" : "are"} directly related.`,
      ),
    );
  }
  readout.append(counts);

  const list = document.createElement("ul");
  list.className = "relations";
  const edges = [...(graph.neighbours.get(selected) ?? [])];
  edges.sort((a, b) => a.type.localeCompare(b.type));
  for (const edge of edges) {
    const other = graph.people.get(otherEnd(edge, selected));
    if (!other) continue;
    const item = document.createElement("li");
    item.className = "relation";
    item.dataset.laureate = String(other.laureate);

    const verb = document.createElement("span");
    verb.className = "relation-verb";
    verb.textContent = `${describeEdge(edge, selected)} `;

    // The same distinction the canvas draws, in the same two shapes: a solid
    // gold dot won something, a hollow grey ring did not. Reusing the picture's
    // own vocabulary means the list needs no key. It is shape as well as
    // colour, because a third of this page's readers on a bad monitor will not
    // separate #e8b552 from #9aa1ad, and the accessible name below says it in
    // words regardless.
    const mark = document.createElement("span");
    mark.className = other.laureate ? "relation-mark relation-mark-laureate" : "relation-mark";
    mark.textContent = other.laureate ? "●" : "○";
    mark.setAttribute("aria-hidden", "true");

    const who = document.createElement("button");
    who.type = "button";
    who.className = other.laureate ? "relation-link relation-link-laureate" : "relation-link";
    who.textContent = other.name;
    who.dataset.id = other.id;
    who.setAttribute("aria-label", other.laureate ? `${other.name}, Nobel laureate` : `${other.name}, no Nobel Prize`);
    who.addEventListener("click", () => select(other.id));

    // Provenance is printed, not smoothed over: a claim with no reference
    // behind it looks different from one that has three.
    const source = document.createElement("a");
    source.className = `provenance provenance-${edge.provenance}`;
    source.href = edge.source;
    source.rel = "noreferrer";
    source.textContent = edge.references === 0 ? "no reference" : `${edge.references} ref`;
    // Out of context a link called "1 ref" says nothing, and a screen reader
    // reads links out of context all the time.
    source.setAttribute(
      "aria-label",
      edge.references === 0
        ? `Wikidata claim that ${person.name} ${describeEdge(edge, selected)} ${other.name}, with no reference behind it`
        : `Wikidata claim that ${person.name} ${describeEdge(edge, selected)} ${other.name}, with ${edge.references} reference${edge.references === 1 ? "" : "s"}`,
    );
    source.title =
      edge.references === 0
        ? "Wikidata records this claim with no reference behind it."
        : "Wikidata records this claim with at least one reference.";

    item.append(verb, mark, who, document.createTextNode(" "), source);
    list.append(item);
  }
  if (list.childElementCount) readout.append(list);

  // Attribution, where the face is. 404 of these portraits are CC BY or CC
  // BY-SA and naming the creator is a condition of using them, not a courtesy;
  // the rest are public domain and are credited the same way so the reader
  // never has to guess which is which. about/ carries the full list as text --
  // this is the only place a per-portrait Commons link is emitted, and it is
  // built here in JavaScript rather than in the markup on purpose, because CI
  // validates every outbound link in the built HTML and 731 of them pointed at
  // one host would fail the deploy.
  const credit = credits[selected];
  if (credit) {
    const line = document.createElement("p");
    line.className = "readout-credit";
    line.dataset.testid = "credit";
    // Clamped to three lines in CSS, so the whole thing goes in the tooltip
    // as well -- and in full on the credits page, which is static markup that
    // does not depend on this script having run.
    line.title = `Portrait: ${credit.artist} · ${credit.licence}`;
    line.append(document.createTextNode(`Portrait: ${credit.artist} · ${credit.licence} · `));
    const link = document.createElement("a");
    link.className = "readout-credit-link";
    link.href = credit.commons;
    link.rel = "noreferrer";
    link.textContent = "Wikimedia Commons";
    link.setAttribute("aria-label", `${person.name} portrait on Wikimedia Commons`);
    line.append(link);
    readout.append(line);
  }
}

// --- wiring ----------------------------------------------------------------

searchBox.addEventListener("input", () => drawResults(searchBox.value));
finder.addEventListener("submit", (event) => {
  event.preventDefault();
  resultList.querySelector<HTMLButtonElement>("button.result")?.click();
});

// --- zoom and pan -----------------------------------------------------------
// Everything below changes `view` and nothing else. A gesture must never move
// the selection: the reader is looking for somebody, and losing them because
// they scrolled would be the page taking the answer away mid-question.

const ZOOM_STEP = 1.35;

/** Where an event landed, in canvas pixels. */
function pointIn(event: { clientX: number; clientY: number }): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

/**
 * What the buttons and the keyboard zoom about.
 *
 * The centre of the canvas, unless somebody is selected -- then it is them.
 * A wheel or a pinch has a cursor to anchor on and does not need this; a
 * button does not, and anchoring it on the middle made the feature almost
 * unusable in the one flow it exists for. You search a name, you get a
 * selection, you press +, and the person you just looked up slides off the
 * edge while the middle of the hairball fills the screen. Zooming toward the
 * answer is the whole point of being able to zoom.
 */
function focus(): [number, number] {
  if (selected !== null && layout.positions[selected]) return at(selected);
  return [width / 2, height / 2];
}

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    // A trackpad pinch arrives as a wheel event with ctrlKey set; the browser
    // does not offer a pinch event on the desktop. deltaMode 1 is lines, not
    // pixels, which Firefox still sends.
    const step = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    setView(zoomAt(view, Math.exp(-step / 320), pointIn(event), { width, height }));
  },
  { passive: false },
);

canvas.addEventListener("dblclick", (event) => {
  event.preventDefault();
  setView(zoomAt(view, ZOOM_STEP * 2, pointIn(event), { width, height }));
});

// Drag to pan, two fingers to pinch. Pointer events cover mouse, pen and touch
// in one path, so there is no separate touch branch to fall out of step.
const active = new Map<number, [number, number]>();
let dragged = 0;
let pinchGap = 0;

const gapOf = (points: [number, number][]) =>
  Math.hypot(points[0]![0] - points[1]![0], points[0]![1] - points[1]![1]);
const midOf = (points: [number, number][]): [number, number] => [
  (points[0]![0] + points[1]![0]) / 2,
  (points[0]![1] + points[1]![1]) / 2,
];

canvas.addEventListener("pointerdown", (event) => {
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Throws for a pointer id the browser does not consider active, which is
    // what a synthetic event is. Capture is a nicety -- it keeps a drag alive
    // when the finger leaves the canvas -- and losing it must not take the
    // rest of the gesture handling down with it.
  }
  active.set(event.pointerId, pointIn(event));
  dragged = 0;
  if (active.size === 2) pinchGap = gapOf([...active.values()]);
});

canvas.addEventListener("pointermove", (event) => {
  const previous = active.get(event.pointerId);
  if (!previous) return;
  const next = pointIn(event);
  active.set(event.pointerId, next);

  if (active.size === 2) {
    const points = [...active.values()];
    const gap = gapOf(points);
    if (pinchGap > 0 && gap > 0) {
      setView(zoomAt(view, gap / pinchGap, midOf(points), { width, height }));
    }
    pinchGap = gap;
    dragged = Infinity; // a pinch is never also a click
    return;
  }

  const dx = next[0] - previous[0];
  const dy = next[1] - previous[1];
  dragged += Math.hypot(dx, dy);
  if (view.scale > MIN_SCALE) setView(panBy(view, dx, dy, { width, height }));
});

function release(event: PointerEvent): void {
  active.delete(event.pointerId);
  if (active.size < 2) pinchGap = 0;
}
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

canvas.addEventListener("click", (event) => {
  // A pan ends in a click event. Selecting whoever happened to be under the
  // finger at the end of a drag is not what the reader asked for.
  if (dragged > 6) return;
  // Clicking nothing clears the selection. There was no way back to the
  // opening state without reloading, which made the first thing the page
  // shows -- every laureate gold, every teacher grey, the whole tree at once
  // -- a thing you could only see once.
  select(nearest(event.clientX, event.clientY));
});

pick<HTMLButtonElement>('[data-testid="zoom-in"]').addEventListener("click", () => {
  setView(zoomAt(view, ZOOM_STEP, focus(), { width, height }));
});
pick<HTMLButtonElement>('[data-testid="zoom-out"]').addEventListener("click", () => {
  setView(zoomAt(view, 1 / ZOOM_STEP, focus(), { width, height }));
});
pick<HTMLButtonElement>('[data-testid="zoom-reset"]').addEventListener("click", () => {
  setView(HOME);
});

// The keyboard half. CLAUDE.md: everything reachable by clicking has to be
// reachable by typing, and the canvas itself cannot take focus because it is
// aria-hidden -- so the controls carry it. Arrow keys pan, +/- zoom, 0 resets.
zoomGroup.addEventListener("keydown", (event) => {
  const box = { width, height };
  const nudge = 60;
  const moves: Record<string, () => View> = {
    ArrowLeft: () => panBy(view, nudge, 0, box),
    ArrowRight: () => panBy(view, -nudge, 0, box),
    ArrowUp: () => panBy(view, 0, nudge, box),
    ArrowDown: () => panBy(view, 0, -nudge, box),
    "+": () => zoomAt(view, ZOOM_STEP, focus(), box),
    "=": () => zoomAt(view, ZOOM_STEP, focus(), box),
    "-": () => zoomAt(view, 1 / ZOOM_STEP, focus(), box),
    "0": () => HOME,
  };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  setView(move());
});

// A resize must not clear the selection: the marker resizes mid-interaction,
// and losing state there reads as a broken page, not a responsive one. The
// view is re-clamped rather than reset, because the pan bounds depend on the
// box and a narrower canvas can leave the old offset out of range.
const observer = new ResizeObserver((entries) => {
  syncCanvas(entries.at(-1)?.contentRect);
  view = clampView(view, { width, height });
  draw();
});
observer.observe(canvas);

// The canvas is the one thing on the page CSS cannot repaint, so it has to be
// told. Selection is untouched by this: a theme change is a change of palette,
// never of state.
onThemeChange(draw);

// The answer to the second question, and the shape behind it. Both counted from
// the snapshot at load, so neither can drift away from the file underneath.
pick<HTMLElement>('[data-testid="scale"]').textContent =
  ` There are ${figures.isolatedLaureates}, out of ${figures.laureates}. ` +
  `Nearly everyone else ends up in the same place: of ${figures.components} separate groups, ` +
  `the largest holds ${figures.largestComponent} people and the next holds ${figures.secondLargestComponent}.`;

// Sits with the answer, not in a footnote. An empty screen is a hole in the
// record and the page has to say so wherever it reports the count.
pick<HTMLElement>('[data-testid="caveat"]').textContent =
  `An empty screen is not evidence that somebody worked alone. It means Wikidata records no ` +
  `relation for them, and coverage is far thinner for recent laureates and for anyone outside ` +
  `the old European universities. What you are looking at there is a gap in what was written down.`;

pick<HTMLElement>('[data-testid="provenance"]').textContent =
  `Snapshot taken ${snapshot.fetchedAt}: ${figures.people} people, ${figures.laureates} of them laureates, ` +
  `${figures.edges} relations, of which ${figures.unsourcedEdges} carry no reference on Wikidata. ` +
  `The largest connected group holds ${figures.largestComponentLaureates} laureates.`;

// Counted from the manifest, never typed in. Saying how many faces there are
// is the same rule as saying how many relations carry no reference: zooming in
// far enough to find a laureate with no portrait must read as a gap in the
// record, which it is, and not as something the page failed to load.
pick<HTMLElement>('[data-testid="portrait-note"]').textContent =
  `Portraits taken ${portraitBook.fetchedAt}: ${Object.keys(credits).length} of ` +
  `${figures.laureates} laureates have one, from Wikimedia Commons via Wikidata. Each is ` +
  `credited to its photographer and licence when you select that person; about/ lists them all. ` +
  `Zoom in to see them. Nobody who never won a prize has a face here, because none of them is a laureate.`;

setView(HOME);
select(null);
