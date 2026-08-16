// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildGraph, edgeBetween, reachedFrom, shortestPath } from "../graph.ts";
import type { Snapshot } from "../graph.ts";

// The two-laureate path finder. shortestPath is proved against the data as a
// plain function; then the page is driven the way a visitor and the keyboard
// both do -- type two names, choose two results, read the chain.

const snapshot = JSON.parse(readFileSync(resolve("data/nobel.json"), "utf8")) as Snapshot;
const graph = buildGraph(snapshot);

const laureates = [...graph.people.values()].filter((p) => p.laureate);
// A laureate whose component holds another laureate, and one it can reach.
const source = laureates.find((p) =>
  reachedFrom(graph, p.id).some((id) => graph.people.get(id)?.laureate),
)!;
const target = reachedFrom(graph, source.id).find((id) => graph.people.get(id)?.laureate)!;
// A laureate with no relation of any kind: unreachable from anyone.
const island = laureates.find((p) => (graph.neighbours.get(p.id) ?? []).length === 0)!;

describe("shortestPath", () => {
  it("connects two laureates the data links, end to end", () => {
    const path = shortestPath(graph, source.id, target);
    expect(path).not.toBeNull();
    expect(path![0]).toBe(source.id);
    expect(path!.at(-1)).toBe(target);
  });

  it("returns a chain where every adjacent pair is a real edge", () => {
    const path = shortestPath(graph, source.id, target)!;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(edgeBetween(graph, path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`).not.toBeNull();
    }
  });

  it("visits each person at most once, so the path has no cycle", () => {
    const path = shortestPath(graph, source.id, target)!;
    expect(new Set(path).size).toBe(path.length);
  });

  it("is a single node for a person and themselves", () => {
    expect(shortestPath(graph, source.id, source.id)).toEqual([source.id]);
  });

  it("is null when no chain of relations connects the two", () => {
    expect(shortestPath(graph, source.id, island.id)).toBeNull();
  });
});

describe("tracing a path on the page", () => {
  beforeAll(async () => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    HTMLCanvasElement.prototype.getContext = () => null;
    const html = readFileSync(resolve("index.html"), "utf8");
    document.documentElement.innerHTML = html
      .replace(/[\s\S]*<body[^>]*>/i, "")
      .replace(/<\/body>[\s\S]*/i, "");
    await import("../main.ts");
  });

  const type = (testid: string, value: string) => {
    const box = document.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!;
    box.value = value;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const chooseIn = (listTestid: string, id: string) =>
    [...document.querySelectorAll<HTMLButtonElement>(`[data-testid="${listTestid}"] button.result`)].find(
      (button) => button.dataset.id === id,
    )!;

  it("shows the chain and its length once both ends are chosen", () => {
    type("path-a", graph.people.get(source.id)!.name);
    chooseIn("path-a-results", source.id).click();
    type("path-b", graph.people.get(target)!.name);
    chooseIn("path-b-results", target).click();

    const summary = document.querySelector<HTMLElement>('[data-testid="path-summary"]');
    expect(summary, "no path summary rendered").toBeTruthy();
    expect(summary!.dataset.steps).toBe(String(shortestPath(graph, source.id, target)!.length - 1));

    const text = document.querySelector('[data-testid="path-readout"]')!.textContent ?? "";
    expect(text).toContain(graph.people.get(source.id)!.name);
    expect(text).toContain(graph.people.get(target)!.name);
  });

  it("says so plainly when two laureates are not connected in this data", () => {
    type("path-a", graph.people.get(source.id)!.name);
    chooseIn("path-a-results", source.id).click();
    type("path-b", graph.people.get(island.id)!.name);
    chooseIn("path-b-results", island.id).click();

    expect(document.querySelector('[data-testid="path-summary"]')).toBeNull();
    expect(document.querySelector(".path-empty")?.textContent?.toLowerCase()).toContain("no path");
  });
});
