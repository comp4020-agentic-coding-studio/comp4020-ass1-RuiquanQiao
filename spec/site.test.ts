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

const ALLOWED_HOSTS = ["www.wikidata.org", "www.nobelprize.org"];

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
  it("ships both pages", () => {
    const names = pages.map((page) => page.name).sort();
    expect(names).toEqual(["about/index.html", "index.html"]);
  });

  it("kept no trace of the starter page", () => {
    for (const { name, doc } of pages) {
      expect(doc.querySelector('[data-testid="intro"]'), name).toBeNull();
      expect(doc.body.textContent, name).not.toContain("Replace this with your prototype");
    }
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
});
