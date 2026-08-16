# Process overview

## What I built

**One Tree**, an interactive explainer about who Nobel laureates are related to.
Every dot is a laureate in physics, chemistry, medicine or economics, or
somebody who taught, married or fathered one. Selecting anybody lights two
tiers: the people a documented relation connects them to, and everybody
reachable by any chain of them. Zoom in far enough and the laureates become
their own faces. The page invites you to find a second lineage; there are 356
separate groups, and the largest holds 1143 people while the next holds 14.

## The moments that mattered

### The contract was written before the data it constrains

I wrote the rules first — `CLAUDE.md` and `spec/data.test.ts` in
[`46ffa76`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-RuiquanQiao/commit/46ffa76),
before a single query ran. One line said a person's name must never be a bare
QID. It looked like housekeeping. It caught three unrelated things
([`93c2bcf`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-RuiquanQiao/commit/93c2bcf)):
Sheldon Cooper, listed as a physics laureate because he is one on television; a
*family* entity recorded as having won; and Niels Bohr, rendered as `Q7085`
because Wikidata moved names like his to a language code I was not asking for.
I knew it was fixed when the red test went green across all 1684 people and the
pull shrank by exactly two — the two entities that were not people.

### A bug no test could reach, so I moved the decision somewhere they could

Selecting a laureate was supposed to light everyone reachable from them. It
painted them *darker* than before the click: `#7a6334` where a resting laureate
is `#e8b552`. The page's whole argument is how much of the screen answers you,
and clicking hid it. Eighty-eight tests stayed green, because the decision was a
branch inside a canvas call and jsdom has no canvas.

The retry would have been to change the colour. Instead appearance moved out of
the draw loop into a table, and a test now holds the ordering: nothing in reach
may render dimmer than at rest
([`72b0fbf`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-RuiquanQiao/commit/72b0fbf)).
Verified by reading the canvas: 7029 pixels of bright gold, zero of the old dark
gold.

### A check I added found something already shipped

Adding a light theme, I wired a contrast sensor over both palettes rather than
eyeballing the new one
([`cb8b017`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-RuiquanQiao/commit/cb8b017)).
It failed on its first run — in the *dark* theme, which had shipped since the
first commit. `.notes-quiet` was 3.96:1 against a 4.5 floor. All 22 text pairs
across both themes now clear AA, worst case 4.81. Adding the second theme also
broke the invariant above and improved it: "not dimmer" is backwards on paper,
so the rule became contrast against the background.

### Two answers thrown away before I measured anything

Lines were passing through people they had nothing to do with. I painted
background over each node — which hides a crossing and leaves it there. Then I
bent the lines around obstacles
([`b284f84`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-RuiquanQiao/commit/b284f84)),
which removes the crossing by making the line lie about the relationship.

I threw both away and built the measurement first
([`515df82`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-RuiquanQiao/commit/515df82)).
It showed the layout could not be fixed at all: the clear zones covered 103% of
the disc, so no line had a route anywhere. The data is a near-tree — 1142 of
1335 relations form a spanning tree — so the layout became a radial one, where
those 1142 cannot cross anybody by construction. Crossings went from 1733 to 77
on the desktop viewport, with straight lines.
