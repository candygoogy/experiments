import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// The fonts are committed (SIL Open Font License 1.1), each next to its
// license, so the build needs no network.
const DIR = join(import.meta.dirname, "..", "fonts");
const FONTS = {
  "Newsreader-Display.woff2": "OFL-Newsreader.txt",
  "SchibstedGrotesk.woff2": "OFL-SchibstedGrotesk.txt",
};
// What a page can afford to preload per face.
const MAX_BYTES = 46 * 1024;

describe("fonts", () => {
  for (const [font, license] of Object.entries(FONTS)) {
    test(`${font} is a WOFF2 of at most 46 KB`, () => {
      const bytes = readFileSync(join(DIR, font));
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
      expect(bytes.length).toBeLessThanOrEqual(MAX_BYTES);
    });

    test(`${font} comes with its license`, () => {
      expect(statSync(join(DIR, license)).size).toBeGreaterThan(0);
      expect(readFileSync(join(DIR, license), "utf8")).toContain(
        "SIL Open Font License, Version 1.1",
      );
    });
  }
});
