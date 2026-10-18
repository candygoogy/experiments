// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { copy, together } from "../src/copy";

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
  // Said when the reader doesn't load (main.ts), so it's in the page.
  expect(doc.querySelector("[data-answer]")?.getAttribute("data-wrong")).toBe(
    copy.wrong,
  );
});

// What several photos give away together: the counts, in words.
describe("several photos, together", () => {
  test("two that both carry the place: both, never all 2", () => {
    expect(together({ total: 2, place: 2, other: 2 })).toEqual([
      "Both photos carry the exact place they were taken.",
      "Both of them give away other details, listed below.",
    ]);
  });

  test("two with no place: neither, never none of these 2", () => {
    expect(together({ total: 2, place: 0, other: 1 })).toEqual([
      "Neither photo carries the place it was taken.",
      "1 of them gives away other details, listed below.",
    ]);
    expect(together({ total: 2, place: 0, other: 0 })).toEqual([
      "Nothing personal found in these 2 photos.",
    ]);
  });

  test("one of two, and three or more, count as before", () => {
    expect(together({ total: 2, place: 1, other: 0 })).toEqual([
      "1 of 2 photos carries the exact place it was taken.",
    ]);
    expect(together({ total: 3, place: 3, other: 3 })).toEqual([
      "All 3 photos carry the exact place they were taken.",
      "3 of them give away other details, listed below.",
    ]);
    expect(together({ total: 3, place: 0, other: 2 })).toEqual([
      "None of these 3 photos carries the place it was taken.",
      "2 of them give away other details, listed below.",
    ]);
  });
});
