import { describe, expect, test } from "vitest";
import { open, parsePort, unbound } from "../src/ports";
import { port } from "./make";

describe("short syntax", () => {
  test.each([
    [3000, port(null, "3000")],
    ["3000", port(null, "3000")],
    ["3000-3005", port(null, "3000-3005")],
    ["8000:8000", port("8000", "8000")],
    ["9090-9091:8080-8081", port("9090-9091", "8080-8081")],
    ["49100:22", port("49100", "22")],
    ["127.0.0.1:8001:8001", port("8001", "8001", "127.0.0.1")],
    [
      "127.0.0.1:5000-5010:5000-5010",
      port("5000-5010", "5000-5010", "127.0.0.1"),
    ],
    ["127.0.0.1::5000", port(null, "5000", "127.0.0.1")],
    ["::1:6000:6000", port("6000", "6000", "::1")],
    ["[::1]:6001:6001", port("6001", "6001", "::1")],
    ["[::]:80:80", port("80", "80", "::")],
    ["6060:6060/udp", port("6060", "6060", null, "udp")],
    ["127.0.0.1:53:53/UDP", port("53", "53", "127.0.0.1", "udp")],
    ["${WEB_PORT}:80", port("${WEB_PORT}", "80")],
    ["${BIND:-127.0.0.1}:8080:80", port("8080", "80", "${BIND:-127.0.0.1}")],
  ])("%s", (entry, expected) => {
    expect(parsePort(entry)).toEqual(expected);
  });

  test("anything else is skipped", () => {
    expect(parsePort("not a port")).toBeNull();
    expect(parsePort("1:2:3:4:5")).toBeNull();
    expect(parsePort("")).toBeNull();
    expect(parsePort(null)).toBeNull();
    expect(parsePort(true)).toBeNull();
  });
});

describe("long syntax", () => {
  test("every field", () => {
    expect(
      parsePort({
        target: 80,
        published: "8080",
        host_ip: "127.0.0.1",
        protocol: "udp",
        mode: "host",
      }),
    ).toEqual(port("8080", "80", "127.0.0.1", "udp"));
  });

  test("a number published, and the defaults", () => {
    expect(parsePort({ target: 80, published: 8080 })).toEqual(
      port("8080", "80"),
    );
    expect(parsePort({ target: "443" })).toEqual(port(null, "443"));
  });

  test("no target is skipped", () => {
    expect(parsePort({ published: 8080 })).toBeNull();
  });
});

describe("open to the network", () => {
  test("anything but the server's own address", () => {
    expect(open(port("80", "80"))).toBe(true);
    expect(open(port("80", "80", "0.0.0.0"))).toBe(true);
    expect(open(port("80", "80", "::"))).toBe(true);
    expect(open(port(null, "80"))).toBe(true);
    expect(open(port("80", "80", "192.168.1.10"))).toBe(true);
  });

  test("the server only", () => {
    expect(open(port("80", "80", "127.0.0.1"))).toBe(false);
    expect(open(port("80", "80", "127.0.1.1"))).toBe(false);
    expect(open(port("80", "80", "::1"))).toBe(false);
    expect(open(port("80", "80", "localhost"))).toBe(false);
  });
});

describe("published without an address", () => {
  test("none, or every address", () => {
    expect(unbound(port("80", "80"))).toBe(true);
    expect(unbound(port("80", "80", "0.0.0.0"))).toBe(true);
    expect(unbound(port("80", "80", "::"))).toBe(true);
  });

  test("one address chosen", () => {
    expect(unbound(port("80", "80", "192.168.1.10"))).toBe(false);
    expect(unbound(port("80", "80", "127.0.0.1"))).toBe(false);
  });
});
