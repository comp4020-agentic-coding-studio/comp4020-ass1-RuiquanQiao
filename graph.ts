// The graph, as data and as questions you can ask of it.
//
// Nothing here touches the DOM or the canvas, on purpose. CLAUDE.md's rule is
// that state never moves into the renderer: if a fact about the current
// selection only exists inside a draw loop, the keyboard path cannot reach it
// and a test cannot assert it. So the two highlight tiers are computed here,
// as plain functions over plain data, and both the canvas and the list read
// the same answer.

export interface Prize {
  category: string;
  /** `null` where Wikidata records no date. Not `0` -- absent means absent. */
  year: number | null;
}

export interface Person {
  id: string;
  name: string;
  laureate: boolean;
  prizes: Prize[];
}

export type EdgeType = "supervised" | "kin";
export type KinKind = "parent" | "spouse" | "sibling";
export type Provenance = "official" | "wikidata-sourced" | "wikidata-unsourced";

export interface Edge {
  from: string;
  to: string;
  type: EdgeType;
  kin: KinKind | null;
  provenance: Provenance;
  references: number;
  source: string;
}

export interface Snapshot {
  fetchedAt: string;
  people: Person[];
  edges: Edge[];
}

export interface Graph {
  people: Map<string, Person>;
  edges: Edge[];
  neighbours: Map<string, Edge[]>;
}

export function buildGraph(snapshot: Snapshot): Graph {
  const people = new Map(snapshot.people.map((person) => [person.id, person]));
  const neighbours = new Map<string, Edge[]>();
  for (const id of people.keys()) neighbours.set(id, []);
  for (const edge of snapshot.edges) {
    neighbours.get(edge.from)?.push(edge);
    neighbours.get(edge.to)?.push(edge);
  }
  return { people, edges: snapshot.edges, neighbours };
}

/** The other end of an edge, whichever end you came in on. */
export function otherEnd(edge: Edge, id: string): string {
  return edge.from === id ? edge.to : edge.from;
}

/**
 * Tier one: everyone holding a documented relation to this person.
 *
 * This is the precise answer -- who actually taught, or married, or fathered
 * whom. It excludes the person themselves, so the count reads as "how many
 * others", and every member of it is backed by an edge with a source.
 */
export function directOf(graph: Graph, id: string): string[] {
  const found = new Set<string>();
  for (const edge of graph.neighbours.get(id) ?? []) found.add(otherEnd(edge, id));
  found.delete(id);
  return [...found].sort();
}

/**
 * Tier two: everyone reachable by any chain of documented relations.
 *
 * This is the impression, and the impression is the argument. Nobody reads
 * names at thumbnail scale; they read how much of the screen lit up. Also
 * excludes the person themselves.
 */
export function reachedFrom(graph: Graph, id: string): string[] {
  if (!graph.people.has(id)) return [];
  const seen = new Set<string>([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of graph.neighbours.get(current) ?? []) {
      const next = otherEnd(edge, current);
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  seen.delete(id);
  return [...seen].sort();
}

/**
 * The shortest chain of documented relations from one person to another.
 *
 * Breadth-first, so the path returned is a shortest one — the fewest hops the
 * record needs to connect the two. Returns the node sequence including both
 * ends (`[a, …, b]`), a single `[a]` when they are the same person, or `null`
 * when no chain of relations connects them at all. There can be several equally
 * short paths; this returns one, which is enough to answer "are these two
 * connected, and how".
 */
export function shortestPath(graph: Graph, a: string, b: string): string[] | null {
  if (!graph.people.has(a) || !graph.people.has(b)) return null;
  if (a === b) return [a];
  const came = new Map<string, string | null>([[a, null]]);
  const queue = [a];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === b) break;
    for (const edge of graph.neighbours.get(current) ?? []) {
      const next = otherEnd(edge, current);
      if (came.has(next)) continue;
      came.set(next, current);
      queue.push(next);
    }
  }
  if (!came.has(b)) return null;
  const path: string[] = [];
  for (let step: string | null = b; step !== null; step = came.get(step) ?? null) {
    path.push(step);
  }
  return path.reverse();
}

/** The edge joining two people the path says are adjacent, for naming the hop. */
export function edgeBetween(graph: Graph, x: string, y: string): Edge | null {
  for (const edge of graph.neighbours.get(x) ?? []) {
    if (otherEnd(edge, x) === y) return edge;
  }
  return null;
}

/**
 * How many of these people won a Nobel Prize.
 *
 * This is the number the page leads with, and the distinction matters: the
 * graph is mostly *not* laureates. Reaching 1142 people sounds enormous and
 * means less than it sounds, because two thirds of them are the teachers who
 * carry the connection. "How many other laureates" is the question a visitor
 * actually arrives with, so it is the one the readout answers first.
 */
export function laureatesAmong(graph: Graph, ids: string[]): number {
  return ids.filter((id) => graph.people.get(id)?.laureate).length;
}

