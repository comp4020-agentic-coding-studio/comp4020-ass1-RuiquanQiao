// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildGraph, directOf, laureatesAmong, reachedFrom } from "../graph.ts";
import type { Snapshot } from "../graph.ts";

// The core interaction, end to end through the real page.
//
// spec/graph.test.ts proves the two tiers are computed correctly. This proves
// the page is wired to them -- that what a visitor sees after clicking is the
// same answer, not a second implementation that happens to look similar.
//
// It also proves the keyboard path exists: every assertion below is driven by
// typing and activating buttons, never by clicking the canvas. If this file
// passes, the page is operable without a pointer.

const snapshot = JSON.parse(
  readFileSync(resolve("data/nobel.json"), "utf8"),
) as Snapshot;
const graph = buildGraph(snapshot);

/** A laureate with relations, chosen from the data rather than hard-coded. */
const wellConnected = [...graph.people.values()]
  .filter((person) => person.laureate)
  .map((person) => ({ person, direct: directOf(graph, person.id).length }))
  .sort((a, b) => b.direct - a.direct)[0]!.person;

const results = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-testid="results"] button.result')];
const counts = () => document.querySelector<HTMLElement>('[data-testid="counts"]');

beforeAll(async () => {
  // jsdom has no canvas and no ResizeObserver. The page is written to survive
  // both being absent, which is the same defensiveness that keeps it alive on a
  // browser that fails to allocate a 2d context.
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

function type(value: string): void {
  const box = document.querySelector<HTMLInputElement>('[data-testid="search"]')!;
  box.value = value;
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("the page loads", () => {
  it("finds every element it needs, or main.ts would have thrown", () => {
    expect(document.querySelector('[data-testid="canvas"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="search"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="readout"]')).toBeTruthy();
  });

  it("starts with nothing selected", () => {
    expect(document.querySelector(".readout-empty")).toBeTruthy();
    expect(counts()).toBeNull();
  });

  it("prints figures counted from the snapshot, not typed in by hand", () => {
    const provenance = document.querySelector('[data-testid="provenance"]')!.textContent ?? "";
    expect(provenance).toContain(snapshot.fetchedAt);
    expect(provenance).toContain(String(graph.people.size));
  });
});

describe("search", () => {
  it("finds nothing before you type", () => {
    expect(results()).toHaveLength(0);
  });

  it("offers the person you typed", () => {
    type(wellConnected.name.slice(0, 6));
    expect(results().some((button) => button.dataset.id === wellConnected.id)).toBe(true);
  });

  it("offers nothing for a name that is not in the data", () => {
    type("zzzzzzzzzz");
    expect(results()).toHaveLength(0);
  });
});

describe("selecting somebody", () => {
  beforeAll(() => {
    type(wellConnected.name.slice(0, 6));
    results().find((button) => button.dataset.id === wellConnected.id)!.click();
  });

  it("names them in the readout", () => {
    expect(document.querySelector(".readout-name")?.textContent).toContain(wellConnected.name);
  });

  // The contract. Both tiers, straight off the DOM, compared against the graph.
  it("reports exactly the direct tier the data says", () => {
    expect(counts()?.dataset.direct).toBe(String(directOf(graph, wellConnected.id).length));
  });

  it("reports exactly the reached tier the data says", () => {
    expect(counts()?.dataset.reached).toBe(String(reachedFrom(graph, wellConnected.id).length));
  });

  // The number a visitor came for. Reaching 1142 people sounds enormous and
  // means less than it sounds, because two thirds of them never won anything --
  // so the readout leads with how many *laureates* are on the far end.
  it("leads with how many other laureates were reached", () => {
    const reached = reachedFrom(graph, wellConnected.id);
    const expected = laureatesAmong(graph, reached);
    expect(counts()?.dataset.laureates).toBe(String(expected));
    expect(expected).toBeLessThan(reached.length);
    expect(document.querySelector(".readout-number")?.textContent).toContain(String(expected));
  });

  it("lists every direct relation with a source you can open", () => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".relation .provenance")];
    expect(links.length).toBe(graph.neighbours.get(wellConnected.id)!.length);
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\/www\.wikidata\.org\//);
    }
  });

  it("says out loud when a claim has no reference behind it", () => {
    const unsourced = graph.neighbours
      .get(wellConnected.id)!
      .filter((edge) => edge.references === 0).length;
    const shown = [...document.querySelectorAll(".relation .provenance")].filter(
      (link) => link.textContent === "no reference",
    ).length;
    expect(shown).toBe(unsourced);
  });

  // The list is direct relations only -- the precise answer to "who actually
  // taught or married whom". But a reader cannot be expected to know which of
  // those names won something and which merely held the chain together, and
  // most of them did not win. It says so in the canvas's own two shapes.
  it("says which direct relations are laureates and which are not", () => {
    const items = [...document.querySelectorAll<HTMLLIElement>(".relation")];
    expect(items.length).toBe(graph.neighbours.get(wellConnected.id)!.length);
    for (const item of items) {
      const link = item.querySelector<HTMLButtonElement>(".relation-link")!;
      const person = graph.people.get(link.dataset.id!)!;
      expect(item.dataset.laureate).toBe(String(person.laureate));
      expect(item.querySelector(".relation-mark")?.textContent).toBe(person.laureate ? "●" : "○");
      expect(link.classList.contains("relation-link-laureate")).toBe(person.laureate);
    }
  });

  it("puts that distinction in words as well, so it is not carried by colour alone", () => {
    for (const link of document.querySelectorAll<HTMLButtonElement>(".relation-link")) {
      const person = graph.people.get(link.dataset.id!)!;
      expect(link.getAttribute("aria-label")).toBe(
        person.laureate ? `${person.name}, Nobel laureate` : `${person.name}, no Nobel Prize`,
      );
    }
  });

  it("marks the selection in the result list, so the keyboard can see it too", () => {
    const current = results().find((button) => button.getAttribute("aria-current") === "true");
    expect(current?.dataset.id).toBe(wellConnected.id);
  });

  it("moves the selection when a related person is activated", () => {
    const jump = document.querySelector<HTMLButtonElement>(".relation-link")!;
    const target = jump.dataset.id!;
    jump.click();
    expect(counts()?.dataset.direct).toBe(String(directOf(graph, target).length));
    expect(counts()?.dataset.reached).toBe(String(reachedFrom(graph, target).length));
  });
});

