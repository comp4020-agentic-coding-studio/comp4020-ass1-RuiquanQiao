# Assignment 1

## The breakthrough

It took five topics to get here, and I threw the first four away for the same
reason every time: I could not work out what I would be *entitled to say*. An
extinction simulator would have needed a causal chain no paper actually
provides. A dragged time-slider over ancient coastlines would have needed
generated images of places nobody photographed. Each time the idea died on the
same question, and I kept treating that as bad luck.

The breakthrough was seeing it was not luck, it was a preference, and that I
should choose a project that *ran on* it rather than one that survived it. Who
taught whom is recorded. That is why this topic worked when better-looking ideas
didn't.

Then the harness turned the preference into something with teeth. Before any
data existed I wrote a rule that a person's name may never be a bare QID. It
read like housekeeping. It caught a television character listed as a physics
laureate, a *family* entity recorded as a person, and — the one that actually
frightened me — Niels Bohr, rendered as `Q7085` because Wikidata has moved names
like his to a language code I wasn't asking for. One check, written for a reason
that had nothing to do with any of them.

## What it changed

I used to write tests against bugs I had already found, which only ever catches
that bug again. Now I want to write them against what must be true of the
output, because those are the ones that catch things I was not clever enough to
predict. The clearest proof came late: a contrast check I added for a *new*
light theme failed immediately on the dark one, which had been live since the
first commit.

The harder change is about a habit I did not know I had. Twice in one week I
answered a visual defect by making it invisible instead of finding its cause.
Lines were crossing people they had nothing to do with, so I painted background
over the nodes; when that was called out, I bent the lines around them. Both
looked like fixes. Neither was — the second one made the drawing lie about the
shape of the claim, which on a page about who taught whom is not a cosmetic
problem.

What broke the pattern was building the measurement before the next attempt.
The moment I could count crossings, the answer stopped being a matter of taste:
the layout was carrying clear zones covering 103% of the space it had, so no
arrangement of straight lines could ever have worked, and the fix was a
different layout rather than a cleverer renderer.

I want that to be the order I work in. Measure the thing, then decide — not
because it is more rigorous, but because I now know what I do when I skip it.

## What I would fix next

The crossing count is 77 on the desktop viewport, not zero, and the phone
cannot reach zero at full-graph zoom: threading a ring of nodes needs 3.9px of
spacing and a 358px canvas gives 3.04px. I would rather say that with the number
than describe it as done. Nineteen laureates have no portrait, because nobody
has published one under a licence this page can honour; they are drawn with
their initials, and the credits page says why.
