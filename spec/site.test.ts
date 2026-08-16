import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Contracts about the site that actually ships, checked against dist/.
//
// Two of these exist because CI can fail in ways that are invisible locally.
// `linkinator` cannot be run in this checkout -- its own dependency fails to
// resolve under this pnpm store -- so the internal-link check is reimplemented
// here, which is the part worth having before a push. And linkinator validates
// *outbound* links too, from a datacentre IP, so every external host is a
// chance for somebody else's server to fail the deploy. Hence the allowlist.

const DIST = resolve("dist");

const ALLOWED_HOSTS = ["www.wikidata.org", "www.nobelprize.org", "commons.wikimedia.org"];

/**
 * How many anchors may point at Commons from the *built* HTML.
 *
 * This is the assertion that keeps the deploy alive. 731 portraits each have a
 * Commons file page, and linking every one of them from the credits page would
 * put 731 outbound links in front of `linkinator ./dist`, which validates them
 * from a datacentre IP on every push. Commons would rate-limit, `check` would
 * fail, and `deploy` needs `check`. So the per-portrait links are built in
 * JavaScript in the readout, where linkinator never sees them, and the static
 * pages carry the credit as text with one link between them.
 */
const COMMONS_ANCHOR_BUDGET = 2;

function htmlFiles(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

const pages = htmlFiles().map((path) => ({
  name: relative(DIST, path).replaceAll("\\", "/"),
  dir: path.slice(0, path.lastIndexOf("\\") + 1 || path.lastIndexOf("/") + 1),
  doc: new JSDOM(readFileSync(path, "utf8")).window.document,
}));

describe("the built site", () => {
  it("ships every page", () => {
    const names = pages.map((page) => page.name).sort();
    expect(names).toEqual([
      "about/index.html",
      "credits/index.html",
      "index.html",
      // Three portraits are GFDL 1.2, whose condition is that a copy of the
      // licence travels with the work. This is that copy, and shipping it is
      // what makes those three faces usable rather than monograms.
      "licences/gfdl-1.2/index.html",
    ]);
  });

  it("carries the GFDL text whenever it ships a portrait under it", () => {
    const book = JSON.parse(readFileSync(resolve("data/portraits.json"), "utf8")) as {
      portraits: Record<string, { licence: string }>;
    };
    const gfdl = Object.values(book.portraits).filter((c) => c.licence.startsWith("GFDL"));
    if (!gfdl.length) return;
    const page = pages.find((p) => p.name === "licences/gfdl-1.2/index.html");
    expect(page, `${gfdl.length} GFDL portraits ship with no copy of the licence`).toBeTruthy();
    const text = page!.doc.querySelector(".licence")?.textContent ?? "";
    // The whole thing, not a summary: the licence itself forbids modification.
    expect(text).toContain("GNU Free Documentation License");
    expect(text).toContain("Version 1.2, November 2002");
    expect(text.length).toBeGreaterThan(18000);
  });

  it("kept no trace of the starter page", () => {
    for (const { name, doc } of pages) {
      expect(doc.querySelector('[data-testid="intro"]'), name).toBeNull();
      expect(doc.body.textContent, name).not.toContain("Replace this with your prototype");
    }
  });
});

describe("the theme is settled before the first paint", () => {
  // theme.ts is a module and therefore deferred, so without this snippet a
  // visitor who chose light would be shown a dark page and watch it change
  // under them. It is duplicated by hand in both pages; these assertions are
  // what stops the two copies drifting apart, or one of them being dropped in
  // a later edit. spec/theme.test.ts holds the module's half of the contract.
  for (const { name, doc } of pages) {
    it(`${name} sets the stored theme in the head, before the stylesheet`, () => {
      const inline = [...doc.querySelectorAll("head script:not([src])")].map(
        (script) => script.textContent ?? "",
      );
      const snippet = inline.find((text) => text.includes("one-tree-theme"));
      expect(snippet, "no pre-paint theme script in the head").toBeTruthy();
      expect(snippet).toContain("dataset.theme");
      // Reading localStorage throws outright in some privacy modes, and an
      // uncaught throw here would stop the parser before the page renders.
      expect(snippet).toContain("try");
    });
  }

  it("loads the theme module on the about page, which has no main.ts", () => {
    const about = pages.find((page) => page.name === "about/index.html")!;
    const modules = [...about.doc.querySelectorAll('script[type="module"][src]')].map(
      (script) => script.getAttribute("src")!,
    );
    expect(modules.length).toBeGreaterThan(0);
  });
});

describe("links", () => {
  it("resolves every internal reference to a file that exists", () => {
    for (const { name, dir, doc } of pages) {
      const refs = [
        ...[...doc.querySelectorAll("a[href]")].map((el) => el.getAttribute("href")!),
        ...[...doc.querySelectorAll("link[href]")].map((el) => el.getAttribute("href")!),
        ...[...doc.querySelectorAll("script[src]")].map((el) => el.getAttribute("src")!),
        ...[...doc.querySelectorAll("img[src]")].map((el) => el.getAttribute("src")!),
      ];
      for (const ref of refs) {
        if (/^(https?:|mailto:|#)/.test(ref)) continue;
        const clean = ref.split(/[?#]/)[0]!;
        // A directory URL resolves to its index.html, which is how the pretty
        // URLs stay pretty. Verified against a real linkinator run in C2.
        const target = clean.endsWith("/") ? join(dir, clean, "index.html") : join(dir, clean);
        expect(existsSync(target), `${name} links to ${ref}, which is not in dist/`).toBe(true);
      }
    }
  });

  it("only leaves the site for a host on the allowlist", () => {
    for (const { name, doc } of pages) {
      for (const anchor of doc.querySelectorAll("a[href^='http']")) {
        const host = new URL(anchor.getAttribute("href")!).host;
        expect(ALLOWED_HOSTS, `${name} links out to ${host}`).toContain(host);
      }
    }
  });

  // The one that keeps the deploy alive. See the note on the budget above.
  it("gives linkinator only a handful of Commons links to validate", () => {
    let total = 0;
    for (const { doc } of pages) {
      total += doc.querySelectorAll("a[href*='commons.wikimedia.org']").length;
    }
    expect(
      total,
      `${total} Commons anchors in the built HTML; linkinator validates every one of them ` +
        `from a datacentre IP on every push, and the per-portrait links belong in the readout`,
    ).toBeLessThanOrEqual(COMMONS_ANCHOR_BUDGET);
  });
});

describe("the portraits are credited where a script cannot fail to load", () => {
  const credits = pages.find((page) => page.name === "credits/index.html")!;

  it("ships every credit as static markup", () => {
    const rows = credits.doc.querySelectorAll('[data-testid="credits"] .credit');
    const book = JSON.parse(readFileSync(resolve("data/portraits.json"), "utf8")) as {
      portraits: Record<string, unknown>;
    };
    expect(rows.length).toBe(Object.keys(book.portraits).length);
  });

  it("names a creator and a licence on every row", () => {
    for (const row of credits.doc.querySelectorAll('[data-testid="credits"] .credit')) {
      const what = row.querySelector(".credit-what")?.textContent ?? "";
      expect(row.querySelector(".credit-who")?.textContent?.trim()).toBeTruthy();
      // "<file> — <creator> — <licence>", so two separators and three parts.
      expect(what.split("—").length, what).toBe(3);
    }
  });

  it("is reachable from the other pages", () => {
    for (const { name, doc } of pages) {
      if (name === "credits/index.html") continue;
      const links = [...doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")!);
      expect(links.some((href) => href.includes("credits")), `${name} does not link to it`).toBe(
        true,
      );
    }
  });
});

describe("the graph is a view, not the only way in", () => {
  const home = pages.find((page) => page.name === "index.html")!;

  // CLAUDE.md: canvas content is invisible to the tab order and the artefact
  // band names the keyboard explicitly, so everything reachable by clicking has
  // to be reachable by typing. These assert the door exists in the shipped
  // markup; spec/interaction.test.ts drives it.
  it("hides the canvas from assistive technology rather than lying about it", () => {
    const canvas = home.doc.querySelector('[data-testid="canvas"]')!;
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
  });

  it("ships a labelled search control", () => {
    const input = home.doc.querySelector<HTMLInputElement>('[data-testid="search"]')!;
    const label = home.doc.querySelector(`label[for="${input.id}"]`);
    expect(input.id).toBeTruthy();
    expect(label?.textContent?.trim()).toBeTruthy();
  });

  it("announces the selection to a screen reader", () => {
    const readout = home.doc.querySelector('[data-testid="readout"]')!;
    expect(readout.getAttribute("aria-live")).toBe("polite");
  });
});

describe("the page says what it is", () => {
  const home = pages.find((page) => page.name === "index.html")!;
  const text = home.doc.body.textContent ?? "";

  it("states that it is unaffiliated", () => {
    expect(text.toLowerCase()).toContain("not affiliated");
  });

  // The honesty rule that is easiest to lose in a redesign: Tol's 696-of-727 is
  // about Tol's dataset, and this page counts its own figures. If a layout pass
  // ever drops that sentence, this fails.
  it("keeps its own numbers separate from the ones it quotes", () => {
    expect(text).toContain("696");
    expect(text.toLowerCase()).toContain("his dataset, not this one");
  });

  // A third of the laureates here light up nobody, because Wikidata has no
  // relation recorded for them. Wherever that count is reported, what it means
  // has to be reported with it -- otherwise a hole in the record reads as a
  // finding about science. The count and the caveat both live in the follow-up
  // section, which is a real question with a heading, not small print.
  it("keeps the count of unattached laureates and its meaning together", () => {
    const scale = home.doc.querySelector('[data-testid="scale"]');
    const caveat = home.doc.querySelector('[data-testid="caveat"]');
    expect(scale?.closest(".followup"), "the count left the follow-up section").toBeTruthy();
    expect(caveat?.closest(".followup"), "the caveat left the follow-up section").toBeTruthy();
    expect(caveat?.closest(".notes"), "the caveat was demoted into the small print").toBeFalsy();
    expect(home.doc.querySelector(".followup-title")?.textContent?.trim()).toBeTruthy();
  });

  // The page has to ask its question before it answers it. An earlier headline
  // was "Find a second tree", which is the question you have after playing with
  // this for a minute, not the one you arrive with -- nobody turns up wondering
  // whether a rival lineage exists. They turn up wondering how far one name
  // reaches. The invitation comes first and the follow-up comes after the graph.
  it("puts the invitation before the graph and the second question after it", () => {
    const order = [...home.doc.querySelectorAll(".intro, .stage, .followup")].map(
      (section) => section.className.split(" ")[0],
    );
    expect(order).toEqual(["intro", "stage", "followup"]);
  });
});
