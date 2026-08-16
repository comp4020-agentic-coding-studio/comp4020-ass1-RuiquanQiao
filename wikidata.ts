// Talking to somebody else's free query service, politely.
//
// Lifted out of refresh-nobel.ts when a second refresh script needed the same
// retry loop. That file runs its queries at module scope, so importing from it
// would have run the whole Nobel pull as a side effect of asking for `chunk`.
//
// Nothing here is imported by the site. These are build-time-adjacent tools for
// scripts that are run by hand; CLAUDE.md's rule is that the build itself never
// touches the network, and that rule is why the snapshots exist at all.

export const AGENT =
  "comp4020-ass1-RuiquanQiao/0.1 (ANU COMP8020 student prototype; https://github.com/RuiquanQiao)";

const ENDPOINT = "https://query.wikidata.org/sparql";

/**
 * Ask for English and you will not get Niels Bohr.
 *
 * Wikidata moved labels that do not vary between languages -- personal names,
 * mostly -- to the `mul` code, and Q7085 has no `en` label at all. A query for
 * "en" alone silently falls back to the QID. The Latin tail catches the
 * seventeenth-century advisors who have nothing else.
 */
export const LANGUAGES = "en,mul,de,fr,nl,sv,da,it,es,la";

export type Binding = Record<string, { value: string } | undefined>;

export const qid = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A SPARQL SELECT, retried with backoff because the endpoint 502s under load. */
export async function sparql(query: string, attempt = 1): Promise<Binding[]> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": AGENT },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { results: { bindings: Binding[] } };
    return body.results.bindings;
  } catch (error) {
    if (attempt >= 4) throw error;
    const wait = 2000 * attempt;
    console.warn(`  query failed (${String(error)}), retrying in ${wait}ms`);
    await sleep(wait);
    return sparql(query, attempt + 1);
  }
}

/** Same treatment for anything else on somebody else's server. */
export async function getJson<T>(url: string, attempt = 1): Promise<T> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": AGENT } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    if (attempt >= 4) throw error;
    const wait = 2000 * attempt;
    console.warn(`  request failed (${String(error)}), retrying in ${wait}ms`);
    await sleep(wait);
    return getJson<T>(url, attempt + 1);
  }
}

export { ENDPOINT };
