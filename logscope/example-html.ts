// The example's answer, drawn when the page is built: src/example.csv (a
// made-up System log, from test/make-fixtures.mjs) read by the page's own
// analyzer and drawn by its own code in happy-dom, then written into
// index.html in place of <!-- example -->. So the example is there from
// the first paint and takes its own space, and the reading code loads in
// the browser only for a log someone drops.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import type { Plugin } from "vite";
import { analyzeText } from "./src/analyze.ts";
import type { Result } from "./src/model.ts";
import { renderAnswer } from "./src/render.ts";

const FILE = new URL("./src/example.csv", import.meta.url);
const MARK = "<!-- example -->";

/** The example log, read. Its times are as written, so no offset. */
export async function exampleResult(): Promise<Result> {
  return analyzeText(await readFile(FILE, "utf8"), "ev-csv", {
    offset: () => 0,
  });
}

export async function exampleHtml(): Promise<string> {
  const window = new Window();
  const { nodes } = renderAnswer(
    window.document as unknown as Document,
    await exampleResult(),
    "example",
  );
  const html = nodes.map((n) => n.outerHTML).join("\n");
  await window.happyDOM.close();
  return html;
}

export function logscopeExample(): Plugin {
  return {
    name: "logscope-example",
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
