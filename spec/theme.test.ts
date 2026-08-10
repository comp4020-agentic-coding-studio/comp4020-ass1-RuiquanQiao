// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { contrast } from "../render.ts";

// Two halves, because a theme can fail in two unrelated ways.
//
// The first is that a colour is unreadable. Nothing in this repo measured that
// before -- CLAUDE.md says as much -- and adding the sensor immediately found a
// pre-existing one: .notes-quiet was #6b7280 on #0d0f14, which is 3.97:1 at
// 0.8rem, under AA. It had been shipping since the first commit, in the dark
// theme, with nothing to catch it. That is the argument for the sensor.
//
// The second is that a theme forgets a variable and silently inherits the
// other one's value, which is how a white page ends up with grey-on-grey
// badges. Comparing the two declaration blocks catches that before a browser
// does.

const css = readFileSync(resolve("styles.css"), "utf8");

/** The custom properties declared by one selector's block. */
function palette(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} declares no block in styles.css`).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf("}", start));
  const found: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    found[`--${name}`] = value!.trim();
  }
  return found;
}

const THEMES = {
  dark: palette(":root"),
  light: palette('[data-theme="light"]'),
};

/**
 * Every pair where one of these colours is painted as text on another.
 *
 * Read off the rules that use them: --ink is body text and sits on the page and
 * inside the panel; --gold is the readout's headline, the follow-up figure, a
 * laureate's name in the relations list, and the current search result; the
 * three badge pairs are the provenance chips.
 */
const TEXT_ON = [
  ["--ink", "--bg"],
  ["--ink", "--panel"],
  ["--ink-quiet", "--bg"],
  ["--ink-quiet", "--panel"],
  ["--ink-faint", "--bg"],
  ["--gold", "--bg"],
  ["--gold", "--panel"],
  ["--gold", "--current-bg"],
  ["--sourced-ink", "--sourced-bg"],
  ["--unsourced-ink", "--unsourced-bg"],
  ["--official-ink", "--official-bg"],
] as const;

describe("both themes declare the same colours", () => {
  it("names every variable in both, so neither can inherit the other's", () => {
    expect(Object.keys(THEMES.light).sort()).toEqual(Object.keys(THEMES.dark).sort());
  });

  it("gives every variable a hex, so the pairs below are actually measurable", () => {
    for (const [theme, colours] of Object.entries(THEMES)) {
      for (const [name, value] of Object.entries(colours)) {
        // Three-digit shorthand is allowed because stylelint insists on it.
        expect(value, `${theme} ${name}`).toMatch(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      }
    }
  });

  it("does not ship the same palette twice", () => {
    expect(THEMES.light["--bg"]).not.toBe(THEMES.dark["--bg"]);
    expect(THEMES.light["--ink"]).not.toBe(THEMES.dark["--ink"]);
  });

  it("sets color-scheme in both, so form controls and scrollbars follow", () => {
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/);
    expect(css).toMatch(/\[data-theme="light"\]\s*\{[^}]*color-scheme:\s*light/);
  });
});

describe("every text colour clears WCAG AA in both themes", () => {
  for (const [theme, colours] of Object.entries(THEMES)) {
    for (const [ink, on] of TEXT_ON) {
      it(`${theme}: ${ink} on ${on}`, () => {
        const ratio = contrast(colours[ink]!, colours[on]!);
        expect(
          ratio,
          `${colours[ink]} on ${colours[on]} is ${ratio.toFixed(2)}:1, AA wants 4.5`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("the gold keeps meaning laureate in both themes", () => {
  // CLAUDE.md's honesty rule, applied to the theme: light mode may darken the
  // gold to make it readable on paper, but swapping it for a hue that sits
  // more comfortably on white would break the one thing the colour says.
  it("stays a warm hue on both sides, not a different colour", () => {
    for (const [theme, colours] of Object.entries(THEMES)) {
      const [r, g, b] = [1, 3, 5].map((at) => parseInt(colours["--gold"]!.slice(at, at + 2), 16));
      expect(r!, `${theme} gold`).toBeGreaterThan(g!);
      expect(g!, `${theme} gold`).toBeGreaterThan(b!);
    }
  });
});

// --- the control ------------------------------------------------------------

const NAV = "<head></head><body><header><nav class='nav'></nav></header></body>";

/**
 * Load theme.ts against a chosen starting state.
 *
 * The `dataset.theme` line is the shipped pre-paint snippet's whole job; the
 * snippet itself is asserted against the built pages in spec/site.test.ts, so
 * between the two files nothing about the opening state is taken on trust.
 */
async function load(stored?: string) {
  vi.resetModules();
  localStorage.clear();
  document.documentElement.innerHTML = NAV;
  delete document.documentElement.dataset.theme;
  if (stored !== undefined) localStorage.setItem("one-tree-theme", stored);
  if (stored === "light") document.documentElement.dataset.theme = "light";
  return await import("../theme.ts");
}

const toggle = () => document.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]');

describe("the toggle", () => {
  it("opens dark when nothing has been chosen, whatever the system prefers", async () => {
    const theme = await load();
    expect(theme.currentTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    // The decision, stated where it can fail: no media query anywhere.
    expect(readFileSync(resolve("theme.ts"), "utf8")).not.toContain("matchMedia");
  });

  it("is a real button in the nav, not a div with a handler", async () => {
    await load();
    expect(toggle()?.tagName).toBe("BUTTON");
    expect(toggle()?.type).toBe("button");
    expect(toggle()?.closest("nav")).toBeTruthy();
  });

  it("names the action it will perform, not just the state it shows", async () => {
    await load();
    expect(toggle()?.getAttribute("aria-label")).toBe("Switch to the light theme");
    expect(toggle()?.textContent).toContain("Dark");
  });

  it("flips the page and remembers it", async () => {
    const theme = await load();
    toggle()!.click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("one-tree-theme")).toBe("light");
    expect(theme.currentTheme()).toBe("light");
    expect(toggle()?.getAttribute("aria-label")).toBe("Switch to the dark theme");
    expect(toggle()?.textContent).toContain("Light");
  });

  it("flips back, and records the choice rather than clearing it", async () => {
    const theme = await load();
    toggle()!.click();
    toggle()!.click();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    // Written, not deleted: "I chose dark" and "I have not chosen" are the same
    // page today, and would stop being the same the day a system default lands.
    expect(localStorage.getItem("one-tree-theme")).toBe("dark");
    expect(theme.currentTheme()).toBe("dark");
  });

  it("honours a stored choice on load", async () => {
    const theme = await load("light");
    expect(theme.currentTheme()).toBe("light");
    expect(toggle()?.textContent).toContain("Light");
  });

  it("tells the canvas, which is the one thing CSS cannot repaint", async () => {
    const theme = await load();
    let told = 0;
    theme.onThemeChange(() => told++);
    toggle()!.click();
    expect(told).toBe(1);
  });

  it("does nothing rather than throwing on a page with no nav", async () => {
    vi.resetModules();
    document.documentElement.innerHTML = "<head></head><body></body>";
    const theme = await import("../theme.ts");
    expect(theme.mountToggle()).toBeNull();
  });
});
