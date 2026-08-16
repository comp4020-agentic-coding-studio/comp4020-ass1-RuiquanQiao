// The opening guess.
//
// A progressive-enhancement overlay: the markup ships `hidden` and this script
// shows it, so a visitor whose JavaScript never runs meets the graph directly
// rather than a modal they cannot dismiss. It loads as its own module alongside
// main.ts, so the graph does not depend on it and the interaction suite that
// imports main.ts is not disturbed by it.
//
// It shows on EVERY load, not once. The reflex is to remember a dismissal in
// localStorage and never show it again; this page deliberately does the
// opposite, because the guess is the argument's front door and the surprise it
// sets up is the reason the page exists -- a marker, and every repeat visitor,
// should meet it fresh rather than be quietly waved past. The cost is paid with
// eyes open: Skip and Escape both leave in a single action, and focus lands on
// the search box on the way out. See CLAUDE.md, "The opening guess".
//
// The question is coarse -- "more than half", never a percentage -- because the
// graph is Wikidata's and its record of who-taught-whom is far from complete,
// so a figure counted here would understate the finding and put the gap on show.
// spec/landing.test.ts proves the claim (linked > half) against the data.

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

  // The header and main sit under the overlay. Made inert while it is open so
  // the keyboard cannot tab past the modal into a graph nobody can see yet.
  const behind = [...document.querySelectorAll<HTMLElement>("header, main")];
  const setInert = (on: boolean) => {
    for (const node of behind) node.toggleAttribute("inert", on);
  };

  function open(): void {
    landing!.hidden = false;
    // Reset, so a re-open (a fresh visit) starts on the question, not on the
    // answer a previous visit left showing.
    reveal.hidden = true;
    for (const choice of choices) choice.setAttribute("aria-pressed", "false");
    setInert(true);
    document.body.style.overflow = "hidden";
    choices[0]?.focus();
  }

  function close(): void {
    landing!.hidden = true;
    setInert(false);
    document.body.style.overflow = "";
    // Land the keyboard on the search box -- the first thing the page invites
    // you to use -- rather than dropping focus to the top of the document.
    document.querySelector<HTMLInputElement>('[data-testid="search"]')?.focus();
  }

  function answer(correct: boolean): void {
    verdict.textContent = correct ? "Right — and it surprised me too." : "Not quite — it's true.";
    explain.textContent =
      `And almost always through the people who taught them, not through family or fame. ` +
      `The ones who seem to reach no one? Usually a gap in what's been recorded, not proof ` +
      `they worked alone. See who you can find.`;
    reveal.hidden = false;
    enter.focus();
  }

  for (const choice of choices) {
    choice.addEventListener("click", () => {
      // Mark the one they picked, so a wrong guess is visibly the one they made
      // rather than a reveal that appeared from nowhere.
      for (const other of choices) other.setAttribute("aria-pressed", String(other === choice));
      answer(choice.dataset.choice === "true");
    });
  }
  enter.addEventListener("click", close);
  skip.addEventListener("click", close);
  // Escape dismisses it, the same as skip: a modal you cannot get out of with
  // the keyboard is a modal that fails the artefact band.
  landing.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  // On every load, deliberately -- nothing is remembered. See the note above.
  open();
}

setupLanding();
