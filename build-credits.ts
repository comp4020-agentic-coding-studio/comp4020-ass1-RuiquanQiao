// Writes credits/index.html from data/portraits.json.
//
//   node build-credits.ts
//
// Separate from refresh-portraits.ts on purpose: that one talks to the network
// and this one does not. It reads the committed manifest and nothing else, so
// it is safe to re-run any time and its output is a pure function of a file in
// the repo.
//
// The credits are a *static page* rather than a list rendered by JavaScript,
// because 404 of these portraits are CC BY or CC BY-SA and naming the creator
// is a condition of the licence. An attribution that disappears when a script
// fails to load is not an attribution.
//
// It also emits exactly one outbound link. CI runs `linkinator ./dist`, which
// validates external links from a datacentre IP; 731 anchors at
// commons.wikimedia.org would be rate-limited and would fail `check`, and
// `deploy` needs `check`. Per-portrait links are built by main.ts in the
// readout instead, where linkinator never sees them. spec/site.test.ts holds
// the cap.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

interface Credit {
  file: string;
  artist: string;
  licence: string;
  commons: string;
}

const book = JSON.parse(readFileSync("data/portraits.json", "utf8")) as {
  fetchedAt: string;
  width: number;
  laureates: number;
  portraits: Record<string, Credit>;
};

const snapshot = JSON.parse(readFileSync("data/nobel.json", "utf8")) as {
  people: { id: string; name: string; laureate: boolean }[];
};

const nameOf = new Map(snapshot.people.map((person) => [person.id, person.name]));

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const rows = Object.entries(book.portraits)
  .map(([id, credit]) => ({ id, credit, name: nameOf.get(id) ?? id }))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(
    ({ credit, name }) =>
      `          <li class="credit">\n` +
      `            <span class="credit-who">${escape(name)}</span>\n` +
      `            <span class="credit-what">${escape(credit.file)} — ${escape(credit.artist)} — ${escape(credit.licence)}</span>\n` +
      `          </li>`,
  )
  .join("\n");

const licences = new Map<string, number>();
for (const credit of Object.values(book.portraits)) {
  licences.set(credit.licence, (licences.get(credit.licence) ?? 0) + 1);
}
const tally = [...licences.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([licence, count]) => `${escape(licence)} (${count})`)
  .join(", ");

const count = Object.keys(book.portraits).length;

const page = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Portrait credits — One Tree</title>
    <meta
      name="description"
      content="Who took each laureate portrait on this site, and under what licence."
    />
    <!-- Kept in step with index.html and theme.ts by hand. See the note there. -->
    <script>
      try {
        if (localStorage.getItem("one-tree-theme") === "light")
          document.documentElement.dataset.theme = "light";
      } catch (error) {
        // Private modes throw on read. Dark is the default anyway.
      }
    </script>
    <link rel="stylesheet" href="../styles.css" />
  </head>
  <body>
    <header class="masthead">
      <nav class="nav" aria-label="Primary">
        <a class="nav-link" href="../">One Tree</a>
        <a class="nav-link" href="../about/">About the data</a>
        <a class="nav-link" href="./">Credits</a>
      </nav>
    </header>

    <main class="layout layout-prose">
      <div class="intro">
        <h1 class="title">Portrait credits</h1>
        <p class="lede">
          Every face on this site, and who it belongs to twice over — the laureate in it,
          and the person who took the picture.
        </p>
      </div>

      <section class="notes">
        <p>
          ${count} of ${book.laureates} laureates have a portrait here. They are Wikidata
          <code>P18</code> images resolved through Wikimedia Commons, fetched on
          ${escape(book.fetchedAt)} at ${book.width}px and committed to this repository, because
          the build is not allowed to touch the network and a page that loaded them live would
          be betting on somebody else's uptime.
        </p>
        <p>
          Licences: ${tally}. Files under GFDL 1.2 and CC SA 1.0 were excluded rather than
          shipped, because meeting their terms means reproducing a licence text this site has
          no room for. Those laureates keep a plain gold dot, which is also what the
          ${book.laureates - count} laureates with no picture on Wikidata get.
        </p>
        <p>
          Each portrait links to its own Commons file page from the panel on the
          <a href="../">main page</a> when you select that person. The full index lives on
          <a href="https://commons.wikimedia.org/wiki/Main_Page">Wikimedia Commons</a>; search
          the filename below to find any of them.
        </p>

        <h2 class="notes-title">Every portrait</h2>
        <ul class="credits" data-testid="credits">
${rows}
        </ul>
      </section>
    </main>

    <!-- The only script this page needs. Everything else here is text. -->
    <script type="module" src="../theme.ts"></script>
  </body>
</html>
`;

mkdirSync("credits", { recursive: true });
writeFileSync("credits/index.html", page);
console.log(`wrote credits/index.html: ${count} portraits, ${licences.size} distinct licences`);
