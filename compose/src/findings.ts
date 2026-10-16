// What's worth a look in a compose file, as data: the page words each one
// (copy.ts). The worst come first: what gives a service the whole host,
// then what's exposed or fragile, then what to tidy.
import type { ComposeFile, PortMapping, Service } from "./model.ts";
import { unbound } from "./ports.ts";
import { about, severity } from "./rank.ts";

export { about, severity } from "./rank.ts";

export type Finding = (
  | { rule: "socket"; service: string; path: string }
  | { rule: "privileged"; services: string[] }
  | { rule: "rootMount"; service: string; paths: string[] }
  | { rule: "caps"; service: string; caps: string[] }
  | { rule: "secrets"; service: string; keys: string[] }
  | {
      rule: "openPorts";
      service: string;
      ports: PortMapping[];
      // The open ports an earlier file wrote, and the name of the later
      // file that also sets the service (null when it has none): a ports
      // list written there is added to them, not put in their place.
      earlier?: { file: string | null; ports: PortMapping[] };
    }
  | { rule: "hostNetwork"; services: string[] }
  | { rule: "hostPid"; services: string[] }
  // Every service that publishes the host port (or range) `port`, with its
  // protocol; `all`: no two of them could run side by side.
  | { rule: "portClash"; services: string[]; port: string; all: boolean }
  | { rule: "waitsForHealth"; service: string; on: string }
  | { rule: "latest"; services: string[] }
  | { rule: "noRestart"; services: string[] }
) & {
  // The services it names that run only with a profile turned on, each
  // with its profiles.
  profiled?: [string, string[]][];
};

const RULES: Finding["rule"][] = [
  "socket",
  "privileged",
  "rootMount",
  "caps",
  "secrets",
  "openPorts",
  "hostNetwork",
  "hostPid",
  "portClash",
  "waitsForHealth",
  "latest",
  "noRestart",
];

// Docker's (or Podman's) socket, wherever it lives (rootless Docker keeps
// it under $XDG_RUNTIME_DIR), and Docker's named pipe on Windows.
const SOCKETS = new Set(["docker.sock", "podman.sock"]);
const PIPE = /[\\/]pipe[\\/]docker_engine$/i;
const ROOTS = ["/", "/etc", "/root"];
const POWERFUL = ["NET_ADMIN", "SYS_ADMIN", "ALL"];

// A setting's name in words: split at _ . - and between a lower-case
// letter and a capital (dbPassword), upper-cased.
const words = (key: string) =>
  key
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .split(/[_.-]+/)
    .filter(Boolean);
// A word that names a secret, alone (DB_PASSWORD, APP_KEY) or ending a
// word run together (PGPASSWORD, AUTHTOKEN). KEY and PASS only alone:
// MONKEY, KEYBOARD and BYPASS aren't secrets.
const SECRET_WORD =
  /^(?:PASS|PWD|KEY|APIKEY|PRIVATEKEY|SECRETS?|TOKENS?|CREDENTIALS?|PASSPHRASE)$|(?:PASSWORD|PASSWD|SECRET|TOKEN)$/;
// A last word that makes the setting about the secret, not the secret
// itself: PASSWORD_MIN_LENGTH, TOKEN_EXPIRY, SSH_KEY_PATH.
const ABOUT = new Set([
  "LENGTH",
  "LEN",
  "MIN",
  "MAX",
  "FILE",
  "PATH",
  "DIR",
  "URL",
  "URI",
  "ENABLED",
  "ENABLE",
  "REQUIRED",
  "POLICY",
  "EXPIRY",
  "EXPIRE",
  "EXPIRES",
  "EXPIRATION",
  "TTL",
  "TIMEOUT",
  "TYPE",
  "ID",
  "NAME",
  "HEADER",
  "COUNT",
]);

/** A setting whose name says it holds a secret. */
export function secretName(key: string): boolean {
  const w = words(key);
  const last = w.at(-1);
  if (!last || ABOUT.has(last)) return false;
  return w.some((x) => SECRET_WORD.test(x));
}

const binds = (s: Service) =>
  s.mounts.flatMap((m) => (m.kind === "bind" && m.source ? [m.source] : []));
const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** Docker's own socket, if the service has it mounted. */
export const socketPath = (s: Service): string | undefined =>
  binds(s).find((p) => {
    const path = trimSlash(p);
    return SOCKETS.has(path.split(/[\\/]/).at(-1) ?? "") || PIPE.test(path);
  });

// An image with no tag, or the latest one. A digest pins it; a ${VAR} in
// the tag is someone's choice.
function floating(image: string): boolean {
  if (image.includes("@") || image.includes("${")) return false;
  const name = image.slice(image.lastIndexOf("/") + 1);
  const colon = name.indexOf(":");
  return colon === -1 || name.slice(colon + 1) === "latest";
}

// A published port or range as numbers, when it's written as numbers.
function hostPorts(p: PortMapping): [number, number] | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(p.published ?? "");
  if (!m) return null;
  const a = Number(m[1]);
  return [a, m[2] ? Number(m[2]) : a];
}

