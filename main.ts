import snapshotJson from "./data/nobel.json";
import layoutJson from "./data/layout.json";
import {
  buildGraph,
  describeEdge,
  directOf,
  otherEnd,
  reachedFrom,
  search,
  summarise,
} from "./graph.ts";
import type { Person, Snapshot } from "./graph.ts";

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

const COLOURS = {
  background: "#0d0f14",
  edge: "#1c2029",
  edgeLit: "#5d4a24",
  dim: "#252932",
  laureate: "#7a6334",
  laureateLit: "#e8b552",
  ring: "#6b7280",
  ringLit: "#cbd5e1",
  seed: "#ffffff",
};

let width = 0;
let height = 0;

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  width = Math.max(1, Math.floor(rect.width));
  height = Math.max(1, Math.floor(rect.height));
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
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

function draw(): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = COLOURS.background;
  context.fillRect(0, 0, width, height);

  const inReach = (id: string) => id === selected || reached.has(id);

  context.lineWidth = 0.6;
  for (const edge of graph.edges) {
    if (!layout.positions[edge.from] || !layout.positions[edge.to]) continue;
    const lit = selected !== null && inReach(edge.from) && inReach(edge.to);
    // With a selection, unlit edges vanish instead of muddying the picture.
    if (selected !== null && !lit) continue;
    const [ax, ay] = at(edge.from);
    const [bx, by] = at(edge.to);
    context.strokeStyle = lit ? COLOURS.edgeLit : COLOURS.edge;
    context.beginPath();
    context.moveTo(ax, ay);
    context.lineTo(bx, by);
    context.stroke();
  }

  for (const id of ids) {
    const person = graph.people.get(id)!;
    const [nx, ny] = at(id);
    const isSeed = id === selected;
    const isDirect = direct.has(id);
    const lit = selected === null || isSeed || isDirect || reached.has(id);

    let radius = person.laureate ? 2.6 : 1.7;
    if (isDirect) radius = 4.2;
    if (isSeed) radius = 6;

    context.beginPath();
    context.arc(nx, ny, radius, 0, Math.PI * 2);

    if (!lit) {
      context.fillStyle = COLOURS.dim;
      context.fill();
      continue;
    }

    if (person.laureate) {
      let fill = COLOURS.laureate;
      if (isSeed) fill = COLOURS.seed;
      else if (isDirect || selected === null) fill = COLOURS.laureateLit;
      context.fillStyle = fill;
      context.fill();
    } else {
      // Non-laureates are hollow with a grey ring: present, load-bearing, and
      // never dressed up as somebody who won something.
      context.fillStyle = COLOURS.background;
      context.fill();
      context.lineWidth = 1.1;
      context.strokeStyle = isSeed || isDirect ? COLOURS.ringLit : COLOURS.ring;
      context.stroke();
      context.lineWidth = 0.6;
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

  const counts = document.createElement("p");
  counts.className = "readout-counts";
  counts.dataset.testid = "counts";
  counts.dataset.direct = String(direct.size);
  counts.dataset.reached = String(reached.size);
  counts.textContent =
    reached.size === 0
      ? "Nobody at all. This one stands alone in the data we have."
      : `${direct.size} directly related. ${reached.size} reached, following the chain as far as it goes.`;
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

    const verb = document.createElement("span");
    verb.className = "relation-verb";
    verb.textContent = `${describeEdge(edge, selected)} `;

    const who = document.createElement("button");
    who.type = "button";
    who.className = "relation-link";
    who.textContent = other.name;
    who.dataset.id = other.id;
    who.addEventListener("click", () => select(other.id));

    // Provenance is printed, not smoothed over: a claim with no reference
    // behind it looks different from one that has three.
    const source = document.createElement("a");
    source.className = `provenance provenance-${edge.provenance}`;
    source.href = edge.source;
    source.rel = "noreferrer";
    source.textContent =
      edge.references === 0 ? "no reference" : `${edge.references} ref`;
    source.title =
      edge.references === 0
        ? "Wikidata records this claim with no reference behind it."
        : "Wikidata records this claim with at least one reference.";

    item.append(verb, who, document.createTextNode(" "), source);
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
const observer = new ResizeObserver(() => {
  resizeCanvas();
  draw();
});
observer.observe(canvas);

// The finding, as a pair of numbers rather than an adjective. Both are counted
// from the snapshot at load, so neither can drift away from the file.
pick<HTMLElement>('[data-testid="scale"]').textContent =
  `There are ${figures.components} separate groups in this data. The largest holds ` +
  `${figures.largestComponent} people. The next largest holds ${figures.secondLargestComponent}.`;

// Printed at the same size as the claim, not tucked into a footnote: a third of
// the laureates here are unattached, and that is a fact about the record.
pick<HTMLElement>('[data-testid="caveat"]').textContent =
  `${figures.isolatedLaureates} of the ${figures.laureates} laureates light up nobody at all. ` +
  `That is not evidence they had no teacher — it means Wikidata records no relation for them. ` +
  `An empty screen here is a gap in what was written down.`;

pick<HTMLElement>('[data-testid="provenance"]').textContent =
  `Snapshot taken ${snapshot.fetchedAt}: ${figures.people} people, ${figures.laureates} of them laureates, ` +
  `${figures.edges} relations, of which ${figures.unsourcedEdges} carry no reference on Wikidata. ` +
  `The largest connected group holds ${figures.largestComponentLaureates} laureates.`;

resizeCanvas();
select(null);
