import { expect, test } from "vitest";
import { missingModule } from "../stale";

test("a missing module file is known in every engine, and nothing else is", () => {
  const url = "https://photo.candygoogy.dev/assets/answer-Ab12_x.js";
  for (const error of [
    new TypeError(`Failed to fetch dynamically imported module: ${url}`), // Chrome
    new TypeError(`error loading dynamically imported module: ${url}`), // Firefox
    new TypeError("Importing a module script failed."), // Safari
  ]) {
    expect(missingModule(error), error.message).toBe(true);
  }
  for (const error of [
    new TypeError("Cannot read properties of null (reading 'dataset')"),
    new SyntaxError("Unexpected token '<'"),
    new RangeError("Array buffer allocation failed"),
  ]) {
    expect(missingModule(error), error.message).toBe(false);
  }
});
