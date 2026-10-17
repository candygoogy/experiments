// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { arrive, ms } from "../arrive";

afterEach(() => document.documentElement.style.removeProperty("--dur-ui"));

test("ms reads a CSS time in either unit", () => {
  expect(ms("200ms")).toBe(200);
  expect(ms(".2s")).toBe(200);
  expect(ms(" 0.35s ")).toBe(350);
  expect(ms("")).toBeNaN();
});

test("the minified token (.2s) still fades over 200ms", () => {
  document.documentElement.style.setProperty("--dur-ui", ".2s");
  const el = document.createElement("div");
  const animate = vi.fn();
  el.animate = animate;
  arrive(el);
  expect(animate).toHaveBeenCalledOnce();
  expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 200 });
});
