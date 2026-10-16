import { describe, expect, test } from "vitest";
import { cidr, parseV4 } from "../src/ip";
import { cidr6 } from "../src/ip6";
import { parsePlan, type Entry } from "../src/plan";

const show = (e: Entry) =>
  `${e.name}|${e.net.v === 4 ? cidr(e.net.range) : cidr6(e.net.range)}|${e.typed ?? ""}|${e.parent ?? ""}`;

describe("a plan, line by line", () => {
  test("names, with or without a colon, and none", () => {
    const { entries, bad } = parsePlan(
      "home 192.168.1.0/24\niot: 192.168.20.0/24\n10.0.30.0/24\nmy lab 10.10.0.0/16\n",
    );
    expect(entries.map(show)).toEqual([
      "home|192.168.1.0/24||",
      "iot|192.168.20.0/24||",
      "|10.0.30.0/24||",
      "my lab|10.10.0.0/16||",
    ]);
    expect(bad).toEqual([]);
  });

  test("host bits set: the range, and what was typed", () => {
    const { entries } = parsePlan("nas 192.168.1.5/24");
    expect(entries.map(show)).toEqual(["nas|192.168.1.0/24|192.168.1.5/24|"]);
  });

  test("a bare address is one address", () => {
    const { entries } = parsePlan("printer 192.168.1.20");
    expect(entries[0]?.net).toEqual({
      v: 4,
      range: { start: parseV4("192.168.1.20"), size: 1, prefix: 32 },
    });
  });

  test("bad lines are named; the others still count", () => {
    const { entries, bad } = parsePlan(
      "home 192.168.1.0/24\noops 192.168.300.1/24\nwide 10.0.0.0/33\njust words\n",
    );
    expect(entries.map((e) => e.name)).toEqual(["home"]);
    expect(bad).toEqual([
      { line: 2, text: "oops 192.168.300.1/24", why: "octet", part: "300" },
      { line: 3, text: "wide 10.0.0.0/33", why: "prefix", part: "/33" },
      { line: 4, text: "just words" },
    ]);
  });

  test("a bad line says what's wrong with it, when it can", () => {
    const why = (line: string) => {
      const [b] = parsePlan(line).bad;
      return b ? `${b.why ?? ""} ${b.part ?? ""}` : "read";
    };
    expect(why("nas 192.168.1.300/32")).toBe("octet 300");
    expect(why("x 256.0.0.0/8")).toBe("octet 256");
    expect(why("x 192.168.1/24")).toBe("parts 192.168.1");
    expect(why("x 10.0.0.0.0/8")).toBe("parts 10.0.0.0.0");
    expect(why("x 10.010.0.0/16")).toBe("zero 010");
    expect(why("x 10.0.0.0/33")).toBe("prefix /33");
    expect(why("x fd00::/129")).toBe("prefix6 /129");
    expect(why("lan 192.168.1.0 255.255.256.0")).toBe("octet 256");
    expect(why("lan 192.168.1.999 255.255.255.0")).toBe("octet 999");
    // The edges still read.
    expect(why("x 255.255.255.255/32")).toBe("read");
    expect(why("x 0.0.0.0/0")).toBe("read");
    expect(why("x fd00::/128")).toBe("read");
    // Not close enough to an address to say more.
    expect(why("just words")).toBe(" ");
    expect(why("x fd00::zz/64")).toBe(" ");
  });

  test("an address with host bits set is read as its network, and marked", () => {
    const { entries } = parsePlan(
      [
        "misaligned 192.168.1.10/24",
        "home 192.168.1.0/24",
        "lan 192.168.12.5 255.255.255.0",
        "mask 192.168.12.0 255.255.255.0",
        "v6 fd00::5/64",
      ].join("\n"),
    );
    expect(entries.map((e) => `${e.name}:${String(e.host)}`)).toEqual([
      "misaligned:true",
      "home:false",
      "lan:true",
      "mask:false",
      "v6:true",
    ]);
  });

  test("blank lines and comments are skipped; Windows line ends too", () => {
    const { entries, bad } = parsePlan(
      "# the house\r\n\r\nhome 192.168.1.0/24  # main\r\n",
    );
    expect(entries.map(show)).toEqual(["home|192.168.1.0/24||"]);
    expect(entries[0]?.line).toBe(3);
    expect(bad).toEqual([]);
  });

  test("an indented line belongs to the range above it", () => {
    const { entries } = parsePlan(
      "iot 192.168.20.0/24\n  iot-a 192.168.20.0/25\n\tiot-b 192.168.20.128/25\nguest 192.168.30.0/24\n  g1 192.168.30.0/25",
    );
    expect(entries.map((e) => e.parent)).toEqual([null, 0, 0, null, 3]);
  });

  test("an indented first line has nothing above it", () => {
    const { entries } = parsePlan("  lone 10.0.0.0/24");
    expect(entries[0]?.parent).toBeNull();
  });

  test("IPv6, with a zone id refused", () => {
    const { entries, bad } = parsePlan(
      "lan6 2001:db8:1::/48\nula fd00::/8\nlink fe80::1%eth0/64\n",
    );
    expect(entries.map(show)).toEqual([
      "lan6|2001:db8:1::/48||",
      "ula|fd00::/8||",
    ]);
    expect(bad.map((b) => b.line)).toEqual([3]);
  });

  test("IPv6 with host bits set", () => {
    const { entries } = parsePlan("v6 2001:db8:1::5/48");
    expect(entries.map(show)).toEqual(["v6|2001:db8:1::/48|2001:db8:1::5/48|"]);
  });

  test("a very long line is a bad line, read at once, quoted short", () => {
    // 100,000 spaces between a word and a non-address: every way of
    // splitting it into a name and an address would be tried.
    const long = `a${" ".repeat(100_000)}!`;
    const t0 = performance.now();
    const { entries, bad } = parsePlan(`home 192.168.1.0/24\n${long}`);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(entries.map(show)).toEqual(["home|192.168.1.0/24||"]);
    expect(bad).toEqual([{ line: 2, text: "a…" }]);
    // A long name before a range still reads, up to 300 characters.
    const named = `${"n".repeat(280)} 10.0.0.0/24`;
    expect(parsePlan(named).entries).toHaveLength(1);
  });
});
