import { describe, expect, test } from "vitest";
import {
  codesOf,
  LAYOUTS,
  type LayoutName,
  nameOf,
  place,
  widthOf,
  withoutNumpad,
} from "../src/layouts";

const names = Object.keys(LAYOUTS) as LayoutName[];
const width = (row: { w?: number }[]) =>
  row.reduce((s, k) => s + (k.w ?? 1), 0);

describe.each(names)("%s", (name) => {
  const layout = LAYOUTS[name];
  const keys = layout.flat().filter((k) => k.code);

  test("codes are unique", () => {
    const codes = keys.map((k) => k.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("has the keys every full-size board has", () => {
    for (const code of [
      "Escape",
      "F12",
      "NumpadEnter",
      "ArrowUp",
      "MetaRight",
    ]) {
      expect(codesOf(layout)).toContain(code);
    }
  });

  test("every row spans the same width", () => {
    const first = width(layout[0] ?? []);
    expect(first).toBeCloseTo(23, 2);
    for (const row of layout) expect(width(row)).toBeCloseTo(first, 2);
  });

  test("no two keys overlap, two-row keys included", () => {
    // Quarter-unit cells: every width here is a multiple of 0.25.
    const taken = new Map<string, string>();
    for (const { key, x, row } of place(layout)) {
      for (let r = 0; r < (key.h ?? 1); r++) {
        const from = x + (r > 0 ? (key.lowerInset ?? 0) : 0);
        for (let c = from * 4; c < (x + (key.w ?? 1)) * 4; c++) {
          const cell = `${row + r}:${c}`;
          expect(
            taken.get(cell),
            `${key.code} over ${taken.get(cell)}`,
          ).toBeUndefined();
          taken.set(cell, key.code);
        }
      }
    }
  });

  test("the Win keys and Print Screen are marked partial", () => {
    const partial = keys.filter((k) => k.partial).map((k) => k.code);
    expect(partial.sort()).toEqual(["MetaLeft", "MetaRight", "PrintScreen"]);
  });

  test("Fn isn't drawn: it never reaches the browser", () => {
    expect(keys.some((k) => /^fn$/i.test(k.label))).toBe(false);
  });
});

test("ISO has the extra key by the left Shift, ANSI doesn't", () => {
  expect(codesOf(LAYOUTS.iso)).toContain("IntlBackslash");
  expect(codesOf(LAYOUTS.ansi)).not.toContain("IntlBackslash");
});

test("the standard counts: ISO 105 keys, ANSI 104", () => {
  expect(codesOf(LAYOUTS.iso).size).toBe(105);
  expect(codesOf(LAYOUTS.ansi).size).toBe(104);
});

test("the ISO Enter spans two rows with its notch; ANSI's is one row", () => {
  const isoEnter = LAYOUTS.iso.flat().find((k) => k.code === "Enter");
  const ansiEnter = LAYOUTS.ansi.flat().find((k) => k.code === "Enter");
  expect(isoEnter).toMatchObject({ h: 2, w: 1.5, lowerInset: 0.25 });
  expect(ansiEnter?.h ?? 1).toBe(1);
});

test("keys are named for sentences", () => {
  expect(nameOf("Space")).toBe("Space");
  expect(nameOf("KeyE", LAYOUTS.iso)).toBe("E");
  expect(nameOf("Semicolon", LAYOUTS.iso)).toBe("ò");
  expect(nameOf("Lang1")).toBe("Lang1");
});

test("Right Alt reads Alt Gr on ISO and Alt on ANSI", () => {
  expect(nameOf("AltRight", LAYOUTS.iso)).toBe("Alt Gr");
  expect(nameOf("AltRight", LAYOUTS.ansi)).toBe("Alt");
});

describe.each(names)("%s without the number pad", (name) => {
  const full = LAYOUTS[name];
  const small = withoutNumpad(full);

  test("every row spans 18.5 units, and nothing of the pad is left", () => {
    expect(widthOf(full)).toBe(23);
    for (const row of small) expect(width(row)).toBe(18.5);
    const codes = [...codesOf(small)];
    expect(codes.some((c) => c.startsWith("Numpad") || c === "NumLock")).toBe(
      false,
    );
  });

  test("the rest is untouched: 17 keys fewer (88 ISO, 87 ANSI)", () => {
    expect(codesOf(small).size).toBe(codesOf(full).size - 17);
    for (const code of ["Insert", "PageDown", "ArrowLeft", "Pause", "Enter"]) {
      expect(codesOf(small)).toContain(code);
    }
  });
});
