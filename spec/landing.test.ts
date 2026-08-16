// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildGraph, linkedLaureates, summarise } from "../graph.ts";
import type { Snapshot } from "../graph.ts";

// The opening guess, and the number it turns on.
//
// The claim the question makes -- "more than half of all laureates link to
// another" -- is only allowed on the page if the snapshot actually says so, so
// the first block proves it from the data. The rest drives the overlay the way
// a visitor and the keyboard both do: guess, get told, go in.

const snapshot = JSON.parse(readFileSync(resolve("data/nobel.json"), "utf8")) as Snapshot;
const graph = buildGraph(snapshot);
const figures = summarise(graph);
const pct = Math.round((figures.linkedLaureates / figures.laureates) * 100);

const el = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const click = (testid: string) =>
  document.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!.click();

beforeAll(async () => {
  try {
    localStorage.clear();
  } catch {
    // jsdom always has it, but the page guards the read and so does the test.
  }
  const html = readFileSync(resolve("index.html"), "utf8");
  document.documentElement.innerHTML = html
    .replace(/[\s\S]*<body[^>]*>/i, "")
    .replace(/<\/body>[\s\S]*/i, "");
  await import("../landing.ts");
});

describe("the number the question turns on", () => {
  it("is counted from the snapshot, and the summary reports the same figure", () => {
    expect(summarise(graph).linkedLaureates).toBe(linkedLaureates(graph));
  });

  // The question says "more than half". If a future snapshot ever dropped below
  // that, the question would be a false claim and this is what would catch it.
  it("is more than half, so 'true' is the correct answer", () => {
    expect(linkedLaureates(graph)).toBeGreaterThan(figures.laureates / 2);
    expect(pct).toBeGreaterThan(50);
  });

  it("never counts more laureates as linked than the snapshot holds", () => {
    expect(linkedLaureates(graph)).toBeLessThanOrEqual(figures.laureates);
  });
});

describe("the opening guess", () => {
  it("shows itself on a first visit, with the answer still hidden", () => {
    expect(el("landing")?.hidden).toBe(false);
    expect(el("landing-reveal")?.hidden).toBe(true);
  });

  it("asks its question in the markup, before any script has answered it", () => {
    expect(el("landing")?.textContent?.toLowerCase()).toContain("half");
  });

  it("corrects a wrong guess rather than just scoring it", () => {
    click("landing-false");
    expect(el("landing-reveal")?.hidden).toBe(false);
    expect(el("landing-verdict")?.textContent?.toLowerCase()).toContain("not quite");
  });

  it("confirms the right guess and reveals the real figure, counted from the data", () => {
    click("landing-true");
    expect(el("landing-verdict")?.textContent?.toLowerCase()).toContain("right");
    const explain = el("landing-explain")?.textContent ?? "";
    expect(explain).toContain(String(pct));
    expect(explain).toContain(String(figures.laureates));
    // The honesty caveat travels with the number, so the unlinked remainder
    // never reads as proof anybody worked alone.
    expect(explain.toLowerCase()).toContain("gap");
  });

  it("lets you into the graph, and stays gone once you are in", () => {
    click("landing-enter");
    expect(el("landing")?.hidden).toBe(true);
  });
});
