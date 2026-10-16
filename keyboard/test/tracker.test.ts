import { beforeEach, describe, expect, test } from "vitest";
import { codesOf, LAYOUTS } from "../src/layouts";
import { KeyTracker } from "../src/tracker";

let k: KeyTracker;
beforeEach(() => {
  k = new KeyTracker(codesOf(LAYOUTS.iso));
});

describe("chatter", () => {
  test("a press 29 ms after the release counts", () => {
    k.down("KeyA", 0, false);
    k.up("KeyA", 50);
    expect(k.down("KeyA", 79, false)).toEqual([
      { kind: "chatter", code: "KeyA", ms: 29 },
    ]);
  });

  test("a press 31 ms after doesn't", () => {
    k.down("KeyA", 0, false);
    k.up("KeyA", 50);
    expect(k.down("KeyA", 81, false)).toEqual([]);
  });

  test("auto-repeat is never chatter, nor a new press", () => {
    k.down("KeyA", 0, false);
    expect(k.down("KeyA", 10, true)).toEqual([]);
    expect(k.down("KeyA", 40, true)).toEqual([]);
    expect(k.pressed.size).toBe(1);
  });

  test("a repeat after the release isn't chatter either", () => {
    k.down("KeyA", 0, false);
    k.up("KeyA", 50);
    expect(k.down("KeyA", 60, true)).toEqual([]);
  });
});

describe("held keys", () => {
  test("three keys down at once → rollover 3", () => {
    k.down("KeyA", 0, false);
    k.down("KeyS", 1, false);
    k.down("KeyD", 2, false);
    k.up("KeyA", 3);
    expect(k.maxHeld).toBe(3);
  });

  test("a key held 3.5 s is reported", () => {
    k.down("KeyQ", 0, false);
    expect(k.heldLongerThan(3500, 3000)).toEqual([
      { kind: "held", code: "KeyQ", ms: 3500 },
    ]);
    expect(k.heldLongerThan(2999, 3000)).toEqual([]);
  });

  test("losing focus releases everything: no false stuck key", () => {
    k.down("KeyQ", 0, false);
    k.down("AltLeft", 0, false);
    k.releaseAll();
    expect(k.pressed.size).toBe(0);
    expect(k.heldLongerThan(10_000, 3000)).toEqual([]);
    expect(k.seen).toContain("KeyQ");
  });
});

