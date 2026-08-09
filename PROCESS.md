# Process overview

## What I built

**One Tree**, an interactive explainer about who Nobel laureates are related to.
Every dot is a laureate in physics, chemistry, medicine or economics, or
somebody who taught, married or fathered one. Selecting anybody lights two
tiers: the people a documented relation connects them to, and everybody
reachable by any chain of them. The page invites you to go and find a second
lineage. There are 356 separate groups in the data; the largest holds 1143
people and the next holds 14.

## The moments that mattered

### The contract was written before the data it constrains

The obvious order is to pull the data, look at it, and then decide what counts.
I wrote the rules first — `CLAUDE.md` and `spec/data.test.ts` in
[`46ffa76`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-RuiquanQiao/commit/46ffa76),
before a single query ran. Every edge carries a source. A relation type that
cannot be defined does not ship, which is why colleagues are absent: everyone at
the Cavendish was a colleague of everyone, so no such edge could be cited, and a
well-connected graph built from undefined edges is a made-up finding wearing a
real number's clothes.

One line of that contract said a person's name must not be a bare QID. It looked
like a formality. It caught three unrelated things
([`93c2bcf`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-RuiquanQiao/commit/93c2bcf)).
Wikidata records that Sheldon Cooper won the Nobel Prize in physics, because he
does on television, and that Q56509417 — a *family*, not a member of one — won
as well; both were drawn as laureates until the importer began requiring
instance-of-human. The same test then failed on Q7085, which turned out to be
Niels Bohr. Wikidata has moved language-invariant names to a `mul` code and he
has no English label at all, so asking for English had quietly rendered the
founder of half this graph as a hash, with twelve others behind him.

I knew it was fixed because the red test went green across all 1684 people and
the pull shrank by exactly two: the two entities that were not people.

### The picture was drawing my spatial index, not the data

The first graph came out as a lattice, neat rows and columns like halftone, and
it was plausible enough to accept. It was an artefact. Repulsion was bucketed
into cells 0.06 wide and cut off at a three-by-three neighbourhood, but the ideal
edge length is about 0.027, so the truncation acted as a periodic potential. The
obvious fix was to tune constants until it looked organic. I deleted the spatial
index instead and computed every pair exactly — six seconds, in a script that
runs by hand
([`c767934`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-RuiquanQiao/commit/c767934)).
The lattice went, and the clusters that appeared were the ones the component
analysis had already counted.

### The data refused the headline, so the headline changed

The page opened with *go and find a lone genius*, meaning you can't. Then I
counted: 247 of 757 laureates light up nobody at all. You can find one on the
first try, a third of the time.

Hiding those dots would have rescued the sentence. Instead the claim moved to the
one the data supports, 1143 against 14, and the count of unattached laureates
now sits in the opening at the size of the claim, saying what it means — a gap in
what was written down, not evidence that anybody worked alone. A test holds that
slot in the markup so a later layout pass cannot demote it to a footnote
([`ed96a14`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-RuiquanQiao/commit/ed96a14)).
