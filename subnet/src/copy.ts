// Every word the subnet planner shows, in one place.
import type { OddKind } from "./findings.ts";
import type { Kind } from "./ip.ts";
import type { Kind6 } from "./ip6.ts";

// Numbers with thousands commas. One formatter for the page: making one per
// number (toLocaleString) costs more than the rest of a long plan's text.
const NUMBER = new Intl.NumberFormat("en-US");
const count = (n: number | bigint) => NUMBER.format(n);

export const COPY = {
  title: "Subnet planner",
  // The meta description.
  description:
    "Type your network ranges to see them as a map, with the numbers worked out and the clashes named in plain words.",
  noscript: "This tool needs JavaScript. It runs entirely in your browser.",
  intro:
    "Type your network ranges to see them as a map, with the numbers worked out and the clashes named in plain words.",
  fileLabel: "Your ranges",
  placeholder: "home 192.168.1.0/24\niot 192.168.20.0/24",
  hint: "One range per line, with a name first if you like.",
  example: "Example: a homelab plan",
  yours: "Your plan",
  findings: "What’s worth a look",
  // Notes that don't count toward the verdict, under the findings.
  notes: "Good to know",
  privacy: "Runs in your browser. Nothing you type here leaves it.",
  split: "Split",
  splitInto: "Split into",
  fit: "Fit",
  devices: "devices each",
  add: (n: number) =>
    n === 1 ? "Add it to the plan" : `Add these ${n} to the plan`,
  part: (range: string, devices: number) =>
    `${range}: ${count(devices)} ${devices === 1 ? "device" : "devices"}`,
  tooSmall: "That range is too small to split that many ways.",
  tooBig: "No part of this range fits that many devices.",
  notWhole: "Type how many devices each part needs: a whole number, 1 or more.",
  tooMany: (max: number) =>
    `That makes more than ${max} parts. Split into fewer, or fit more devices in each.`,
  // A row's mask, wildcard, network and broadcast, folded away on phones.
  more: "Mask and counts",
  // Under the findings, when there are more than the list shows.
  moreFindings: (n: number) => `And ${count(n)} more.`,
  // Read out after Add.
  added: (n: number, name: string) =>
    `Added ${n === 1 ? "one part" : `${n} parts`} under ${name}.`,
} as const;

const NUMBERS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const num = (n: number) => NUMBERS[n] ?? count(n);
const Num = (n: number) => num(n).replace(/^./, (c) => c.toUpperCase());

// Names in a sentence: "a and b", "a, b, and c" (the last comma keeps
// "p2p, and loopback inside p2p" apart), the first four, then how many more.
const SHOWN = 4;
const names = (all: string[]) => {
  const shown = all.slice(0, SHOWN);
  const rest = all.length - shown.length;
  if (rest > 0) return `${shown.join(", ")}, and ${count(rest)} more`;
  if (shown.length < 2) return shown.join("");
  const last = shown.pop() ?? "";
  const serial = shown.length > 1 || all.some((n) => n.includes(" "));
  return `${shown.join(", ")}${serial ? "," : ""} and ${last}`;
};

export const KIND: Record<Kind, string> = {
  private: "Private (RFC 1918): fine at home.",
  cgnat:
    "Shared address space (100.64.0.0/10): used by Tailscale and some internet providers. Avoid it at home if you use Tailscale.",
  linkLocal: "Link-local: what a device gives itself when DHCP fails.",
  loopback: "Loopback: a computer talking to itself, never a network.",
  multicast: "Multicast: for group traffic, not for devices.",
  documentation:
    "Documentation (TEST-NET): kept for examples, never used on a real network.",
  thisNetwork: "0.0.0.0/8 means “this network”, not a range to use.",
  reserved: "Reserved (240.0.0.0/4): not usable.",
  benchmarking:
    "Benchmarking (198.18.0.0/15): kept for testing network gear, never used on a real network.",
  protocol:
    "Protocol assignments (192.0.0.0/24): kept for special uses, not a range to use.",
  public:
    "This is a public range on the internet. Using it inside your network hides those sites from you.",
  mixed: "This range spans more than one kind of address space.",
};

