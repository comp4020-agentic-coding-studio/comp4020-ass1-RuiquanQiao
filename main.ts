import snapshotJson from "./data/nobel.json";
import layoutJson from "./data/layout.json";
import {
  buildGraph,
  describeEdge,
  directOf,
  laureatesAmong,
  otherEnd,
  reachedFrom,
  search,
  summarise,
} from "./graph.ts";
import type { Edge, Person, Snapshot } from "./graph.ts";
import {
  BACKGROUND,
  EDGE_ORDER,
  NODE_ORDER,
  edgeStyle,
  edgeTier,
  nodeStyle,
  tierOf,
} from "./render.ts";
import type { EdgeTier, Tier } from "./render.ts";

// The page. Everything it knows about who is related to whom comes from
// graph.ts; this file only turns that into pixels and DOM. CLAUDE.md's rule:
// state never moves into the renderer, because the keyboard path and the tests
// both have to read it from outside the draw loop.

const snapshot = snapshotJson as unknown as Snapshot;
const layout = layoutJson as unknown as { positions: Record<string, [number, number]> };
const graph = buildGraph(snapshot);
const figures = summarise(graph);

const ids = [...graph.people.keys()].filter((id) => layout.positions[id]);

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

// --- state -----------------------------------------------------------------
// Three values, and they are the whole truth about what the page is showing.
// The canvas reads them; it does not own them.

let selected: string | null = null;
let direct = new Set<string>();
let reached = new Set<string>();

function select(id: string | null): void {
  selected = id !== null && graph.people.has(id) ? id : null;
  direct = new Set(selected ? directOf(graph, selected) : []);
  reached = new Set(selected ? reachedFrom(graph, selected) : []);
  drawReadout();
  drawResults(searchBox.value);
  draw();
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

function at(id: string): [number, number] {
  const point = layout.positions[id]!;
  // Square the drawing area and centre it, so the layout never stretches when
  // the viewport changes shape. The marker resizes mid-interaction.
  const size = Math.min(width, height);
  return [(width - size) / 2 + point[0] * size, (height - size) / 2 + point[1] * size];
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
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, width, height);

  const edgeTiers = new Map<EdgeTier, Edge[]>();
  for (const edge of graph.edges) {
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
    const style = edgeStyle(tier);
    context.strokeStyle = style.stroke;
    context.lineWidth = style.width;
    context.beginPath();
    for (const edge of bucket) {
      const [ax, ay] = at(edge.from);
      const [bx, by] = at(edge.to);
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
    }
    context.stroke();
  }

  const nodeTiers = new Map<Tier, string[]>();
  for (const id of ids) {
    const tier = tierOf(id, selected, direct, reached);
    const bucket = nodeTiers.get(tier);
    if (bucket) bucket.push(id);
    else nodeTiers.set(tier, [id]);
  }
  for (const tier of NODE_ORDER) {
    for (const id of nodeTiers.get(tier) ?? []) {
      const style = nodeStyle(graph.people.get(id)!.laureate, tier);
      const [nx, ny] = at(id);

      if (style.halo !== null) {
        context.beginPath();
        context.arc(nx, ny, style.radius + 5, 0, Math.PI * 2);
        context.strokeStyle = style.halo;
        context.lineWidth = 1;
        context.stroke();
      }

      context.beginPath();
      context.arc(nx, ny, style.radius, 0, Math.PI * 2);
      context.fillStyle = style.fill;
      context.fill();
      if (style.stroke !== null) {
        context.strokeStyle = style.stroke;
        context.lineWidth = style.strokeWidth;
        context.stroke();
      }
    }
  }
}

function nearest(clientX: number, clientY: number): string | null {
  const rect = canvas.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  let best: string | null = null;
  let bestDistance = 14; // generous, because a 2.6px dot is not a touch target
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
}

// --- wiring ----------------------------------------------------------------

searchBox.addEventListener("input", () => drawResults(searchBox.value));
finder.addEventListener("submit", (event) => {
  event.preventDefault();
  resultList.querySelector<HTMLButtonElement>("button.result")?.click();
});

canvas.addEventListener("click", (event) => {
  const hit = nearest(event.clientX, event.clientY);
  if (hit !== null) select(hit);
});

// A resize must not clear the selection: the marker resizes mid-interaction,
// and losing state there reads as a broken page, not a responsive one.
const observer = new ResizeObserver((entries) => {
  syncCanvas(entries.at(-1)?.contentRect);
  draw();
});
observer.observe(canvas);

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

select(null);
