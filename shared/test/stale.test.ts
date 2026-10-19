// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { missingModule, reloadOnce, settle } from "../stale";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

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

test("the page reloads once, and again only once its code has loaded since", () => {
  const reload = vi.fn();
  vi.stubGlobal("location", { reload });
  expect(reloadOnce()).toBe(true);
  // The reload didn't help: never again, so it can't loop.
  expect(reloadOnce()).toBe(false);
  expect(reload).toHaveBeenCalledTimes(1);
  // It did, and a later deploy takes another file away.
  settle();
  expect(reloadOnce()).toBe(true);
  expect(reload).toHaveBeenCalledTimes(2);
});
