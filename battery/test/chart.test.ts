// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import {
  chartFloor,
  chartMax,
  designLabel,
  drawHistory,
  floorLabel,
  wornLabel,
} from "../src/chart";
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
    // The two lines, and the 80% guide with the axes.
    expect(svg.querySelectorAll("path")).toHaveLength(3);
    expect(svg.querySelectorAll(".axes path.worn")).toHaveLength(1);
    const children = [...svg.children].map(
      (c) => `${c.tagName.toLowerCase()}.${c.getAttribute("class")}`,
    );
    expect(children).toEqual(["g.axes", "path.design", "path.full"]);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  test("the line runs from the first point to the last, over the foot", () => {
    const svg = document.createElementNS(SVG, "svg");
    drawHistory(svg, [
      { label: "a", full: 45000, design: 45000 },
      { label: "b", full: 25000, design: 45000 },
    ]);
    // 600 × 200 drawing: the top is the largest capacity, the bottom the
    // foot: 25,000 less 8% of 45,000 is 21,400, rounded down to 20,000.
    expect(svg.querySelector(".full")?.getAttribute("d")).toBe("M0 0 L600 160");
    expect(svg.querySelector(".design")?.getAttribute("d")).toBe("M0 0 L600 0");
    // 80% of 45,000 is 36,000.
    expect(svg.querySelector(".worn")?.getAttribute("d")).toBe("M0 72 L600 72");
  });

  test("no original capacity: from 0 up, and no 80% guide", () => {
    const svg = document.createElementNS(SVG, "svg");
    drawHistory(svg, [
      { label: "a", full: 25650, design: 0 },
      { label: "b", full: 25000, design: 0 },
    ]);
    expect(svg.querySelector(".full")?.getAttribute("d")).toBe("M0 0 L600 5.1");
    expect(svg.querySelector(".worn")).toBeNull();
  });

  test("drawing again replaces the old drawing", () => {
    const svg = document.createElementNS(SVG, "svg");
    drawHistory(svg, points(10));
    drawHistory(svg, points(5));
    expect(svg.querySelectorAll("path")).toHaveLength(3);
  });
});

/** Weekly points from `from` down to `to`, against one original capacity. */
const fall = (design: number, from: number, to: number, n = 50) =>
  Array.from({ length: n }, (_, i) => ({
    label: `${i}`,
    full: Math.round(from + ((to - from) * i) / (n - 1)),
    design,
  }));

describe("the axis floor", () => {
  test("a healthy battery: about 60% of the original, on a round number", () => {
    // 89% of 35,300: the foot is under 60% (21,180), at 20,000.
    expect(chartFloor(fall(35300, 35300, 31420))).toBe(20000);
  });

  test("lower when the line goes lower", () => {
    // 55%, with a dip to 18,300: the foot drops to 15,000, under the dip.
    const low = fall(35300, 35000, 19415);
    low[40] = { label: "dip", full: 18300, design: 35300 };
    expect(chartFloor(low)).toBe(15000);
    expect(Math.min(...low.map((p) => p.full))).toBeGreaterThan(15000);
  });

  test("never above 60% of the original, never under 0", () => {
    for (const health of [1.1, 0.95, 0.8, 0.6, 0.4, 0.2, 0.05]) {
      const floor = chartFloor(fall(45000, 45000, 45000 * health));
      expect(floor).toBeLessThanOrEqual(0.6 * 45000);
      expect(floor).toBeGreaterThanOrEqual(0);
      expect(floor).toBeLessThan(45000 * health);
    }
  });

  test("a very long history doesn't overflow the stack", () => {
    // 200,000 weeks: the same top and foot as a short history.
    const long = fall(45000, 45000, 40000, 200_000);
    expect(chartMax(long)).toBe(45000);
    expect(chartFloor(long)).toBe(chartFloor(fall(45000, 45000, 40000)));
  });

  test("0 without an original capacity", () => {
    expect(chartFloor(fall(0, 25650, 25000))).toBe(0);
    expect(chartFloor([])).toBe(0);
  });

  test("the foot is labelled with its value, so it never reads as 0", () => {
    expect(floorLabel(fall(35300, 35300, 31420))).toEqual({
      value: 20000,
      at: 1,
      below: false,
    });
    expect(floorLabel(fall(0, 25650, 25000))).toBeNull();
  });
});

describe("wornLabel", () => {
  test("80% of the original, over its guide", () => {
    // Foot 20,000, top 35,300: 28,240 is 0.461 of the way down.
    expect(wornLabel(fall(35300, 35300, 31420))).toEqual({
      value: 28240,
      at: 0.461,
      below: false,
    });
  });

  test("under its guide where the line starts just above it", () => {
    expect(wornLabel(fall(35300, 29000, 27000))?.below).toBe(true);
  });

  test("no original capacity, no guide", () => {
    expect(wornLabel(fall(0, 25650, 25000))).toBeNull();
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
    ).toEqual({ value: 45000, at: 0.101, below: true });
  });

  test("no original capacity, no label", () => {
    expect(designLabel([{ label: "a", full: 25650, design: 0 }])).toBeNull();
    expect(designLabel([])).toBeNull();
  });
});
