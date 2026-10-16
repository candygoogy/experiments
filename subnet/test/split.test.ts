import { describe, expect, test } from "vitest";
import { block, cidr, parseV4 } from "../src/ip";
import { addSplit, splitEqual, splitFit } from "../src/split";

const R = (text: string) => {
  const [a = "", p = "32"] = text.split("/");
  return block(parseV4(a) ?? 0, Number(p));
};
const cidrs = (
  r:
    | { parts: { start: number; size: number; prefix: number }[] }
    | { problem: string },
) => ("parts" in r ? r.parts.map(cidr) : r.problem);

describe("split into equal parts", () => {
  test("2, 4, 8, 16", () => {
    expect(cidrs(splitEqual(R("192.168.20.0/24"), 2))).toEqual([
      "192.168.20.0/25",
      "192.168.20.128/25",
    ]);
    expect(cidrs(splitEqual(R("192.168.20.0/24"), 4))).toEqual([
      "192.168.20.0/26",
      "192.168.20.64/26",
      "192.168.20.128/26",
      "192.168.20.192/26",
    ]);
    expect(cidrs(splitEqual(R("10.0.0.0/8"), 16))).toHaveLength(16);
  });

  test("not past /32", () => {
    expect(cidrs(splitEqual(R("10.0.0.0/30"), 8))).toBe("tooSmall");
    expect(cidrs(splitEqual(R("10.0.0.0/31"), 2))).toEqual([
      "10.0.0.0/32",
      "10.0.0.1/32",
    ]);
  });
});

describe("split to fit N devices each", () => {
  test("the smallest parts that still fit", () => {
    // 50 devices need a /26 (62 usable).
    expect(cidrs(splitFit(R("192.168.20.0/24"), 50))).toEqual([
      "192.168.20.0/26",
      "192.168.20.64/26",
      "192.168.20.128/26",
      "192.168.20.192/26",
    ]);
    // 62 still fits a /26; 63 needs a /25.
    expect(cidrs(splitFit(R("192.168.20.0/24"), 62))).toHaveLength(4);
    expect(cidrs(splitFit(R("192.168.20.0/24"), 63))).toHaveLength(2);
  });

  test("more than the range holds, or too many parts", () => {
    expect(cidrs(splitFit(R("192.168.20.0/24"), 300))).toBe("tooBig");
    expect(cidrs(splitFit(R("192.168.20.0/24"), 254))).toEqual([
      "192.168.20.0/24",
    ]);
    expect(cidrs(splitFit(R("10.0.0.0/8"), 2))).toBe("tooMany");
    expect(cidrs(splitFit(R("10.0.0.0/24"), 0))).toBe("tooBig");
  });
});

describe("adding the parts to the plan", () => {
  const plan =
    "home 192.168.1.0/24\niot 192.168.20.0/24\n  old 192.168.20.0/25\nguest 192.168.30.0/24\n";

  test("indented under their range, in place of its old parts, the range kept", () => {
    expect(addSplit(plan, 2, "iot", splitParts("192.168.20.0/24", 2))).toBe(
      "home 192.168.1.0/24\niot 192.168.20.0/24\n  iot-1 192.168.20.0/25\n  iot-2 192.168.20.128/25\nguest 192.168.30.0/24\n",
    );
  });

  test("a range with no name gives unnamed parts; the last line works too", () => {
    expect(addSplit("10.0.0.0/24", 1, "", splitParts("10.0.0.0/24", 2))).toBe(
      "10.0.0.0/24\n  10.0.0.0/25\n  10.0.0.128/25",
    );
  });
});

function splitParts(text: string, n: 2 | 4 | 8 | 16) {
  const r = splitEqual(R(text), n);
  if (!("parts" in r)) throw new Error(text);
  return r.parts;
}
