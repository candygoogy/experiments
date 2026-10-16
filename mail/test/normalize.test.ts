import { expect, test } from "vitest";
import { normalizeDomain, reservedName } from "../src/normalize";

test.each([
  ["example.com", "example.com"],
  ["  Example.COM.  ", "example.com"],
  ["me@Example.com", "example.com"],
  ["first.last+tag@mail.example.co.uk", "mail.example.co.uk"],
  ["https://example.com/path?x=1#y", "example.com"],
  ["http://user:pw@example.com:8080/", "example.com"],
  ["example.com/contact", "example.com"],
  ["example.com:25", "example.com"],
  ["bücher.de", "xn--bcher-kva.de"],
  ["mail@bücher.de", "xn--bcher-kva.de"],
  ["xn--bcher-kva.de", "xn--bcher-kva.de"],
  ["a-b.example", "a-b.example"],
])("%s → %s", (input, expected) => {
  expect(normalizeDomain(input)).toBe(expected);
});

test.each([
  "",
  "   ",
  "localhost",
  "not a domain",
  "192.168.1.1",
  "[::1]",
  "-bad.com",
  "bad-.com",
  "a..b.com",
  "exa_mple.com",
  "example.123",
  "@",
  "me@",
  `${"a".repeat(64)}.com`,
  `${"a.".repeat(127)}com`,
])("rejects %j", (input) => {
  expect(normalizeDomain(input)).toBeNull();
});

// Names that are never in public DNS (RFC 2606, RFC 6761 and the
// special-use names after it): answered on the page, never asked of
// Cloudflare.
test.each([
  "a.localhost",
  "foo.invalid",
  "foo.test",
  "shop.example",
  "printer.local",
  "abc.onion",
  "router.home.arpa",
  "x.alt",
])("reserved: %s", (domain) => {
  expect(reservedName(domain)).toBe(true);
});

// example.com, .net and .org are kept for examples too, but they're real
// names with real records, so they can be checked.
test.each([
  "example.com",
  "example.net",
  "example.org",
  "test.com",
  "localhost.example.com",
  "invalid.co.uk",
  "arpa.example.com",
])("not reserved: %s", (domain) => {
  expect(reservedName(domain)).toBe(false);
});
