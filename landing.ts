import snapshotJson from "./data/nobel.json";
import { buildGraph, summarise } from "./graph.ts";
import type { Snapshot } from "./graph.ts";

// The opening guess.
//
// A progressive-enhancement overlay: the markup ships `hidden` and this script
// is what shows it, so a visitor whose JavaScript never runs meets the graph
// directly rather than a modal they cannot dismiss. It loads as its own module
// alongside main.ts, so the graph does not depend on it and the interaction
// suite that imports main.ts is not disturbed by it.
//
// Every figure it states is counted from the snapshot through summarise(),
// never typed in -- the same rule the rest of the page follows. The correct
// answer is "true" because that count is over half, and it is a floor: the
// unlinked remainder is mostly a gap in what Wikidata records, which the copy
// says rather than letting the number imply a lone genius.

const SEEN_KEY = "one-tree-seen";

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Reading localStorage throws outright in some privacy modes. Showing the
    // guess again is harmless; failing to render the page would not be.
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // A visitor in a privacy mode simply meets the guess each visit.
  }
}

function need<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`landing: missing ${selector}`);
  return found;
}

export function setupLanding(): void {
  const landing = document.querySelector<HTMLElement>('[data-testid="landing"]');
  if (!landing) return; // a page without the overlay (about/, credits/) is fine

  const reveal = need<HTMLElement>('[data-testid="landing-reveal"]');
  const verdict = need<HTMLElement>('[data-testid="landing-verdict"]');
  const explain = need<HTMLElement>('[data-testid="landing-explain"]');
  const enter = need<HTMLButtonElement>('[data-testid="landing-enter"]');
  const skip = need<HTMLButtonElement>('[data-testid="landing-skip"]');
  const choices = [...document.querySelectorAll<HTMLButtonElement>(".landing-choice")];

  const figures = summarise(buildGraph(snapshotJson as unknown as Snapshot));
  const pct = Math.round((figures.linkedLaureates / figures.laureates) * 100);

  // The header and main sit under the overlay. Made inert while it is open so
  // the keyboard cannot tab past the modal into a graph nobody can see yet.
  const behind = [...document.querySelectorAll<HTMLElement>("header, main")];
  const setInert = (on: boolean) => {
    for (const node of behind) node.toggleAttribute("inert", on);
  };

  function open(): void {
    landing!.hidden = false;
    setInert(true);
    document.body.style.overflow = "hidden";
    choices[0]?.focus();
  }

  function close(): void {
    landing!.hidden = true;
    setInert(false);
    document.body.style.overflow = "";
    remember();
    // Land the keyboard on the search box -- the first thing the page invites
    // you to use -- rather than dropping focus back to the top of the document.
    document.querySelector<HTMLInputElement>('[data-testid="search"]')?.focus();
  }

  function answer(correct: boolean): void {
    verdict.textContent = correct ? "Right — and it surprised me too." : "Not quite — it's true.";
    explain.textContent =
      `${pct}% of the ${figures.laureates} laureates here connect to another one, almost all ` +
      `through who taught whom. The rest reach no other laureate — usually a gap in what ` +
      `Wikidata has recorded, not proof they worked alone. See who you can find.`;
    reveal.hidden = false;
    enter.focus();
  }

  for (const choice of choices) {
    choice.addEventListener("click", () => answer(choice.dataset.choice === "true"));
  }
  enter.addEventListener("click", close);
  skip.addEventListener("click", close);
  // Escape dismisses it, the same as skip: a modal you cannot get out of with
  // the keyboard is a modal that fails the artefact band.
  landing.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  if (!seen()) open();
}

setupLanding();
