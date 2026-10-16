// The example's answer, drawn when the page is built: the made-up DNS
// answers in src/example.json go through the page's own lookup and
// rendering code (in happy-dom), and the result is written into
// index.html in place of <!-- example -->. So the example is there from
// the first paint, asks nothing of any network, and moves nothing.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import type { Plugin } from "vite";
import { analyze } from "./src/analyze.ts";
import { doh } from "./src/dns.ts";
import { renderReport } from "./src/render.ts";
import { tableFetch, type Table } from "./src/table.ts";

const FILE = new URL("./src/example.json", import.meta.url);
const MARK = "<!-- example -->";

export async function exampleHtml(): Promise<string> {
  const table = JSON.parse(await readFile(FILE, "utf8")) as Table;
  const report = await analyze("shop.example", doh(tableFetch(table)));
  if ("missing" in report) throw new Error("src/example.json: no shop.example");
  const window = new Window();
  const { nodes } = renderReport(
    window.document as unknown as Document,
    report,
  );
  const html = nodes.map((n) => n.outerHTML).join("\n");
  await window.happyDOM.close();
  return html;
}

export function mailExample(): Plugin {
  return {
    name: "mail-example",
    transformIndexHtml: {
      order: "pre",
      handler: async (html, ctx) => {
        if (!html.includes(MARK)) throw new Error(`index.html: no ${MARK}`);
        ctx.server?.watcher.add(fileURLToPath(FILE));
        return html.replace(MARK, await exampleHtml());
      },
    },
  };
}
