// The example's answer, drawn when the page is built: the made-up plan in
// src/example.txt goes through the page's own reading and rendering code
// (in happy-dom), and the result is written into index.html in place of
// <!-- example -->. Its strips' boxes are sized by CSS, so the browser
// only draws into them; nothing moves. The plan itself rides along in
// data-plan, for drawing.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import type { Plugin } from "vite";
import { parsePlan } from "./src/plan.ts";
import { renderPlan } from "./src/render.ts";

const FILE = new URL("./src/example.txt", import.meta.url);
const MARK = "<!-- example -->";

const attr = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll("\n", "&#10;");

export async function exampleHtml(): Promise<string> {
  const plan = await readFile(FILE, "utf8");
  const { entries, bad } = parsePlan(plan);
  const window = new Window();
  const { nodes } = renderPlan(
    window.document as unknown as Document,
    entries,
    bad,
    "example",
    { split: false },
  );
  const html = nodes.map((n) => n.outerHTML).join("\n");
  await window.happyDOM.close();
  return `<div class="out" data-plan="${attr(plan)}">\n${html}\n</div>`;
}

export function subnetExample(): Plugin {
  return {
    name: "subnet-example",
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
