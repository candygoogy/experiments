// The example's answer, drawn when the page is built: src/example.yml read
// by the page's own parser and rendered by its own code (in happy-dom),
// then written into index.html in place of <!-- example -->. So the example
// is on the page from the first paint, takes its own space (nothing moves
// when it's there), and the parser loads in the browser only for a file
// someone pastes or drops. Only the wires are drawn in the browser.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import type { Plugin } from "vite";
import { parseCompose } from "./src/parse.ts";
import { renderAnswer } from "./src/render.ts";

const FILE = new URL("./src/example.yml", import.meta.url);
const MARK = "<!-- example -->";

export async function exampleHtml(): Promise<string> {
  const parsed = parseCompose(await readFile(FILE, "utf8"));
  if (!("file" in parsed)) throw new Error("src/example.yml doesn't parse");
  const window = new Window();
  const { nodes } = renderAnswer(
    window.document as unknown as Document,
    parsed.file,
    "example",
  );
  const html = nodes.map((n) => n.outerHTML).join("\n");
  await window.happyDOM.close();
  return html;
}

export function composeExample(): Plugin {
  return {
    name: "compose-example",
    transformIndexHtml: {
      order: "pre",
      handler: async (html, ctx) => {
        if (!html.includes(MARK)) {
          throw new Error(`index.html: no ${MARK}`);
        }
        ctx.server?.watcher.add(fileURLToPath(FILE));
        return html.replace(MARK, await exampleHtml());
      },
    },
  };
}
