// A stand-in for Cloudflare's DNS: answers from a table of DoH JSON keyed
// "name TYPE" (src/example.json), anything else an empty answer. The page
// is built with it (the example) and tested with it, through the same
// doh() as real questions.

export type Table = Record<string, unknown>;

export const answerFor = (table: Table, url: string): unknown => {
  const q = new URL(url).searchParams;
  return (
    table[`${q.get("name") ?? ""} ${q.get("type") ?? ""}`] ?? {
      Status: 0,
      AD: false,
      Answer: [],
    }
  );
};

export const tableFetch =
  (table: Table): typeof fetch =>
  (input) =>
    Promise.resolve(
      new Response(JSON.stringify(answerFor(table, String(input))), {
        headers: { "content-type": "application/dns-json" },
      }),
    );