describe("seen and extra", () => {
  test("a key not on the drawing is extra, not seen, and never throws", () => {
    expect(() => k.down("Lang1", 0, false)).not.toThrow();
    expect(k.extra).toContain("Lang1");
    expect(k.seen).not.toContain("Lang1");
  });

  test("a key that only reports its release still counts (Print Screen)", () => {
    k.up("PrintScreen", 5);
    expect(k.seen).toContain("PrintScreen");
    expect(k.pressed.size).toBe(0);
  });

  test("a key with no code is ignored", () => {
    expect(k.down("", 0, false)).toEqual([]);
    expect(k.seen.size + k.extra.size).toBe(0);
  });

  test("reset forgets everything", () => {
    k.down("KeyA", 0, false);
    k.up("KeyA", 10);
    k.down("Lang1", 20, false);
    k.reset();
    expect([k.seen.size, k.extra.size, k.pressed.size, k.maxHeld]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(k.down("KeyA", 25, false)).toEqual([]); // no chatter against a forgotten release
  });
});

describe("Alt Gr on Windows (Ctrl+Alt underneath)", () => {
  test("its Left Ctrl press is dropped: Ctrl isn't marked tested", () => {
    k.down("ControlLeft", 100, false);
    k.down("AltRight", 100.4, false);
    expect([...k.pressed]).toEqual(["AltRight"]);
    expect(k.seen).not.toContain("ControlLeft");
    k.up("ControlLeft", 300);
    k.up("AltRight", 300);
    expect(k.seen).not.toContain("ControlLeft");
    expect(k.seen).toContain("AltRight");
    expect(k.maxHeld).toBe(1);
  });

  test("a real Left Ctrl held before Alt Gr stays", () => {
    k.down("ControlLeft", 0, false);
    k.down("AltRight", 400, false);
    expect(k.pressed).toContain("ControlLeft");
    expect(k.maxHeld).toBe(2);
  });

  test("Left Ctrl tested for real earlier stays seen", () => {
    k.down("ControlLeft", 0, false);
    k.up("ControlLeft", 100);
    k.down("ControlLeft", 500, false);
    k.down("AltRight", 501, false);
    expect(k.seen).toContain("ControlLeft");
  });
});

describe("releases that don't belong to a press", () => {
  test("a release with no press seen is ignored (Enter that started the test)", () => {
    k.up("Enter", 5);
    expect(k.seen).not.toContain("Enter");
    expect(k.down("Enter", 20, false)).toEqual([]); // no chatter against it
  });

  test("Print Screen, which only reports its release, still counts", () => {
    k.up("PrintScreen", 5);
    expect(k.seen).toContain("PrintScreen");
  });

  test("Unidentified and empty codes are ignored entirely", () => {
    k.down("Unidentified", 0, false);
    k.up("Unidentified", 5);
    k.down("", 10, false);
    k.up("", 15);
    expect(k.seen.size + k.extra.size + k.pressed.size).toBe(0);
  });
});

describe("Alt Gr and losing focus", () => {
  test("the ghost Left Ctrl release that arrives after a blur is swallowed", () => {
    k.down("ControlLeft", 100, false);
    k.down("AltRight", 100.4, false);
    k.releaseAll();
    k.up("ControlLeft", 300);
    k.up("AltRight", 300);
    expect(k.seen).not.toContain("ControlLeft");
  });
});

describe("a ghost whose release never comes", () => {
  test("a later real Left Ctrl press and release aren't swallowed", () => {
    k.down("ControlLeft", 0, false);
    k.down("AltRight", 1, false);
    k.releaseAll(); // the releases went to another window
    k.down("ControlLeft", 5000, false);
    k.up("ControlLeft", 5100);
    expect(k.pressed.size).toBe(0);
    expect(k.seen).toContain("ControlLeft");
    expect(k.heldLongerThan(9000, 3000)).toEqual([]);
  });

  test("a new Alt Gr after it is still recognised as one", () => {
    k.down("ControlLeft", 0, false);
    k.down("AltRight", 1, false);
    k.releaseAll();
    k.down("ControlLeft", 5000, false);
    k.down("AltRight", 5000.5, false);
    k.up("ControlLeft", 5100);
    k.up("AltRight", 5100);
    expect(k.seen).not.toContain("ControlLeft");
    expect(k.pressed.size).toBe(0);
  });
});

describe("switching layout", () => {
  test("what both layouts share carries over; the rest doesn't", () => {
    const ansi = codesOf(LAYOUTS.ansi);
    k.down("KeyA", 0, false);
    k.up("KeyA", 10);
    k.down("IntlBackslash", 20, false); // ISO only
    k.up("IntlBackslash", 30);
    k.down("Lang1", 40, false); // on neither
    k.up("Lang1", 50);
    k.down("KeyS", 60, false);
    k.down("KeyD", 61, false);
    k.down("KeyF", 62, false);
    k.up("KeyS", 70);
    k.up("KeyD", 70);
    k.up("KeyF", 70);
    const next = k.carryTo(ansi);
    expect([...next.seen].sort()).toEqual(["KeyA", "KeyD", "KeyF", "KeyS"]);
    expect([...next.extra]).toEqual(["Lang1"]);
    expect(next.maxHeld).toBe(3);
    expect(next.pressed.size).toBe(0);
    // A shared key's last release still counts for a double press.
    expect(next.down("KeyA", 25, false)).toEqual([
      { kind: "chatter", code: "KeyA", ms: 15 },
    ]);
  });
});
