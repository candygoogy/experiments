import { describe, expect, test } from "vitest";
import { ascii } from "../bytes";

describe("ascii", () => {
  test("a byte a character, from `from` to `to`", () => {
    const b = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0xe9, 0x9c, 0xff]);
    expect(ascii(b, 0, 4)).toBe("RIFF");
    expect(ascii(b, 4, 7)).toBe("é\u009cÿ");
    expect(ascii(b, 5)).toBe("\u009cÿ");
    expect(ascii(b, 6, 20)).toBe("ÿ");
  });

  test("a range of a million bytes doesn't overflow the stack", () => {
    const b = new Uint8Array(1_000_000).fill(0x61);
    const text = ascii(b, 0, b.length);
    expect(text.length).toBe(b.length);
    expect(text).toBe("a".repeat(b.length));
  });
});
