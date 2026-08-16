# Assignment 1

## The breakthrough

The breakthrough here wasn't something I learned to do — it was deciding to do
it first instead of last.

The graph was the hard part, and I set its rules before I let the agent draw a
single frame. Two dots may never touch, because two faces touching reads as a
relationship, and a relationship on this page is a claim about two real people.
A line may never pass through someone it has nothing to do with. Nothing a click
lights up may come back dimmer than it went in. Then I made the agent wire each
rule into a test and a log, so a version that broke one failed loudly instead of
just looking slightly off.

The tests weren't the point. The point was that the agent could no longer hand
me something that quietly broke a rule and call it finished. I've spent enough
hours letting an agent produce something plausible-but-wrong and then arguing it
back into shape line by line, red in the face, to know that isn't how I want to
work.

## What it changed

I won't pretend this taught me a new skill — I could already do this. What
changed is that I stopped treating it as extra effort and made it the first
move: write my judgement down as something the machine can be failed against,
before the machine writes anything.

That is the developer I want to keep being on the next agent project — the one
who builds the thing that says "no" before the agent starts, not the one who
plays whack-a-mole with its output afterwards.
