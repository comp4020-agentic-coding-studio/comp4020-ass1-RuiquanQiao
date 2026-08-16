# Assignment 1

## The breakthrough

The breakthrough was learning to set the rules before the agent writes a line,
not after it hands me something wrong.

The graph was the hard part, so I decided its laws first. Two dots may never
touch, because two faces touching reads as a relationship, and a relationship on
this page is a claim about two real people. A line may never pass through
someone it has nothing to do with. Nothing a click lights up may come back
dimmer than it went in. Then I had the agent wire each law into a test and a
log, so a version that broke one failed loudly instead of just looking slightly
off.

That was the shift. The agent could no longer hand me something plausible-but-
wrong and call it finished — it had to clear the rules first. Every hour I had
ever spent arguing an agent's output back into shape, line by line and red in
the face, was an hour I stopped needing to spend.

## What it changed

It changed the order I work in. I used to let the agent build and then correct
what came back; now I write my judgement down as something the machine can be
failed against, before the machine writes anything. Turning a standard into a
check the agent has to clear is the difference between directing the work and
cleaning up after it.

That is the developer this project made me want to be: the one who builds the
thing that says "no" before the agent starts, not the one left playing
whack-a-mole with its output afterwards.