/** Every connected component, largest first. Used for the page's own figures. */
export function components(graph: Graph): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of graph.people.keys()) {
    if (seen.has(id)) continue;
    const group = [id, ...reachedFrom(graph, id)];
    for (const member of group) seen.add(member);
    out.push(group.sort());
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Laureates in a group, counted once. */
function laureatesIn(group: string[], graph: Graph): number {
  return group.filter((id) => graph.people.get(id)?.laureate).length;
}

/**
 * How many laureates reach at least one OTHER laureate, by any chain.
 *
 * A laureate is "linked" when the connected group they sit in holds two or more
 * laureates -- so there is somebody on the far end of the relations who also won
 * one. This is the number the landing question turns on, and it is counted from
 * the snapshot rather than quoted: it must stay true to the file even as the
 * file changes. It is a floor, not the finding -- the unlinked remainder is
 * mostly a gap in what Wikidata records, not proof anybody worked alone.
 */
export function linkedLaureates(graph: Graph): number {
  return components(graph).reduce((total, group) => {
    const here = laureatesIn(group, graph);
    return total + (here >= 2 ? here : 0);
  }, 0);
}

/**
 * Figures about *this* graph, computed rather than quoted.
 *
 * CLAUDE.md: never state a count the snapshot cannot produce. Tol's 696-of-727
 * is about Tol's dataset, not this one, and the page keeps the two claims in
 * separate sentences. These are the numbers the page is allowed to call its own.
 */
export function summarise(graph: Graph) {
  const groups = components(graph);
  const largest = groups[0] ?? [];
  const laureates = [...graph.people.values()].filter((person) => person.laureate);
  const largestLaureates = largest.filter((id) => graph.people.get(id)?.laureate).length;
  return {
    people: graph.people.size,
    laureates: laureates.length,
    edges: graph.edges.length,
    components: groups.length,
    largestComponent: largest.length,
    largestComponentLaureates: largestLaureates,
    // The gap between these two is the finding. It is a cliff, not a slope.
    secondLargestComponent: groups[1]?.length ?? 0,
    // Laureates with no recorded relation of any kind. This is a hole in the
    // record, not evidence that anybody worked alone, and the page has to say
    // so in the same breath as the number -- an earlier draft invited visitors
    // to "find someone who lights up nothing", which a third of the laureates
    // satisfy for reasons that have nothing to do with the argument.
    isolatedLaureates: laureates.filter((person) => (graph.neighbours.get(person.id) ?? []).length === 0)
      .length,
    unsourcedEdges: graph.edges.filter((edge) => edge.provenance === "wikidata-unsourced").length,
    // Laureates linked to at least one other, by any chain -- the number the
    // landing question turns on. Counted from the same groups, so it cannot
    // drift from the figures above it.
    linkedLaureates: groups.reduce((total, group) => {
      const here = laureatesIn(group, graph);
      return total + (here >= 2 ? here : 0);
    }, 0),
  };
}

/** Case- and accent-insensitive, so searching "curie" finds "Marie Curie". */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Name search. Laureates first, then by how early the match starts, then
 * alphabetically -- so a short exact-ish match beats a long incidental one and
 * the order is stable enough to assert in a test.
 */
export function search(graph: Graph, query: string, limit = 20): Person[] {
  const needle = normalise(query);
  if (!needle) return [];
  const hits: { person: Person; at: number }[] = [];
  for (const person of graph.people.values()) {
    const at = normalise(person.name).indexOf(needle);
    if (at >= 0) hits.push({ person, at });
  }
  hits.sort(
    (a, b) =>
      Number(b.person.laureate) - Number(a.person.laureate) ||
      a.at - b.at ||
      a.person.name.localeCompare(b.person.name),
  );
  return hits.slice(0, limit).map((hit) => hit.person);
}

/**
 * First and last initial, for a laureate the page has no photograph of.
 *
 * Twenty-two of them have none, because nobody has released a picture of them
 * under a licence this page can honour. Drawn as a plain dot among faces they
 * read as something that failed to load; their initials say the opposite --
 * this is a person, we know exactly who, and what is missing is the photograph
 * rather than the identification.
 *
 * Nobiliary particles are skipped, so Johannes Diderik van der Waals is a JW
 * and not a JV.
 */
export function initialsOf(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word) && !/^(van|von|de|der|den|du|di|la|le|el)$/i.test(word));
  const first = words.at(0)?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** How a relation reads in a sentence, from the selected person's side. */
export function describeEdge(edge: Edge, from: string): string {
  if (edge.type === "supervised") {
    return edge.from === from ? "supervised" : "was supervised by";
  }
  if (edge.kin === "parent") return edge.from === from ? "is the parent of" : "is the child of";
  if (edge.kin === "spouse") return "was married to";
  return "is the sibling of";
}
