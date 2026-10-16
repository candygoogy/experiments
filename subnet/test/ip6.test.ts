import { describe, expect, test } from "vitest";
import { block6, cidr6, kind6, overlap6, parseV6, sizeIn64s } from "../src/ip6";

const P = (text: string) => {
  const n = parseV6(text);
  if (n === null) throw new Error(text);
  return n;
};

describe("IPv6 addresses", () => {
  test.each([
    ["::", 0n],
    ["::1", 1n],
    ["2001:db8::", 0x20010db8n << 96n],
    ["2001:DB8:0:0:0:0:0:1", (0x20010db8n << 96n) + 1n],
    ["fe80::1:2", (0xfe80n << 112n) + (1n << 16n) + 2n],
    ["::ffff:192.0.2.1", (0xffffn << 32n) + 0xc0000201n],
    ["64:ff9b::10.0.0.1", (0x64n << 112n) + (0xff9bn << 96n) + 0x0a000001n],
  ])("%s", (text, n) => {
    expect(parseV6(text)).toBe(n);
  });

  test.each([
    "",
    ":",
    ":::",
    "1::2::3",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "12345::",
    "g::1",
    "fe80::1%eth0",
    "::ffff:300.0.0.1",
    "1.2.3.4",
  ])("rejects %j", (text) => {
    expect(parseV6(text)).toBeNull();
  });
});

describe("IPv6 prefixes", () => {
  test("aligned, written short", () => {
    expect(cidr6(block6(P("2001:db8:1:2::5"), 48))).toBe("2001:db8:1::/48");
    expect(cidr6(block6(P("fd00::"), 8))).toBe("fd00::/8");
    expect(cidr6(block6(P("::"), 0))).toBe("::/0");
    expect(cidr6(block6(P("2001:db8::1"), 128))).toBe("2001:db8::1/128");
  });

  test("size in /64s", () => {
    expect(sizeIn64s(block6(P("2001:db8::"), 64))).toBe(1n);
    expect(sizeIn64s(block6(P("2001:db8::"), 56))).toBe(256n);
    expect(sizeIn64s(block6(P("2001:db8::"), 48))).toBe(65536n);
    expect(sizeIn64s(block6(P("2001:db8::"), 80))).toBe(0n);
  });

  test("overlap", () => {
    expect(
      overlap6(block6(P("2001:db8::"), 48), block6(P("2001:db8:0:5::"), 64)),
    ).toBe(true);
    expect(
      overlap6(block6(P("2001:db8::"), 48), block6(P("2001:db8:1::"), 48)),
    ).toBe(false);
  });

  test("kinds", () => {
    expect(kind6(block6(P("fd12:3456::"), 48))).toBe("ula");
    expect(kind6(block6(P("fe80::"), 64))).toBe("linkLocal6");
    expect(kind6(block6(P("2001:db8::"), 32))).toBe("documentation6");
    expect(kind6(block6(P("::1"), 128))).toBe("loopback6");
    expect(kind6(block6(P("2a01:4f8::"), 32))).toBe("global");
  });
});
