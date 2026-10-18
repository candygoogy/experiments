import { expect, test } from "vitest";
import { fill } from "../copy";

test("fill puts each value in its place, as often as it's named", () => {
  expect(fill("{n} of {total} photos", { n: 2, total: 5 })).toBe(
    "2 of 5 photos",
  );
  expect(fill("{n}, {n}", { n: "x" })).toBe("x, x");
  expect(fill("{n} cycles", { n: 0 })).toBe("0 cycles");
});

test("fill leaves a name with no value as it is", () => {
  expect(fill("{n} of {total}", { n: 1 })).toBe("1 of {total}");
  expect(fill("no names here", { n: 1 })).toBe("no names here");
});