describe("zooming", () => {
  const button = (name: string) =>
    document.querySelector<HTMLButtonElement>(`[data-testid="${name}"]`)!;
  const level = () => document.querySelector('[data-testid="zoom-level"]')?.textContent;

  it("gives the canvas a keyboard route in, since the canvas itself cannot take focus", () => {
    // The canvas is aria-hidden, so it is invisible to the tab order by design.
    // Everything the wheel can do has to be reachable from these.
    for (const name of ["zoom-in", "zoom-out", "zoom-reset"]) {
      expect(button(name).tagName).toBe("BUTTON");
      expect(button(name).type).toBe("button");
    }
    expect(document.querySelector('[data-testid="zoom"]')?.getAttribute("role")).toBe("group");
    expect(document.querySelector('[data-testid="zoom"]')?.getAttribute("aria-label")).toBeTruthy();
  });

  it("starts showing the whole graph, with no way to zoom further out", () => {
    expect(level()).toBe("1.0×");
    expect(button("zoom-out").disabled).toBe(true);
    expect(button("zoom-in").disabled).toBe(false);
  });

  it("reports the level it is actually at", () => {
    button("zoom-in").click();
    expect(level()).toBe("1.4×");
    button("zoom-in").click();
    expect(level()).toBe("1.8×");
    expect(button("zoom-out").disabled).toBe(false);
  });

  it("goes back to the whole graph", () => {
    button("zoom-in").click();
    button("zoom-reset").click();
    expect(level()).toBe("1.0×");
    expect(button("zoom-out").disabled).toBe(true);
  });

  // Zoom is a change of view, never a change of state. Losing the person you
  // were looking at because you scrolled would be the page taking the answer
  // away mid-question.
  it("does not disturb the selection", () => {
    type(wellConnected.name.slice(0, 6));
    results().find((b) => b.dataset.id === wellConnected.id)!.click();
    const before = counts()?.dataset.reached;
    button("zoom-in").click();
    button("zoom-in").click();
    button("zoom-reset").click();
    expect(document.querySelector(".readout-name")?.textContent).toContain(wellConnected.name);
    expect(counts()?.dataset.reached).toBe(before);
  });

  it("stops at a ceiling instead of zooming forever", () => {
    for (let i = 0; i < 40; i += 1) button("zoom-in").click();
    expect(level()).toBe("12.0×");
    expect(button("zoom-in").disabled).toBe(true);
    button("zoom-reset").click();
  });
});

describe("keyboard operability", () => {
  it("gives every control a real focusable element, not a div with a handler", () => {
    type(wellConnected.name.slice(0, 6));
    for (const button of results()) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.hasAttribute("disabled")).toBe(false);
    }
  });

  it("selects the first result when the search form is submitted", () => {
    type(wellConnected.name.slice(0, 6));
    const first = results()[0]!;
    document
      .querySelector<HTMLFormElement>('[data-testid="finder"]')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".readout-name")?.textContent).toContain(first.textContent!.split(" — ")[0]);
  });
});
