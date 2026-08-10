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

/**
 * The label names the *action*, not the state.
 *
 * A button reading "Dark" is ambiguous in a way that matters for somebody
 * arriving through a screen reader: it could equally be a state readout or a
 * destination. The visible text says where you are, because that is what a
 * glance wants, and the accessible name says what pressing it will do.
 */
function describe(theme: Theme): { text: string; action: string } {
  return theme === "dark"
    ? { text: "Dark", action: "Switch to the light theme" }
    : { text: "Light", action: "Switch to the dark theme" };
}

export function mountToggle(): HTMLButtonElement | null {
  const nav = document.querySelector(".nav");
  if (!nav) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-toggle";
  button.dataset.testid = "theme-toggle";

  const mark = document.createElement("span");
  mark.className = "theme-toggle-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "◐";

  const text = document.createElement("span");
  text.className = "theme-toggle-text";

  const paint = () => {
    const { text: label, action } = describe(currentTheme());
    text.textContent = label;
    button.setAttribute("aria-label", action);
    button.title = action;
  };

  button.addEventListener("click", () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
    paint();
  });

  paint();
  button.append(mark, text);
  nav.append(button);
  return button;
}

mountToggle();
