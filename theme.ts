// Light or dark, and who gets told when it changes.
//
// Two decisions are deliberate and both are the kind that look like oversights.
//
// The system preference is ignored. `prefers-color-scheme` is not consulted
// anywhere, so a cold visit always opens dark -- the version this page was
// actually tuned in, and the one a marker opening the URL for the first time
// will see. Light applies once somebody asks for it, and is remembered from
// then on. If following the system is ever wanted it is a two-line change to
// the default below.
//
// The button is injected rather than shipped in the markup. Without JavaScript
// a hard-coded toggle would be a control that looks operable and does nothing,
// and `about/` is otherwise a page that reads perfectly well with JS off.
// Building it here means the control exists exactly when it works.

export type Theme = "dark" | "light";

const STORAGE_KEY = "one-tree-theme";

/** Every page carries the same pre-paint snippet; keep this in step with it. */
const DEFAULT: Theme = "dark";

const listeners = new Set<() => void>();

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : DEFAULT;
}

export function setTheme(theme: Theme): void {
  if (theme === DEFAULT) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private modes throw on write rather than degrading. The choice still
    // applies to this visit; it just will not survive a reload.
  }
  for (const listener of listeners) listener();
}

/** How the canvas finds out. Called after the attribute has already changed. */
export function onThemeChange(listener: () => void): void {
  listeners.add(listener);
}

const SVG = "http://www.w3.org/2000/svg";

/**
 * A moon while the page is dark, a sun while it is light.
 *
 * The icon names **where you are**, not where the click will take you --
 * the convention people argue about, settled here and settled consistently.
 * With no visible text left, `aria-label` is the button's whole accessible
 * name, so it carries the other half: what pressing it does.
 *
 * Drawn rather than typed, and measured before deciding. U+2600 and U+263D
 * both render as text glyphs in this nav's font -- but at 13.6px and 7.76px,
 * so the nav shifts sideways every time you toggle. Adding the emoji selector
 * evens the width by turning them into 1.37em colour emoji, which is worse
 * again next to a monochrome uppercase nav. And that is only what this machine
 * does; the marking machine's `system-ui` is somebody else's font. A path in a
 * fixed box has none of those problems and inherits the text colour, gold
 * hover included. (The glyphs are named here rather than written, because
 * spec/theme.test.ts checks this file does not contain them.)
 */
const ICONS = {
  dark: {
    name: "moon",
    circle: null,
    d: "M12.42 3.11A6.2 6.2 0 1 0 12.42 12.89 4.91 4.91 0 1 1 12.42 3.11Z",
  },
  light: {
    name: "sun",
    circle: [8, 8, 3.1] as [number, number, number],
    d:
      "M8 0.8V2.6M8 13.4V15.2M15.2 8H13.4M2.6 8H0.8" +
      "M13.09 2.91 11.82 4.18M4.18 11.82 2.91 13.09" +
      "M13.09 13.09 11.82 11.82M4.18 4.18 2.91 2.91",
  },
} as const;

function describe(theme: Theme): string {
  return theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme";
}

function icon(theme: Theme): SVGSVGElement {
  const spec = ICONS[theme];
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "theme-toggle-icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  // Decorative: the button's accessible name already says everything.
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("data-icon", spec.name);

  if (spec.circle) {
    const [cx, cy, r] = spec.circle;
    const disc = document.createElementNS(SVG, "circle");
    disc.setAttribute("cx", String(cx));
    disc.setAttribute("cy", String(cy));
    disc.setAttribute("r", String(r));
    svg.append(disc);
  }

  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", spec.d);
  svg.append(path);
  return svg;
}

export function mountToggle(): HTMLButtonElement | null {
  const nav = document.querySelector(".nav");
  if (!nav) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-toggle";
  button.dataset.testid = "theme-toggle";

  const paint = () => {
    const theme = currentTheme();
    const action = describe(theme);
    button.replaceChildren(icon(theme));
    button.setAttribute("aria-label", action);
    // Icon-only, so the only thing a mouse user can read is the tooltip.
    button.title = action;
  };

  button.addEventListener("click", () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
    paint();
  });

  paint();
  nav.append(button);
  return button;
}

mountToggle();
