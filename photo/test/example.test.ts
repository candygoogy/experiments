import { Window } from "happy-dom";
import { expect, test } from "vitest";
import { exampleHtml } from "../example-html";
import { copy } from "../src/copy";

/** The example as the page carries it, parsed. */
async function example() {
  const window = new Window();
  const doc = window.document as unknown as Document;
  doc.body.innerHTML = `<section>${await exampleHtml()}</section>`;
  return doc.querySelector("section") as HTMLElement;
}

test("the example is drawn into the page by the page's own code", async () => {
  const html = await example();
  const say = (selector: string) =>
    [...html.querySelectorAll(selector)].map((n) =>
      n.textContent.replace(/\s+/g, " ").trim(),
    );
  // A heading under the example's label, then the lines.
  expect(say("h3.lead")).toEqual([
    "This photo carries the exact place it was taken (51.4769° N, 0.0005° W). Anyone you send it to can see it.",
  ]);
  expect(say(".line")).toEqual([
    "It names the camera that took it: Example Phone 1.",
    "It records when it was taken: Oct 1, 2026, 18:42.",
    "It names a person: Your Name.",
  ]);
  expect(say(".file")[0]).toMatch(/^IMG_0042\.jpg\d+\.\d KB$/);
  // Its picture is the photo itself, copied into the build; never a
  // download.
  const img = html.querySelector("img.thumb");
  expect(img?.getAttribute("src")).toBe("/src/example.jpg");
  expect(img?.getAttribute("alt")).toBe("");
  expect(html.querySelector(".download")).toBeNull();
  // Show everything works before any script: both labels are there.
  expect(say(".all summary span")).toEqual([copy.showAll, copy.hide]);
});
