// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseDuration, parseMwh, parseReport } from "../src/parse";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("parseMwh", () => {
  test.each([
    "45,000 mWh",
    "45.000 mWh",
    "45 000 mWh",
    "45 000 mWh",
    "45 000 mWh",
  ])("%j is 45000", (text) => {
    expect(parseMwh(text)).toBe(45000);
  });

  test.each(["-", "", "mWh"])("%j is null", (text) => {
    expect(parseMwh(text)).toBeNull();
  });
});

describe("parseDuration", () => {
  test("h:mm:ss in seconds", () => {
    expect(parseDuration("5:12:30")).toBe(18750);
    expect(parseDuration("0:07:00")).toBe(420);
    expect(parseDuration("-")).toBeNull();
  });
});

describe("parseReport", () => {
  test("reads the English report", () => {
    const result = parseReport(fixture("en.html"));
    if (!result.ok) throw new Error(result.reason);
    expect(result.batteries).toEqual([
      { design: 45000, full: 25650, cycles: 611 },
    ]);
    expect(result.history).toHaveLength(24);
    expect(result.history[0]).toEqual({
      label: "2026-04-27 - 2026-05-04",
      full: 44100,
      design: 45000,
    });
    expect(result.history.at(-1)).toEqual({
      label: "2026-10-05",
      full: 25650,
      design: 45000,
    });
    expect(result.estimates).toHaveLength(24);
    expect(result.estimates[0]).toEqual({
      label: "2026-04-27 - 2026-05-04",
      atFull: 19992,
      atDesign: 20400,
    });
  });

  test("reads the Italian report the same way", () => {
    const en = parseReport(fixture("en.html"));
    const it = parseReport(fixture("it.html"));
    if (!en.ok || !it.ok) throw new Error("not read");
    expect(it.batteries).toEqual([
      { design: 45000, full: 25650, cycles: null },
    ]);
    expect(it.history).toEqual(en.history);
    expect(it.estimates).toEqual(en.estimates);
  });

  test("two batteries, in report order", () => {
    const result = parseReport(fixture("two-batteries.html"));
    if (!result.ok) throw new Error(result.reason);
    expect(result.batteries).toEqual([
      { design: 45000, full: 41000, cycles: 120 },
      { design: 24000, full: 16800, cycles: 340 },
    ]);
  });

  test("no capacity history", () => {
    const result = parseReport(fixture("no-history.html"));
    if (!result.ok) throw new Error(result.reason);
    expect(result.history).toEqual([]);
    expect(result.batteries).toHaveLength(1);
  });

  test("a design capacity of 0, and no cycle count row", () => {
    const result = parseReport(fixture("design-zero.html"));
    if (!result.ok) throw new Error(result.reason);
    expect(result.batteries).toEqual([
      { design: 0, full: 25650, cycles: null },
    ]);
  });

  test("no battery", () => {
    expect(parseReport(fixture("no-battery.html"))).toEqual({
      ok: false,
      reason: "no-battery",
    });
  });

  test("the XML report", () => {
    expect(parseReport(fixture("report.xml"))).toEqual({
      ok: false,
      reason: "xml",
    });
  });

  test.each([
    ["an unrelated page", fixture("not-a-report.html")],
    ["plain text", "hello"],
    ["nothing", ""],
    ["binary noise", "\u0000\u0001PNG\r\n\u001a"],
  ])("%s is not a report", (_name, source) => {
    expect(parseReport(source)).toEqual({ ok: false, reason: "not-a-report" });
  });

  test("never carries the PC's name or the serial number", () => {
    const text = JSON.stringify(parseReport(fixture("en.html")));
    expect(text).not.toContain("000000");
    expect(text).not.toContain("TEST-PC");
    expect(text).not.toContain("Example");
  });
});