export const KIND6: Record<Kind6, string> = {
  ula: "Unique local (fc00::/7): IPv6’s private space, fine at home.",
  linkLocal6:
    "Link-local (fe80::/10): every interface has one on its own; not for planning.",
  documentation6:
    "Documentation (2001:db8::/32): kept for examples, never used on a real network.",
  loopback6: "Loopback (::1): a computer talking to itself.",
  multicast6: "Multicast: for group traffic, not for devices.",
  unspecified6: "Unspecified (::): the address that means “no address yet”.",
  compat6:
    "IPv4-compatible (::/96): an old way of writing IPv4 addresses in IPv6, no longer used.",
  mapped6:
    "IPv4-mapped (::ffff:0:0/96): IPv4 addresses written the IPv6 way, not a network of its own.",
  nat64:
    "NAT64 (64:ff9b::/96): stands in for IPv4 addresses on an IPv6-only network.",
  global:
    "Global: a public IPv6 range, usually the one your internet provider gives you.",
};

// The strip's heading: what the block is.
export const BLOCK: Partial<Record<Kind, string>> = {
  private: "Private",
  cgnat: "Shared (CGNAT)",
  public: "Public",
};

export const ROW = {
  holds: (name: string, n: number, first: string, last: string) =>
    `${name} holds ${count(n)} ${n === 1 ? "device" : "devices"}, from ${first} to ${last}.`,
  pair: (name: string, a: string, b: string) =>
    `${name} is a point-to-point link: two addresses, ${a} and ${b}.`,
  single: (name: string, a: string) => `${name} is one address, ${a}.`,
  ends: (network: string, broadcast: string) =>
    `Network ${network}, broadcast ${broadcast}.`,
  mask: (mask: string, wildcard: string) =>
    `Mask ${mask}, wildcard ${wildcard}.`,
  addresses: (n: number) => `${count(n)} ${n === 1 ? "address" : "addresses"}.`,
  v6: (name: string, prefix: number, in64s: bigint) =>
    in64s === 0n
      ? `${name} is a /${prefix}, smaller than one /64 network.`
      : `${name} is a /${prefix}: ${in64s === 1n ? "one /64 network" : `${count(in64s)} /64 networks`}.`,
  typed: (typed: string, range: string) => `${typed} means the range ${range}.`,
};

export const MAP = {
  free: (prefix: number) => `free /${prefix}`,
  // A free stretch that isn't one block, where its blocks can't be named.
  freeSize: (n: number) => `${count(n)} free`,
  // Under a strip whose small pieces are drawn larger than their share.
  notToScale:
    "Not to scale: small ranges and gaps are drawn larger so they show.",
  freeLargest: (cidr: string) => `Free: ${cidr}`,
  // One range typed under several names: one label for its box.
  together: (all: string[]) => names(all),
  docker: "Docker’s default ranges",
  // Under the map, when there are more strips than it draws.
  notDrawn: (n: number) =>
    n === 1
      ? "One more range isn’t drawn; it’s listed below."
      : `${count(n)} more ranges aren’t drawn; they’re all listed below.`,
};

export const FINDING = {
  notInside: (child: string, parent: string) =>
    `${child} is indented under ${parent} but isn’t inside it.`,
  // Ranges inside `outer`; each is a name, or "loopback inside p2p" (via).
  inside: (outer: string, inner: string[]) =>
    inner.length === 1
      ? `${inner[0]} sits inside ${outer}. Fine if ${outer} is the parent block; a conflict if they’re separate networks.`
      : `${Num(inner.length)} ranges sit inside ${outer}: ${names(inner)}. Fine if ${outer} is their parent block; a conflict if they’re separate networks.`,
  via: (inner: string, holder: string) => `${inner} inside ${holder}`,
  bridge: (a: string, how: "is" | "includes" | "inside") =>
    `${a} ${how === "is" ? "is" : how === "includes" ? "includes" : "is inside"} Docker’s default bridge (172.17.0.0/16). A Docker host routes that range to its own bridge, so the host and its containers can’t reach devices in ${how === "includes" ? `that part of ${a}` : a}.`,
  pool: (a: string) =>
    `${a} is in the range Docker gives compose networks (172.18.0.0 to 172.31.255.255). If ${a} is a network outside Docker, a new compose network can clash with it.`,
  // How the ranges meet 192.168.0.0/16: they're in it, they are it, or
  // they include it (all 0.0.0.0/0).
  pool192: (all: string[], how: "is" | "includes" | "inside") => {
    const one = all.length === 1;
    const verb =
      how === "inside"
        ? one
          ? "is in"
          : "are in"
        : how === "is"
          ? one
            ? "is"
            : "are"
          : one
            ? "includes"
            : "include";
    const them = one ? "it" : "them";
    return `${names(all)} ${verb} 192.168.0.0/16, which Docker also gives compose networks (in /20s) once 172.17 to 172.31 are used up, so on a busy Docker host a compose network can clash with ${how === "includes" ? `part of ${them}` : them}.`;
  },
  host: (typed: string, range: string) =>
    `${typed} is a host address; treated as network ${range}.`,
  sameName: (name: string, n: number) => `${Num(n)} ranges are called ${name}.`,
  sameRange: (a: string, b: string, range: string, others: number) =>
    others === 1
      ? `${a} and ${b} are the same range, ${range}.`
      : `${a} and ${count(others)} others are the same range, ${range}.`,
  bad: (line: number, text: string) => `Line ${line} isn’t a range: “${text}”.`,
  badRange: (line: number, text: string) =>
    `Line ${line} is a range from one address to another: “${text}”. Write it as an address and a size instead, like 192.168.1.0/24.`,
  badName: (line: number, text: string) =>
    `Line ${line} isn’t a range: “${text}”. Put one range on each line, with a name before it if you like.`,
  badMask: (line: number, text: string, mask: string) =>
    `Line ${line} isn’t a range: “${text}”. ${mask} isn’t a mask: a mask is all its ones and then all its zeros, like 255.255.255.0.`,
  octet: (line: number, part: string) =>
    `Line ${line}: ${part} isn’t a valid octet (0 to 255).`,
  zero: (line: number, part: string) =>
    `Line ${line}: ${part} starts with a zero, which some tools read as octal. Write it as ${Number(part)}.`,
  parts: (line: number, part: string) =>
    `Line ${line}: ${part} has ${num(part.split(".").length)} parts; an IPv4 address has four, like 192.168.1.0.`,
  prefix: (line: number, part: string, most: number) =>
    `Line ${line}: ${part} isn’t a valid size (/0 to /${most}).`,
};

