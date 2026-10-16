// Published ports, from compose's short syntax ("127.0.0.1:8080:80/udp")
// or long syntax ({ target, published, host_ip, protocol }). Values with
// ${VAR} in them stay as written.
import type { PortMapping } from "./model.ts";

const text = (v: unknown): string | null =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : null;

// A port, a range, or a ${VAR} standing in for one.
const PORT = /^(?:\d+(?:-\d+)?|\$\{[^}]+\})$/;

// An IPv4 address or name, an IPv6 address (with :: or all eight
// groups), or a ${VAR}.
const address = (a: string) =>
  a.startsWith("${") ||
  (a.includes(":")
    ? /^[\da-f:.%]+$/i.test(a) &&
      (a.includes("::") || a.split(":").length === 8)
    : /^[\w.-]+$/.test(a));

function short(entry: string): PortMapping | null {
  let rest = entry;
  let protocol = "tcp";
  const slash = rest.lastIndexOf("/");
  if (slash !== -1) {
    protocol = rest.slice(slash + 1).toLowerCase();
    rest = rest.slice(0, slash);
  }
  let hostIp: string | null = null;
  // [::1]:6001:6001, or an IPv6 address written bare: the last two parts
  // are the ports, everything before them the address.
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close === -1 || rest[close + 1] !== ":") return null;
    hostIp = rest.slice(1, close);
    rest = rest.slice(close + 2);
  }
  // A ${VAR:-default} address may hold colons of its own.
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ":" && depth === 0) {
      parts.push(rest.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(rest.slice(start));
  let published: string | null = null;
  let target: string;
  if (parts.length === 1) {
    target = parts[0] ?? "";
  } else {
    target = parts.at(-1) ?? "";
    published = parts.at(-2) || null;
    if (parts.length > 2) {
      if (hostIp !== null) return null;
      hostIp = parts.slice(0, -2).join(":");
    }
  }
  if (!PORT.test(target) || (published !== null && !PORT.test(published))) {
    return null;
  }
  if (hostIp && !address(hostIp)) return null;
  return { hostIp: hostIp || null, published, target, protocol };
}

export function parsePort(entry: unknown): PortMapping | null {
  const s = text(entry);
  if (s !== null) return s ? short(s) : null;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const o = entry as Record<string, unknown>;
  const target = text(o["target"]);
  if (!target) return null;
  return {
    hostIp: text(o["host_ip"]) || null,
    published: text(o["published"]) || null,
    target,
    protocol: (text(o["protocol"]) || "tcp").toLowerCase(),
  };
}

/** What makes two ports the same one, when files are merged: the address,
 * both ports and the protocol. */
export const portId = (p: PortMapping): string =>
  [p.hostIp ?? "", p.published ?? "", p.target, p.protocol].join("|");

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/i;

/** Reachable from other devices: any address but the server's own. */
export const open = (p: PortMapping): boolean =>
  p.hostIp === null || !LOOPBACK.test(p.hostIp);

/** Published with no address chosen: every address the host has. */
export const unbound = (p: PortMapping): boolean =>
  p.hostIp === null || p.hostIp === "0.0.0.0" || p.hostIp === "::";
