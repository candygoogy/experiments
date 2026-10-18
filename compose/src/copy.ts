// Every word the compose map shows, in one place.
import type { Finding } from "./findings.ts";
import { about, severity } from "./rank.ts";
import type { Band } from "./layout.ts";
import type { Dependency, Mount, PortMapping } from "./model.ts";

export const COPY = {
  title: "Compose map",
  // The meta description.
  description:
    "Paste a docker-compose file to see your services as a map, and what’s exposed.",
  noscript: "This tool needs JavaScript. It runs entirely in your browser.",
  intro:
    "Paste a docker-compose file to see your services as a map, and what’s exposed.",
  fileLabel: "Your compose file",
  placeholder:
    'services:\n  web:\n    image: nginx:1.27\n    ports:\n      - "8080:80"',
  drop: "Drop it here, or",
  pick: "choose the file",
  example: "Example: a homelab",
  yours: "Your map",
  // Over the findings, for screen readers.
  findings: "What’s worth a look",
  privacy: "Runs in your browser. Nothing you paste or drop here is uploaded.",
  notYaml: (line: number | null) =>
    line === null
      ? "This doesn’t read as YAML. Check the indentation."
      : `This doesn’t read as YAML (line ${line}). Check the indentation there.`,
  // After the problem, while the last map that read stays on the page.
  stale: "The map still shows the last version that read correctly.",
  empty: "This file has no services to map.",
  tooBig: "This file is too big to read here.",
  // Text the parser reads but the map can't be drawn from: a fault in this
  // page, not something to fix in the file.
  cantDraw: "Something in this file stopped the map from being drawn.",
  // The page's reader didn't load (the network, say), or the file couldn't
  // be read from disk.
  wrong: "Something went wrong while reading this. Try again.",
  // The page's reader is gone: a newer version of the page replaced it
  // since this one opened. The page doesn't reload itself, which would
  // lose what was pasted.
  changed:
    "This page has changed since it opened. Reload it, then paste or drop your file again.",
  include: "This file includes other files, which the map doesn’t follow.",
  // Several files (or "---" documents), merged as Docker Compose merges
  // them. Without -f it merges only a main file and its override; any
  // other set of files only when each is passed with -f, in that order.
  merged: (names: (string | null)[]) => {
    if (!names.every((n) => n !== null)) {
      return `Read as one, the way Docker Compose merges them: the ${num(names.length)} parts, top to bottom.`;
    }
    const [main, override] = names;
    const own =
      names.length === 2 &&
      /^(?:docker-)?compose\.ya?ml$/i.test(main ?? "") &&
      /^(?:docker-)?compose\.override\.ya?ml$/i.test(override ?? "");
    return own
      ? `Read as one, the way Docker Compose merges them when you don’t pass -f: ${names.join(", then ")}.`
      : `Read as one, in this order: ${names.join(", then ")}. Docker Compose merges them like this only when you pass each with -f. On its own, it reads just compose.yaml and compose.override.yaml, or docker-compose.yml and docker-compose.override.yml.`;
  },
  // No service says what it runs: an override read on its own.
  overrideOnly:
    "No service here names an image, so this looks like an override file. Docker Compose merges it into the main file: drop both together, or paste the main file first, then a line with ---, then this one.",
  // A main file dropped alone, by its usual name.
  overrideHint: (override: string) =>
    `If there’s a ${override} next to this file, Docker Compose merges it in: drop both together to see them as one.`,
  extends: (names: string[]) =>
    `${list(names)} ${names.length === 1 ? "extends another service" : "extend other services"}, which the map doesn’t follow.`,
  // Read out once a map is drawn.
  ready: (services: number, verdict: string) =>
    `Mapped ${services === 1 ? "one service" : `${services} services`}. ${verdict}`,
} as const;