// Two services can't both publish one host port, for the same protocol,
// on addresses that overlap. One sentence per port: every service that
// publishes it, and whether any two of them could still run side by side.
function clashes(services: Service[]): Finding[] {
  const shared = (a: PortMapping, b: PortMapping) =>
    a.protocol === b.protocol &&
    (unbound(a) || unbound(b) || a.hostIp === b.hostIp);
  const published = services.flatMap((s, order) =>
    s.ports.flatMap((p) => {
      const range = hostPorts(p);
      return range ? [{ s, order, p, range }] : [];
    }),
  );
  // Each port (or overlap of ranges) in the order it's met, with the
  // services that publish it and the pairs that clash.
  const found = new Map<
    string,
    { port: string; first: number; services: Set<string>; pairs: Set<string> }
  >();
  published.forEach((a, i) => {
    for (const b of published.slice(i + 1)) {
      if (a.s === b.s || !shared(a.p, b.p)) continue;
      const lo = Math.max(a.range[0], b.range[0]);
      const hi = Math.min(a.range[1], b.range[1]);
      if (lo > hi) continue;
      const port = `${lo === hi ? lo : `${lo}-${hi}`}${a.p.protocol === "tcp" ? "" : `/${a.p.protocol}`}`;
      const entry = found.get(port) ?? {
        port,
        first: Math.min(a.order, b.order),
        services: new Set<string>(),
        pairs: new Set<string>(),
      };
      entry.services.add(a.s.name).add(b.s.name);
      entry.pairs.add(JSON.stringify([a.s.name, b.s.name].sort()));
      found.set(port, entry);
    }
  });
  const order = new Map(services.map((s, i) => [s.name, i]));
  return [...found.values()]
    .sort((x, y) => x.first - y.first)
    .map((e) => {
      const names = [...e.services].sort(
        (x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0),
      );
      const n = names.length;
      return {
        rule: "portClash" as const,
        services: names,
        port: e.port,
        all: e.pairs.size === (n * (n - 1)) / 2,
      };
    });
}

export function findings(file: ComposeFile): Finding[] {
  const { services } = file;
  const byName = new Map(services.map((s) => [s.name, s]));
  const named = (test: (s: Service) => boolean) =>
    services.filter(test).map((s) => s.name);
  const out: Finding[] = [];

  for (const s of services) {
    const socket = socketPath(s);
    if (socket) out.push({ rule: "socket", service: s.name, path: socket });
    const paths = [
      ...new Set(
        binds(s)
          .map(trimSlash)
          .filter((p) => ROOTS.includes(p)),
      ),
    ];
    if (paths.length) out.push({ rule: "rootMount", service: s.name, paths });
    const caps = [
      ...new Set(
        s.capAdd
          .map((c) => c.toUpperCase().replace(/^CAP_/, ""))
          .filter((c) => POWERFUL.includes(c)),
      ),
    ];
    if (caps.length) out.push({ rule: "caps", service: s.name, caps });
    const keys = s.environment
      .filter((e) => e.literal && !e.fileRef && secretName(e.key))
      .map((e) => e.key);
    if (keys.length) out.push({ rule: "secrets", service: s.name, keys });
    const ports = s.ports.filter(unbound);
    if (ports.length && s.networkMode !== "host") {
      const before = s.earlier?.ports.filter(unbound) ?? [];
      out.push(
        s.earlier && before.length
          ? {
              rule: "openPorts",
              service: s.name,
              ports,
              earlier: {
                file: file.parts[s.earlier.part] ?? null,
                ports: before,
              },
            }
          : { rule: "openPorts", service: s.name, ports },
      );
    }
    for (const d of s.dependsOn) {
      const on = byName.get(d.service);
      if (d.condition === "healthy" && on && !on.healthcheck) {
        out.push({ rule: "waitsForHealth", service: s.name, on: on.name });
      }
    }
  }
  const groups: Finding[] = [
    { rule: "privileged", services: named((s) => s.privileged) },
    { rule: "hostNetwork", services: named((s) => s.networkMode === "host") },
    { rule: "hostPid", services: named((s) => s.pid === "host") },
    {
      rule: "latest",
      // A service built here names its own image with image:, so an
      // untagged name there isn't "latest" from anywhere.
      services: named((s) => s.image !== null && !s.build && floating(s.image)),
    },
    {
      rule: "noRestart",
      // deploy's restart_policy says "none" for no.
      services: named(
        (s) => s.restart === null || s.restart === "no" || s.restart === "none",
      ),
    },
  ];
  for (const g of groups) {
    if ("services" in g && g.services.length) out.push(g);
  }
  out.push(...clashes(services));

  // The worst first; within a rule, the file's order (sort is stable).
  return out
    .map((f): Finding => {
      const profiled = about(f).flatMap((name): [string, string[]][] => {
        const profiles = byName.get(name)?.profiles ?? [];
        return profiles.length ? [[name, profiles]] : [];
      });
      return profiled.length ? { ...f, profiled } : f;
    })
    .map((f, i) => ({ f, i }))
    .sort(
      (a, b) =>
        severity(b.f) - severity(a.f) ||
        RULES.indexOf(a.f.rule) - RULES.indexOf(b.f.rule) ||
        a.i - b.i,
    )
    .map(({ f }) => f);
}
