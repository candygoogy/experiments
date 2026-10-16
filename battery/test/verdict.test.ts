import { describe, expect, test } from "vitest";
import { health, level, verdictText } from "../src/verdict";

describe("level", () => {
  test.each([
    [0.8, "healthy"],
    [0.7999, "worn"],
    [0.6, "worn"],
    [0.5999, "worn-out"],
    [null, "unknown"],
  ] as const)("%s is %s", (h, want) => {
    expect(level(h)).toBe(want);
  });
});

describe("health", () => {
  test("full over design, none without a design capacity", () => {
    expect(health({ design: 45000, full: 36000, cycles: null })).toBe(0.8);
    expect(health({ design: 0, full: 36000, cycles: null })).toBeNull();
    expect(health({ design: null, full: 36000, cycles: null })).toBeNull();
    expect(health({ design: 45000, full: null, cycles: null })).toBeNull();
  });
});

describe("verdictText", () => {
  test("worn out", () => {
    expect(verdictText({ design: 45000, full: 25650, cycles: 611 })).toBe(
      "Worn out. It holds only 57% of its original charge. Plan a replacement.",
    );
  });

  test("over 100% is healthy, and says that's normal when young", () => {
    expect(verdictText({ design: 45000, full: 47800, cycles: 3 })).toBe(
      "Healthy. It holds 106% of its original charge. Over 100% is normal for a young battery.",
    );
    expect(verdictText({ design: 45000, full: 45000, cycles: 3 })).toBe(
      "Healthy. It still holds 100% of its original charge.",
    );
  });

  test("the shown percentage is rounded down, so it agrees with the level", () => {
    expect(verdictText({ design: 1000, full: 796, cycles: null })).toBe(
      "Worn. It holds 79% of its original charge, so expect less runtime than when it was new.",
    );
    expect(verdictText({ design: 1000, full: 800, cycles: null })).toBe(
      "Healthy. It still holds 80% of its original charge.",
    );
  });

  test("no design capacity", () => {
    expect(verdictText({ design: 0, full: 25650, cycles: null })).toBe(
      "Windows didn’t record this battery’s original capacity, so there’s nothing to compare it with.",
    );
  });
});