export function list(items: string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const WORDS = [
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
const num = (n: number) => WORDS[n] ?? String(n);
/** "debug", "debug or test", "a, b or c". */
const either = (items: string[]) =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The map's words: the bands, the rows and what's under them.
export const MAP = {
  edge: "Your network",
  built: "built from its folder",
  noImage: "no image",
  privileged: "privileged",
  socket: "controls Docker",
  // A service that runs only with a profile turned on.
  profile: (profiles: string[]) => `only with the ${either(profiles)} profile`,
  // Read before each port by screen readers.
  openPrefix: "open to your network on port ",
  localPrefix: "open to the server only on port ",
  local: "local",
  // A published port with no host port written: Docker picks one.
  random: "random port",
  randomPort: (local: boolean, target: string, protocol: string) =>
    `open to ${local ? "the server only" : "your network"} on a host port Docker picks, for port ${target}${protocol === "tcp" ? "" : `/${protocol}`}`,
  // A variable alone could be a host folder or a volume.
  mountKind: (m: Mount) =>
    m.kind === "bind"
      ? "Host"
      : m.kind === "tmpfs"
        ? "Memory"
        : m.kind === "variable"
          ? "Set by"
          : "Volume",
  mount: (m: Mount) =>
    `${m.kind === "anonymous" ? "unnamed, " : m.source ? `${m.source} ` : ""}at ${m.target}${m.readOnly ? ", read-only" : ""}`,
  after: (deps: Dependency[]) =>
    `Starts after ${list(
      deps.map((d) =>
        d.condition === "healthy"
          ? `${d.service} is healthy`
          : d.condition === "completed"
            ? `${d.service} has finished`
            : d.service,
      ),
    )}.`,
  alsoOn: (networks: string[]) =>
    `Also on ${list(networks)}${networks.length > 1 ? " networks" : " network"}.`,
  band: (b: Pick<Band, "kind" | "name">) =>
    b.kind === "host"
      ? "The host’s own network"
      : b.kind === "none"
        ? "No network"
        : b.name === "default"
          ? "The default network"
          : `The ${b.name ?? ""} network`,
};

// A finding's sentence, in parts: the services it names are marked, so
// the page can set them in weight.
export type Part = string | { name: string };

const names = (services: readonly string[]): Part[] =>
  services.flatMap((name, i): Part[] => [
    ...(i === 0 ? [] : [i === services.length - 1 ? " and " : ", "]),
    { name },
  ]);

const proto = (p: PortMapping) =>
  p.protocol === "tcp" ? "" : `/${p.protocol}`;

/** A port as compose's short syntax writes it: "8080:80", "[::]:53:53/udp". */
const written = (p: PortMapping) =>
  `${p.hostIp ? (p.hostIp.includes(":") ? `[${p.hostIp}]:` : `${p.hostIp}:`) : ""}${p.published ? `${p.published}:` : ""}${p.target}${proto(p)}`;

const ROOT_PATHS: Record<string, string> = {
  "/": "every file on the host (/)",
  "/etc": "the host’s settings and password files (/etc)",
  "/root": "the host’s root user’s files (/root)",
};

const CAPS: Record<string, string> = {
  NET_ADMIN: "change the host’s network settings",
  SYS_ADMIN: "do most of what the host’s root user can",
  ALL: "use every power the kernel hands out, close to privileged",
};

/** A finding's sentence, then a note for each service in it that runs
 * only with a profile turned on. */
export function say(f: Finding): Part[] {
  const notes = (f.profiled ?? []).flatMap(([name, profiles]): Part[] => [
    " ",
    { name },
    ` runs only when the ${either(profiles)} profile is turned on.`,
  ]);
  return [...sentence(f), ...notes];
}

function sentence(f: Finding): Part[] {
  switch (f.rule) {
    case "socket":
      return [
        { name: f.service },
        ` can control Docker itself through ${f.path}, which means the whole host.`,
      ];
    case "privileged":
      return [
        ...names(f.services),
        f.services.length === 1
          ? " is privileged, so it can do almost anything the host can, including reach every device."
          : " are privileged, so they can do almost anything the host can, including reach every device.",
      ];
    case "rootMount":
      return [
        { name: f.service },
        ` can reach ${list(f.paths.map((p) => ROOT_PATHS[p] ?? p))} from its container.`,
      ];
    case "caps":
      return [
        { name: f.service },
        ` adds ${list(f.caps)}, so it can ${list(f.caps.map((c) => CAPS[c] ?? c))}.`,
      ];
    case "secrets": {
      const it = f.keys.length === 1 ? "it" : "them";
      return [
        { name: f.service },
        ` has ${list(f.keys.map((k) => `${k}=••••`))} written in the file, so anyone who can read the file can read ${it}. An env_file or a Docker secret keeps ${it} out.`,
      ];
    }
    case "openPorts": {
      const many = f.ports.length > 1;
      const it = many ? "them" : "it";
      const shown = f.ports.map((p) =>
        p.published
          ? `${p.published}${proto(p)}`
          : `one Docker picks for ${p.target}${proto(p)}`,
      );
      const first = f.ports[0];
      const local = first
        ? `127.0.0.1:${first.published ?? ""}:${first.target}${proto(first)}`
        : "";
      // An override's ports are added to the earlier file's, so there the
      // list has to be replaced whole.
      const before = f.earlier;
      const override = before
        ? ` In ${before.file ?? "an override file"}, that would add ${many ? "ports, not replace them" : "a port, not replace one"}: ${list(before.ports.map(written))} ${before.ports.length === 1 ? "stays" : "stay"} open. There, write ports: !override, then the whole list.`
        : "";
      return [
        { name: f.service },
        ` is open to every device on your network on ${many ? "ports" : "port"} ${list(shown)}, and to the internet if your router forwards ${it}. If only the server itself needs ${it} (another container, or a reverse proxy on the same host), write ${local}${many ? ", and the same for each" : ""}.${override}`,
      ];
    }
    case "hostNetwork":
      return [
        ...names(f.services),
        f.services.length === 1
          ? " uses the host’s own network, so every port it opens is open on the host, with no Docker rules in between."
          : " use the host’s own network, so every port they open is open on the host, with no Docker rules in between.",
      ];
    case "hostPid":
      return [
        ...names(f.services),
        f.services.length === 1
          ? " shares the host’s process list (pid: host), so it can see, and with the right powers stop, every process on the host."
          : " share the host’s process list (pid: host), so they can see, and with the right powers stop, every process on the host.",
      ];
    case "portClash": {
      const port = `${f.port.includes("-") ? "ports" : "port"} ${f.port}`;
      return [
        ...names(f.services),
        f.services.length === 2
          ? ` both publish ${port}, so only one of them can start.`
          : f.all
            ? ` all publish ${port}, so only one of them can start.`
            : ` all publish ${port}, so they can’t all start.`,
      ];
    }
    case "waitsForHealth":
      return [
        { name: f.service },
        " waits for ",
        { name: f.on },
        " to be healthy, but ",
        { name: f.on },
        " has no healthcheck in this file. Unless its image has one, ",
        { name: f.service },
        " never starts.",
      ];
    case "latest":
      return [
        ...names(f.services),
        f.services.length === 1
          ? " uses the latest image, so an update can change it without warning. Add a version to the image name to choose when it changes."
          : " use the latest image, so an update can change them without warning. Add a version to each image name to choose when they change.",
      ];
    case "noRestart":
      return [
        ...names(f.services),
        f.services.length === 1
          ? " has no restart policy, so it won’t come back after a reboot."
          : " have no restart policy, so they won’t come back after a reboot.",
      ];
  }
}

/** A sentence's parts as plain text. */
export const plain = (parts: Part[]): string =>
  parts.map((p) => (typeof p === "string" ? p : p.name)).join("");

/** The first line: the worst there is, then how much else. */
export function verdict(all: Finding[]): string {
  if (!all.length) return "Nothing here stands out.";
  const worst = all.filter((f) => severity(f) === 3);
  if (worst.length) {
    const services = new Set(worst.flatMap(about)).size;
    const lead =
      services === 1
        ? "One service can take over the whole host"
        : `${capital(num(services))} services can take over the whole host`;
    const rest = all.length - worst.length;
    return rest
      ? `${lead}, and ${num(rest)} more ${rest === 1 ? "thing is" : "things are"} worth a look.`
      : `${lead}.`;
  }
  const n = all.length;
  if (all.some((f) => severity(f) > 1)) {
    return `Nothing can take over the host, but ${num(n)} ${n === 1 ? "thing is" : "things are"} worth a look.`;
  }
  return `Nothing serious, just ${num(n)} small ${n === 1 ? "thing" : "things"} to tidy.`;
}