// A range whose space isn't for a home or office network: what it is and
// why it's odd in a plan.
export const ODD: Record<OddKind, (a: string) => string> = {
  public: (a) =>
    `${a} is a public range on the internet. Using it inside your network hides the sites that use it from you.`,
  mixed: (a) =>
    `${a} spans more than one kind of address space, so part of it isn’t yours to use.`,
  loopback: (a) =>
    `${a} is loopback space: a computer uses it to talk to itself, so no network can.`,
  linkLocal: (a) =>
    `${a} is link-local: devices give themselves these addresses when DHCP fails, so it isn’t for planning.`,
  multicast: (a) =>
    `${a} is multicast space: it carries group traffic, so no device can have these addresses.`,
  documentation: (a) =>
    `${a} is kept for documentation: it’s for examples, never a real network.`,
  thisNetwork: (a) =>
    `${a} is in 0.0.0.0/8, which means “this network”, so it can’t be used.`,
  reserved: (a) =>
    `${a} is reserved (240.0.0.0/4): most devices won’t use these addresses.`,
  benchmarking: (a) =>
    `${a} is kept for benchmarking (198.18.0.0/15): it’s for testing network gear, not for a real network.`,
  protocol: (a) =>
    `${a} is in 192.0.0.0/24, kept for protocol assignments: it isn’t a range to use.`,
  linkLocal6: (a) =>
    `${a} is link-local: every interface has one on its own, so it isn’t for planning.`,
  loopback6: (a) =>
    `${a} is loopback (::1): a computer talking to itself, never a network.`,
  documentation6: (a) =>
    `${a} is kept for documentation (2001:db8::/32): it’s for examples, never a real network.`,
  multicast6: (a) =>
    `${a} is multicast space: it carries group traffic, so no device can have these addresses.`,
  unspecified6: (a) =>
    `${a} is ::, the address that means “no address yet”, so it can’t be used.`,
  compat6: (a) =>
    `${a} is in ::/96, the old IPv4-compatible space: an outdated way of writing IPv4 addresses in IPv6, so it isn’t for a network.`,
  mapped6: (a) =>
    `${a} is IPv4-mapped space (::ffff:0:0/96): IPv4 addresses written the IPv6 way, not a network.`,
  nat64: (a) =>
    `${a} is the NAT64 prefix (64:ff9b::/96): it stands in for IPv4 addresses, so it can’t be a network.`,
};

export const VERDICT = {
  works: "This plan works.",
  // Ranges inside one range, or inside several.
  inside: (n: number, outer: string) =>
    `${Num(n)} ${n === 1 ? "range sits" : "ranges sit"} inside ${outer}.`,
  insideMany: (n: number) => `${Num(n)} ranges sit inside other ranges.`,
  overlap: (pairs: number) =>
    pairs === 1
      ? "Two ranges overlap, so some devices won’t reach each other."
      : `${Num(pairs)} pairs of ranges overlap, so some devices won’t reach each other.`,
  worth: (n: number) =>
    `This plan works, but ${num(n)} ${n === 1 ? "thing is" : "things are"} worth a look.`,
};
