// A battery's health in words: what it holds now against what it held new.
import { copy, fill } from "./copy";
import type { Battery } from "./parse";

export type Level = "healthy" | "worn" | "worn-out" | "unknown";

/** Full charge capacity over design capacity; null without a design. */
export function health(b: Battery): number | null {
  if (!b.design || b.full === null) return null;
  return b.full / b.design;
}

/** 80% or more is healthy (the common service line), 60–79% worn. */
export function level(h: number | null): Level {
  if (h === null) return "unknown";
  if (h >= 0.8) return "healthy";
  if (h >= 0.6) return "worn";
  return "worn-out";
}

/** The whole percentage it holds, rounded down so it never overstates
 * health and always agrees with the level (79.6% is "worn", shown 79%).
 * Worked out from the whole numbers, so 57% doesn't come out as 56. */
export function percent(b: Battery): number | null {
  if (!b.design || b.full === null) return null;
  return Math.floor((b.full * 100) / b.design);
}

export function verdictText(b: Battery): string {
  const pct = percent(b);
  switch (level(health(b))) {
    case "healthy":
      return fill((pct ?? 0) > 100 ? copy.healthyAbove : copy.healthy, {
        pct: pct ?? 0,
      });
    case "worn":
      return fill(copy.worn, { pct: pct ?? 0 });
    case "worn-out":
      return fill(copy.wornOut, { pct: pct ?? 0 });
    case "unknown":
      return copy.unknown;
  }
}
