# COMP4020 prototype

This is your starter repo for a COMP4020 prototype: a static site written in
HTML/CSS/TypeScript that builds to plain HTML/CSS/JS and deploys to GitHub
Pages. The **deployed site is what gets marked** --- not this repo, and not "it
works on my machine". It's marked live in Chrome against the deployed URL at two
viewports --- 1920×1080 (desktop) and 390×844 (phone) --- and both count in
full, so make that artefact good at both and use the checks below to know
whether it is.

What you're building this week — the spec — is published on the course website,
and this repo's name tells you which deliverable it is. Run the course plugin's
**start** skill at the start of each week: it pulls the right spec from the
course API, carries your harness forward from last week, and helps you turn the
spec's checkable lines into tests of your own. Read the spec before you build,
and see `spec/README.md` for how the checks in this repo relate to it.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Before you push, run `pnpm check`. It runs most of what CI runs --- build,
  lint, and the spec --- so you catch those in seconds instead of waiting for
  the pipeline. The links check, the evidence check, the secrets scan, and the
  deploy itself only run in CI; run `pnpm dlx linkinator ./dist --silent`
  locally against a fresh `pnpm build` for the links check without waiting for
  CI.
- To see what the page actually looks like rather than what you assume it looks
  like, open it in a browser (the `agent-browser` CLI, documented on
  [the course site](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/backpressure/#agent-browser-the-rendered-page-as-ground-truth),
  works well for this). The rendered page is the truth; your mental model of it
  isn't.
- When a check fails, read its output before changing anything. Each check below
  names what it measures, and the failure message is the instruction: it tells
  you the file, the line, or the contract. Treat a red check as authoritative
  --- the page is wrong until the check is green, not until you decide it should
  be.
- Commit when the checks pass. Never commit a red state.

## The checks (your sensors)

CI runs these on every push once your repo is public. GitHub's checks UI shows
two jobs, `check` and `deploy` --- not one status per sensor below --- and
within `check` the steps run in sequence (`pnpm check` chains typecheck, build,
lint, and the spec with `&&`), so an early failure like a broken build stops the
later sensors from running for that push; fix it and push again to see the rest.
While the repo is private (all week, until you ship) the CI jobs stay skipped
--- `pnpm check` is the same roster on your machine, and it's the faster loop
anyway. They aren't hoops. Each is a different way of finding out something true
about the site that you can't reliably see by looking at it.

They also carry a mark at a crit: the sweep runs fifteen minutes after your
cutoff, and green checks there are worth half that week's shipped mark. Still
running counts as not green, so ship with time for CI to finish.

- **typecheck** --- `tsc --noEmit` runs first in `pnpm check`, so a type error
  stops the roster before the build even starts. The types are extra
  backpressure: a red here is the compiler telling you a claim in the code is
  false.
- **build** --- the site must build (`pnpm build`). A build failure means the
  deployed site is broken or stale, so nothing else matters until this is green.
- **deploy / online** --- the live GitHub Pages URL must load and return the
  page you expect. An asset that 404s on the deployed URL counts as broken even
  if it loads locally.
- **spec** --- `spec/invariants.test.ts` asserts what's true of any good
  website, whatever the week's brief asks; the tests you write for the week's
  own spec run alongside it (any `spec/*.test.ts`). A failure names the contract
  you haven't met yet.
- **lint** --- `stylelint` for CSS, `oxlint` for TypeScript. Flags code that's
  wrong, fragile, or non-idiomatic. Read the rule it names.
- **tests** --- any other tests you write, wherever you put them (co-located
  with your source is fine, not just `spec/`), must pass. Vitest picks up both
  this and the spec suite in one `vitest run`, the last step of `pnpm check`. A
  failing test is a claim about the site that's no longer true.
- **evidence** (`pnpm check:evidence`) --- checks your process evidence:
  `PROCESS.md`'s citations resolve to real commits, the current deliverable's
  exact reflection is in `reflections/` (worked out from this repo's name
  against the public course API), and your `CLAUDE.md` is present. Evidence
  gates the deploy --- `deploy` needs `check` to pass, so failing evidence
  blocks the deploy alongside everything else. See
  [Your process is part of the mark](#your-process-is-part-of-the-mark) below,
  and the course website's
  [assessment page](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#what-you-submit)
  for what counts as evidence.
- **links** --- internal links must resolve. A broken link is a dead end you
  didn't mean to ship.
- **secrets** --- the repo is scanned for committed credentials. Never put a
  key, token, or password in a tracked file. If one leaks, rotate it. A local
  pre-commit hook (`.githooks/pre-commit`, installed by `pnpm install`) also
  blocks any commit containing something shaped like an API key --- by the time
  CI sees a key it's already pushed, so the hook is the sensor that matters.

Nothing here measures **accessibility** or **performance** --- wiring those
sensors (`axe-core`, Lighthouse, or whatever you choose) is your work, and later
in the course the spec will ask you to show how you tested both. When you do,
read a green performance result honestly: it's a lab estimate from one run on a
CI machine, not proof the site is fast for real users.

## The stack is swappable

Out of the box this is plain HTML/CSS/TypeScript on Vite, and every `.html` file
in the repo is a page: add pages, link them, and the build picks them up with no
config. That's a default, not a rule (unless the week's spec says otherwise).
You can swap in Astro or any other static generator, because nothing in CI names
a tool --- the whole contract is:

- `pnpm build` emits the complete site into `dist/`
- the `package.json` scripts (`check`, `check:evidence`, `build`) keep working
- whatever lands in `dist/` still passes the invariants in `spec/`

Two things bite in a swap. The deployed site lives under a path
(`…github.io/<repo>/`), so configure your generator's base path --- this
template's Vite config uses relative asset URLs to sidestep that, but most
generators (Astro included) need `base` set explicitly, and getting it wrong
looks fine locally while every asset 404s on the live URL. And commit the
updated `pnpm-lock.yaml`: CI installs with `--frozen-lockfile`.

## Your process is part of the mark

The deployed page is only half of it. How you got there is marked too: your
commit history, your agent files, and the decisions visible across them. The
checks above can't see any of that, so a person reads it directly --- which
means building legibly is part of building well.

- **Commit as you go.** Small, frequent commits are the record of how the work
  came together, and that record is read, not just the final state. A trail that
  grew alongside the code is the strongest evidence of your process; a single
  dump the night before is the weakest.
- **Keep a process overview** (`PROCESS.md`). A short reading-guide, not an
  essay: what you built, the moments that mattered --- each pointing at a
  commit, a `CLAUDE.md` change, or a prompt and the commit it produced --- and
  where to look in the history. It points a marker at the evidence; it doesn't
  stand in for it, and claims the history doesn't back don't count. The
  `PROCESS.md` in this repo is a template showing the shape and the citation
  format (link text the commit hash or range, target the commit or compare URL);
  `pnpm check:evidence` verifies your citations resolve to real commits before
  you ship. Markers follow those citations and don't trawl the repo for evidence
  you didn't cite.
- **Write your reflection in `reflections/`** --- a short markdown file in this
  repo, named for the deliverable it answers, so the number in the filename is
  the number in this repo's name (`crit-1.md` in `comp4020-crit1-<you>`,
  `assignment-1.md` in `comp4020-ass1-<you>`); `reflections/README.md` has the
  full rule. `pnpm check:evidence` checks the exact current name against the
  course API, not merely the presence of any well-named file. It answers the two
  standing prompts: the breakthrough that moved the work forward, and what this
  work changed about the developer you want to be. It stays out of the deployed
  site. It's due at the cutoff, and if it isn't in the repo by then the week
  doesn't count as shipped, however good the prototype is.
- **This file is process evidence.** The harness you build to direct the agent,
  this `CLAUDE.md` and any `AGENTS.md`, is itself read as part of how you
  worked. Keep it honest and current (see below).

You don't need a name, a student number, or any identity file in the repo: we
know whose repo it is. Spend the effort on the work.

## This file is yours

This CLAUDE.md is a starting point, not a fixed rulebook. As you learn what your
prototype needs --- a convention to hold the agent to, a sensor that keeps
catching you out, a fact about the stack the agent keeps getting wrong --- write
it down here. Growing this file is the work of harness engineering, and the gap
between this boilerplate and your own version is part of what your prototype
says about the developer you're becoming.

## This prototype: the Nobel Lineage

An interactive explainer about who Nobel laureates are related to.

The finding it is built on, in one line: **696 of the 727 Nobel laureates in
physics, chemistry, medicine and economics belong to a single academic family
tree, and 668 of them descend from one 17th-century Basel professor**
(Tol, *Scientometrics* 2024, <https://doi.org/10.1007/s11192-024-04936-1>).
Twenty-five trees hold exactly one laureate. Four hold two. One holds 696.

So the page does not argue that science is collaborative. It invites you to go
and find someone who isn't in the tree, and lets the data refuse you.

The argument the structure has to serve: **a lone genius is a thing you cannot
find, not a thing we assert.** If a change makes it easier to read the claim
than to test it, it is the wrong change.

### The core interaction

Stated plainly enough to write a test for, because that is what the spec asks:

- Selecting a laureate --- by clicking a node, or by searching a name and
  choosing a result --- lights the graph in **two tiers**:
  - **direct**: every node holding a documented relation to that laureate;
  - **reached**: every node connected to them by any chain of documented
    relations, however long.
- **Both sets must equal what the data says.** `direct` equals the laureate's
  edge endpoints; `reached` equals the breadth-first closure over all edges.
  Highlighting is a readout, never decoration, and a spec test holds both.
- Selection survives a viewport resize. The marker resizes mid-interaction.

The two tiers exist because they answer different questions and the page needs
both. `direct` is the precise answer --- who actually taught or married whom.
`reached` is the *impression*, and the impression is the argument: at thumbnail
scale nobody is reading names, they are reading how much of the screen just lit
up. A first draft of this section specified only `direct`, which is typically
one to three people and would have made the page look like the tree is small.
That was wrong about the finding, not just about the visuals.

### The opening guess

Before the graph, an overlay asks one true/false question -- more than half of
all laureates trace to another, true or false? -- then reveals the answer and
lets you in. It is the argument's front door, not decoration, and three
decisions hold it up.

- **It shows on every load, not once.** The reflex is to remember a dismissal
  in `localStorage` and never show it again; most sites do, and it is what a
  returning visitor expects. This page deliberately does the opposite: the
  guess is the opening move of the argument and the surprise it sets up is the
  reason the page exists, so a marker and every repeat visitor should meet it
  fresh rather than be quietly waved past. The cost is real and paid with eyes
  open -- a returning reader sees it again -- which is why Skip and Escape both
  leave in a single action and focus lands on the search box on the way out.
- **It states no percentage, only "more than half".** The graph is Wikidata's,
  whose record of who-taught-whom is far from complete, so a figure counted
  here would understate the finding and put the gap on show rather than the
  point. `spec/landing.test.ts` holds the claim (`linkedLaureates` is over
  half) against the data without the page ever printing a number.
- **Progressive enhancement, behind a real modal.** Hidden in the markup and
  shown by `landing.ts`, so a visitor whose JavaScript never runs meets the
  graph directly instead of a box they cannot dismiss. While it is open the
  header and main are `inert`, so the keyboard cannot tab into a graph nobody
  can see yet, and Escape always leaves.

### Honesty rules --- these outrank every visual decision

This page makes claims about real people, most of them dead, some of them not.
Getting an edge wrong is not a failed test, it is a lie about who taught whom.

- **Every edge carries a source the reader can open.** No edge ships without
  one. The three provenance values are `official` (a nobelprize.org page),
  `wikidata-sourced` (a claim carrying at least one reference), and
  `wikidata-unsourced` (a claim carrying none). All three are legitimate; only
  hiding which one you have is not. The page shows the value.
- **Wikidata's P184 is uneven and must be treated as such.** Many doctoral
  advisor statements carry zero references, and in the raw data they look
  identical to sourced ones. The refresh script records the reference count per
  claim; do not collapse that distinction anywhere downstream.
- **A relation type that cannot be defined does not ship.** Only two kinds of
  edge exist here: academic supervision (Wikidata P184/P185) and kinship
  (P22/P25/P26/P40/P3373, cross-checked against nobelprize.org's own family and
  couples pages). "Colleague" was in the first scope and was cut --- not to save
  effort, but because it has no definition. Everyone at the Cavendish was a
  colleague of everyone, every such edge would be uncitable, and a headline of
  "96% connected" propped up by undefined edges would be a fabricated finding
  wearing a real number's clothes. If a future change wants a third relation
  type, it must come with a definition and a source first.
- **Non-laureates stay in the graph.** The tree is held together by people who
  never won anything, Stupanus included. Collapsing a chain that runs through
  them into a direct laureate-to-laureate edge would invent a supervision that
  never happened. They render differently (smaller, unlabelled), they are never
  presented as laureates, and the path display names them.
- **An award statement is not evidence of a person.** Wikidata's P166 will
  happily tell you that Sheldon Cooper (Q629583) won the Nobel Prize in physics,
  because he does on television, and that Q56509417 -- a *family*, not a member
  of one -- won as well. Both were in the first pull and would have been drawn
  as laureates. Every entity admitted must be `instance of: human` (P31/Q5); of
  1686 entities in that pull exactly two failed it, and both were these. A
  regression test in `spec/data.test.ts` names them, so dropping the clause
  fails loudly rather than quietly.
- **Ask Wikidata for English labels and you will not get Niels Bohr.** Labels
  that do not vary between languages have moved to the `mul` code, and Q7085 has
  no `en` label at all -- his name is `mul: Niels Bohr`. Querying `"en"` alone
  fell back to the QID, so the first snapshot listed the founder of half this
  graph as "Q7085", along with twelve others including Hermann Staudinger and
  François Englert. The label service asks for `en,mul,de,fr,nl,sv,da,it,es,la`,
  in that order. The spec test that forbids a bare QID as a name is what caught
  this; it stays.
- **Missing is `null`, never `0` or an empty string.** Two award statements
  carry no date qualifier, and the importer first wrote them as year `0`. A zero
  survives a type check, passes a range test nobody wrote, and renders as
  "physics 0" on a page about real people. Undated prizes say `(undated)`.
- **Never state a count the snapshot cannot produce.** Figures quoted from the
  literature are attributed to the paper and dated; figures about this graph are
  computed from `data/` at build time. The two are never mixed in one sentence.
- **The site states what it is**: a student prototype built over published data,
  not affiliated with the Nobel Foundation, snapshot-dated, with known gaps.
  Literature and peace are outside Tol's dataset and the page says so rather
  than quietly implying the tree covers all six prizes.

### What this prototype deliberately does not do

The brief asks for one idea and nothing else, and the response band penalises
over-scoping in the same sentence as under-scoping. These were wanted and cut:

- **Geographic migration of academic centres.** Real and well documented
  (Chariker et al. 2017 find communities centred on Cambridge in the late 19th
  century and Columbia in the early 20th), and it is a second idea. It gets its
  own build or none.
- **A separate statistics page.** The 696 / 25 / 4 fragmentation *is* the
  finding. Moving it to a subpage would demote the headline to an appendix.
- **Colleague edges.** See above.

### The graph is a view, not the control surface

The force graph is the main visual and it is allowed to be a hairball --- at
thumbnail scale it is answering "how many", not "who", and a hairball answers
that well. What it is not allowed to be is the only way in.

So the state is "which laureate is selected", and two things can set it: the
canvas, and a search field plus a keyboard-reachable result list. The canvas
renders state; it does not own it. Canvas content is invisible to the tab order,
and the artefact band names the keyboard explicitly --- the marker tabs through
it. Every capability reachable by clicking must be reachable by typing.

Corollary: never move state into the renderer. If a fact about the current
selection only exists inside the canvas draw loop, the keyboard path cannot
reach it and a test cannot assert it.

**Appearance obeys the same rule.** It lives in `render.ts` as a table of tiers,
never as a branch inside `draw()`. `spec/render.test.ts` holds the ordering:
nothing in reach may render dimmer or smaller than at rest, and everything out
of reach must render dimmer than both. A colour decided inside a canvas call is
one no test can read and no keyboard can reach --- if a visual rule is worth
arguing about, it goes in that table, not the draw loop.

**The theme is a parameter to that table, never a branch inside `draw()` and
never read back out of the DOM.** Adding light mode also broke the invariant
above and had to restate it: "nothing in reach may render *dimmer* than at
rest" is exactly backwards on paper, where lit means darker. The claim that
survives both themes is about **contrast against the background**, which is
what was meant in the first place. `render.ts` exports `contrast()` and both
`spec/render.test.ts` and `spec/theme.test.ts` count in it.

Light mode may darken the gold but may never replace it: `#e8b552` is 1.76:1
on paper, and `#8a5f00` is 5.29:1, but a hue that sat more comfortably on white
would break the one thing the colour says. A test holds the hue ordering.

**Colours belong in the variable block, not loose in a rule.** A theme that
omits one silently inherits the other's value, which is how a white page gets
grey-on-grey badges, so `spec/theme.test.ts` asserts both blocks declare the
same names and holds every text pair to WCAG AA. Adding that sensor immediately
found a colour that had been under AA since the first commit --- `.notes-quiet`
at 3.96:1 --- in the *dark* theme, which nothing had ever measured.

Two consequences worth keeping. Painter's order is load-bearing, not tidiness:
a thousand-odd dots overlap at this scale, so drawing them in id order lets an
out-of-reach dot paint over a lit one and eats the effect the click exists to
produce. And the canvas's two shapes --- solid gold won something, hollow ring
did not --- are the page's vocabulary for that distinction, so the relations
list spells it with the same two marks rather than inventing a second key.

### Zooming, and the faces at the bottom of it

The canvas zooms to 12x and laureates become portraits once their dot is 13px
or wider. Four rules came out of building it, all of them things that were
wrong first.

- **No two dots may ever touch, and it is geometry rather than tuning.**
  `fitRadius` caps every dot at half the distance to its nearest neighbour.
  Overlap is not cosmetic here: two faces touching reads as a relationship, and
  a relationship on this page is a claim about two real people. The same
  argument is why **a line is routed around every node it is not attached to**
  rather than drawn through it.
- **Do not "fix" a crossing by painting over it.** The first attempt at that
  problem filled a disc of background across each node after the edges were
  drawn. It hides the crossing and leaves it there: the line still runs through
  the middle of somebody it has nothing to do with, and where it re-emerges it
  still reads as an edge arriving. `routeAround` moves the line instead, and
  `spec/routing.test.ts` surveys all 1541 relations at four zoom levels -- 822
  of them would cross somebody at 1x, and none do after routing.
- **Anything asked per-edge per-frame has to be precomputed.** The view is a
  uniform scale and a translation, so *which* nodes lie near *which* line is a
  property of the layout, not of the zoom. Asking it live cost 1.1 seconds a
  redraw; hoisting it to load time brought that to 15ms.
- **The 40x ceiling is measured, not chosen.** The closest pair in
  `data/layout.json` is 1.2e-3 apart in layout units: 12px at the old ceiling
  of 12x, where two 13px faces cannot both fit, so no amount of zooming
  separated them. At 40x every one of the 1682 nodes clears 30px.
- **Size means degree.** Area in proportion to how many documented relations a
  person has, so radius goes with the square root -- Rutherford's fifteen make
  him nine times the area of a laureate with none. The tier only scales that;
  it does not set it. Ordinary for a knowledge graph, and the page was ignoring
  it until somebody said so.
- **Choosing somebody from the search or the relations list brings them into
  view** -- centred, and zoomed far enough to show their face. Not from a
  canvas click: you were already looking at what you clicked, and moving the
  view under a pointer is disorienting. Searching a name and then having to
  hunt for the dot is the thing this exists to stop.
- **Clicking empty canvas clears the selection.** There was no way back to the
  opening view -- the whole tree, every laureate gold -- without reloading.
- **A laureate with no photograph gets their initials, not a bare dot.** Among
  faces, a plain dot reads as something that failed to load. The gap is not a
  failure, it is that nobody has published a picture of them under a licence
  this page can honour, and initials say the part that is actually known.
- **One transform, in `viewport.ts`, used by the draw loop and by the hit
  test.** This is the same rule as `render.ts` and the failure mode is worse:
  if drawing and clicking disagreed about where a node is, clicking a face
  would select the person beside them and nothing on screen would look wrong.
- **The portrait threshold is keyed on rendered radius, never on zoom level.**
  "Show a face at 5x" is a different thing on a 390px phone and a 1920px
  desktop. "Show a face when the dot is 13px" is the same thing on both.
- **Buttons and keys zoom about the selection, not the canvas centre.** Wheel
  and pinch have a cursor to anchor on; a button does not, and anchoring it on
  the middle made the feature almost useless in the flow it exists for -- you
  search a name, press +, and the person you looked up slides off the edge.
- **`touch-action: none` on the canvas, not `manipulation`.** With
  `manipulation` the browser keeps pinch and drag for itself and the
  `pointermove` events for a two-finger gesture never arrive, so pinch-to-zoom
  silently did nothing on a phone while looking implemented.

### Pictures of real people carry the same obligations as claims about them

`data/portraits.json` and `public/portraits/` hold 729 faces at 96px, ~4.8 MB,
fetched by `refresh-portraits.ts` and committed like every other snapshot here.
404 of them are CC BY or CC BY-SA, where **naming the creator is a condition of
use, not a courtesy** -- so `credits/index.html` is static markup generated by
`build-credits.ts`, not a list rendered by JavaScript. An attribution that
disappears when a script fails to load is not an attribution.

- **Outbound links are a budget, not just an allowlist.** CI runs `linkinator
  ./dist` from a datacentre IP and validates every external link in the built
  HTML. 729 anchors at `commons.wikimedia.org` would be rate-limited and would
  fail `check`, and `deploy` needs `check`. Per-portrait links are built in
  JavaScript in the readout, where linkinator never sees them; the static pages
  carry one between them, and `spec/site.test.ts` caps the count.
- **Commons only rasterises what a browser cannot display.** TIFF comes back as
  JPEG; PNG and GIF come back unchanged. Writing everything as `.jpg` produced
  25 files with PNG and GIF bytes inside, and browsers sniff content and
  rendered them perfectly -- which is exactly why nothing noticed. The type is
  read from the magic bytes and the file is named for what it is.
- **`Special:FilePath/<file>?width=N` is the route that works.** The plain
  `upload.wikimedia.org/.../<n>px-` path 400s for any width it has not already
  rendered. Commons snaps to the nearest rendition it has, so 96 costs ~6 KB
  and 128 costs ~20 KB by landing on the 250px one. A few files have no small
  rendition at any width and hand back the original; over 60 KB they are
  dropped, and those laureates keep a gold dot like the 19 with no picture at
  all and the 7 dropped on licence.
- **P18 is one editor's choice of one file, and it is often the wrong one.**
  `data/portrait-extras.json` overrides it for six laureates, and every entry
  was *looked at* before it was written down. Nothing automatic can do this
  job: searching Commons for these names returns lecture theatres, a
  gravestone, a scan of a 1957 doctoral thesis, the profile of Alfred Nobel on
  the medal, and -- for the item whose English label had been vandalised -- an
  actor. A filename is not evidence that a picture is of a person.
- **Some laureates have no free portrait, and that is a licence problem rather
  than a search problem.** 22 of 757 have none. Photographs of them plainly
  exist; nobody has released one under a licence this page can honour, because
  the Nobel Foundation's own portraits are its copyright and press photographs
  belong to the agencies. Ninety per cent of the gap is post-1980 laureates,
  which is exactly what that explanation predicts. Do not close it by taking
  pictures from the open web: this site is public, marked, under a real name
  and in the course org, and its whole argument is that every claim on it
  carries a source you can open.
- **Wikidata is edited by anybody, and a label is the easiest thing to change
  without leaving a mark.** Q157255's English label read "Clark Gregg" -- an
  American actor -- on an item whose dates, prize, and French, German and
  Chinese labels all said Merton Miller. The page shipped that name. Overrides
  live in `data/corrections.json` **with their evidence**, so a reader can
  disagree with a correction rather than having to trust it, and
  `refresh-nobel.ts` now cross-checks every laureate's English label against
  German and French and reports disagreements. That check is what should have
  caught it.
- **Free-form metadata needs normalising before it is displayed.** Commons
  renders `Artist` to HTML, and stripping tags naively concatenates nested
  elements repeating the same text: 101 of 729 credits read "Unknown
  authorUnknown author" on the live page. Entities survived the same way.

### The build touches no network, ever

`data/` holds a committed snapshot, refreshed on demand by a script that is
never run during a build. Wikidata's SPARQL endpoint rate-limits and occasionally
502s; betting a deploy on someone else's query service is the same mistake as
scraping a live site in CI. The snapshot carries its own fetch date and the page
displays it.

### The toolchain here (carried forward from C1 and C2)

- **Node must be 24.** `pnpm check:evidence` runs `node scripts/check-evidence.ts`
  directly and needs native type stripping; Node 22 cannot run it. Every shell
  needs
  `export PATH="/e/ANU/COMP8020/.tools/node-v24.18.1-win-x64:/e/ANU/COMP8020/.tools:$PATH"`
  because the machine's system node is 22 and shell state does not persist
  between commands.
- **`pnpm install`'s `prepare` script fails silently on Windows** --- it prints a
  path error and leaves `core.hooksPath` unset, so the hook that blocks
  committing an API key is not installed. Run
  `git config core.hooksPath .githooks` after any fresh clone.
- **Do not add `scripts` to `tsconfig.json`'s `include`.** It looks like an
  oversight and is not: `scripts/check-evidence.ts` uses ES2023 methods while
  `lib` is ES2022, so widening the include turns the course's own code red. Code
  that wants typechecking goes in the repo root, which `*.ts` already covers.
- **`linkinator` cannot be run locally in this checkout** --- its own dependency
  fails to resolve under this pnpm store. A spec test asserts every internal
  reference resolves to a file that exists in `dist/`, which is the part worth
  having before a push. The rest is only knowable from CI, which is why this repo
  goes public early rather than the night before.
- **Outbound links are an allowlist.** CI runs `linkinator ./dist` from a
  datacentre IP and validates external links too, so every outbound link is a
  chance for someone else's server to fail the deploy. A spec test holds the
  allowlist.
- **Never trust a screenshot for geometry.** The preview tool renders at the
  pane's physical size, not the emulated viewport, so a correctly centred page at
  1920x1080 can look like a narrow column in the corner. Measure with
  `preview_inspect` / `preview_eval`, and read `location.pathname` back in the
  same call as the measurement --- its navigation is unreliable here and a
  measurement can silently describe the previous page. Screenshots judge the
  look, never the size.
- **Dev server runs on 5199.** Port 5173 is permanently occupied by another
  project on this machine. `preview_start` reads `.claude/launch.json` from the
  session's working directory (`E:\ANU\COMP8020`), *not* from this repo --- in C2
  that quietly pointed the first measurement at the previous week's site. Check
  which entry is running before believing a number.
- **Write CSS with class selectors only.** `stylelint`'s
  `no-descending-specificity` fires on component-ordered CSS that styles bare
  elements, and reordering rules to satisfy it makes the stylesheet worse. Give
  the element a class and the rule goes quiet honestly.
