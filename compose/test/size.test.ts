import { expect, test } from "vitest";
import { MAX_BYTES, tooBig } from "../src/size";

test("the cap counts bytes, as a file's size does, not characters", () => {
  expect(tooBig("a".repeat(MAX_BYTES))).toBe(false);
  expect(tooBig("a".repeat(MAX_BYTES + 1))).toBe(true);
  // "é" is one character and two bytes; "€" one and three; "😀" two
  // (a surrogate pair) and four.
  const half = MAX_BYTES / 2;
  expect(tooBig("é".repeat(half))).toBe(false);
  expect(tooBig(`${"é".repeat(half)}a`)).toBe(true);
  expect(tooBig("€".repeat(Math.floor(MAX_BYTES / 3)))).toBe(false);
  expect(tooBig("€".repeat(Math.floor(MAX_BYTES / 3) + 1))).toBe(true);
  expect(tooBig("😀".repeat(MAX_BYTES / 4))).toBe(false);
  expect(tooBig(`${"😀".repeat(MAX_BYTES / 4)}a`)).toBe(true);
});
