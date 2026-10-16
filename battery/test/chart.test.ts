// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { designLabel, drawHistory } from "../src/chart";
import type { HistoryPoint } from "../src/parse";

const SVG = "http://www.w3.org/2000/svg";
const points = (n: number): HistoryPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    label: `2020-01-01 - 2020-01-08 #${i}`,
    full: 45000 - i * 20,
    design: 45000,
  }));

describe("drawHistory", () => {
  test("a long history is still two paths and the axes", () => {
    const svg = document.createElementNS(SVG, "svg");
    drawHistory(svg, points(600));
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    const children = [...svg.children].map(
      (c) => `${c.tagName.toLowerCase()}.${c.getAttribute("class")}`,
    );
    expect(children).toEqual(["g.axes", "path.design", "path.full"]);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  test("the line runs from the first point to the last, from 0 up", () => {
    const svg = document.createElementNS(SVG, "svg");
    drawHistory(svg, [
      { label: "a", full: 45000, design: 45000 },
      { label: "b", full: 22500, design: 45000 },
    ]);
    // 600 × 200 drawing: the top is the largest capacity, the bottom 0.
    expect(svg.querySelector(".full")?.getAttribute("d")).toBe("M0 0 L600 100");
    expect(svg.querySelector(".design")?.getAttribute("d")).toBe("M0 0 L600 0");
  });

  test("drawing again replaces the old drawing", () => {
    const svg = document.createElementNS(SVG, "svg");
    drawHistory(svg, points(10));
    drawHistory(svg, points(5));
    expect(svg.querySelectorAll("path")).toHaveLength(2);
  });
});

describe("designLabel", () => {
  test("names the original capacity, over the dashed line at the top", () => {
    expect(
      designLabel([
        { label: "a", full: 44000, design: 45000 },
        { label: "b", full: 25650, design: 45000 },
      ]),
    ).toEqual({ value: 45000, at: 0, below: false });
  });

  test("over 100%: still the original capacity, under its line", () => {
    // The solid line peaks at 47,800, so the dashed line sits lower.
    expect(
      designLabel([
        { label: "a", full: 47800, design: 45000 },
        { label: "b", full: 46060, design: 45000 },
      ]),
    ).toEqual({ value: 45000, at: 0.059, below: true });
  });

  test("no original capacity, no label", () => {
    expect(designLabel([{ label: "a", full: 25650, design: 0 }])).toBeNull();
    expect(designLabel([])).toBeNull();
  });
});
