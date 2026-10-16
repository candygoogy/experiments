// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { copy } from "../src/copy";

// The page's opening is in index.html (it shows before any script runs);
// its words must stay the same as copy.ts, where all the words live.
test("index.html says what copy.ts says", () => {
  const html = readFileSync(
    join(import.meta.dirname, "..", "index.html"),
    "utf8",
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  const say = (selector: string) =>
    doc.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
  expect(say("h1")).toBe(copy.title);
  expect(say(".intro")).toBe(copy.intro);
  expect(say(".input .label")).toBe(copy.fileLabel);
  expect(say(".example .label")).toBe(copy.example);
  expect(say(".drop-main")).toBe(copy.drop);
  expect(say(".drop-how")).toBe(copy.howTo);
});
