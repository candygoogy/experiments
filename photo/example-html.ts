// The example's answer, drawn when the page is built: the made-up photo in
// src/example.jpg (made by test/make-fixtures.mjs) goes through the page's
// own reader, summary and row (in happy-dom), and the result is written
// into index.html in place of <!-- example -->. So the example is there
// from the first paint, and the reader's library loads in the browser
// only for a photo someone drops. The picture is the file itself, which
// Vite copies into the build like any other image the page shows.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import type { Plugin } from "vite";
import { readPhoto } from "./src/read.ts";
import { photoRow } from "./src/render.ts";
import { segments } from "./src/strip/jpeg.ts";
import { details, sentences, summarize } from "./src/summary.ts";

const PHOTO = new URL("./src/example.jpg", import.meta.url);
const MARK = "<!-- example -->";
const NAME = "IMG_0042.jpg";

/** A JPEG's width and height, from its frame header. */
function jpegSize(b: Uint8Array): [number, number] {
  const sof = segments(b).list.find(
    (s) =>
      s.marker >= 0xc0 &&
      s.marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(s.marker),
  );
  if (!sof) throw new Error("src/example.jpg: no frame header");
  const at = sof.body + 1;
  return [
    ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0),
    ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0),
  ];
}

export async function exampleHtml(): Promise<string> {
  const bytes = new Uint8Array(await readFile(PHOTO));
  const read = await readPhoto(bytes, "jpeg");
  const summary = summarize(read?.meta, read?.groups);
  const window = new Window();
  const doc = window.document as unknown as Document;
  const picture = doc.createElement("img");
  picture.className = "thumb";
  picture.alt = "";
  picture.src = "/src/example.jpg";
  const [width, height] = jpegSize(bytes);
  picture.width = width;
  picture.height = height;
  const list = doc.createElement("ol");
  list.className = "photos";
  list.append(
    photoRow(doc, {
      name: NAME,
      size: bytes.length,
      picture,
      lines: sentences(summary),
      lead: "h3",
      details: details(summary),
    }),
  );
  const html = list.outerHTML;
  await window.happyDOM.close();
  return html;
}

export function photoExample(): Plugin {
  return {
    name: "photo-example",
    transformIndexHtml: {
      order: "pre",
      handler: async (html, ctx) => {
        if (!html.includes(MARK)) throw new Error(`index.html: no ${MARK}`);
        ctx.server?.watcher.add(fileURLToPath(PHOTO));
        return html.replace(MARK, await exampleHtml());
      },
    },
  };
}
