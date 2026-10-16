// A compose file, read into the map's model (model.ts). Only the parts the
// map and its findings use are read; anything else is left alone. Several
// files pasted one after another ("---" between them) are read as one, the
// way Docker Compose merges them (merge.ts).
// Environment values are looked at once, to tell whether each is written
// out, and never kept.
import { CORE_SCHEMA, loadAll, mergeTag, YAMLException } from "js-yaml";
import { COMPOSE_TAGS, mergeDocuments, Override } from "./merge.ts";
import type {
  ComposeFile,
  Dependency,
  Mount,
  PortMapping,
  Service,
  Setting,
} from "./model.ts";
import { parsePort, portId } from "./ports.ts";
import { mount } from "./volumes.ts";

export type Parsed =
  | { file: ComposeFile }
  | { error: "yaml"; line: number | null }
  | { error: "empty" };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === "string"
    ? v
    : typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : null;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => list(v).flatMap((x) => str(x) ?? []);

// Merge keys (<<: *defaults) are common in compose files, so they're on,
// as are compose's own !reset and !override.
const SCHEMA = CORE_SCHEMA.withTags(mergeTag, COMPOSE_TAGS);

function dependencies(v: unknown): Dependency[] {
  if (Array.isArray(v)) {
    return strings(v).map((service) => ({ service, condition: "started" }));
  }
  if (!isObj(v)) return [];
  return Object.entries(v).map(([service, how]) => {
    const c = isObj(how) ? str(how["condition"]) : null;
    return {
      service,
      condition:
        c === "service_healthy"
          ? "healthy"
          : c === "service_completed_successfully"
            ? "completed"
            : "started",
    };
  });
}

// A default written into ${VAR:-default} or ${VAR-default}: used whenever
// the variable isn't set, so it's in the file. (In ${VAR:?message} the text
// is the error shown when it's missing, never the value.) A default that
// holds another variable is matched at its innermost one, so ${A:-${B:-x}}
// finds x and ${A:-x${B}} finds nothing. Both patterns take linear time,
// however long the value.
const DEFAULT = /\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^${}]*)\}/g;
// Any variable: ${VAR...} or $VAR.
const VARIABLE = /\$\{|\$[A-Za-z_]/;

/** Written out in the file: not empty, and not drawn from a variable
 * (compose reads both ${VAR} and $VAR; $$ is a written-out $), unless a
 * variable's default is written out. */
export function literal(value: string | null): boolean {
  if (value === null || value === "") return false;
  const v = value.replaceAll("$$", "");
  for (const m of v.matchAll(DEFAULT)) if (m[1]) return true;
  return !VARIABLE.test(v);
}

// What a variable may be called, dots and dashes included (Spring's
// spring.datasource.password, DB-PASSWORD); anything else (a space, an "=")
// isn't one, and isn't shown.
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function setting(rawKey: string, value: string | null): Setting[] {
  // Only the name: whatever follows an "=" in a key is a value, and a
  // value is never kept (or shown).
  const key = rawKey.split("=")[0]?.trim() ?? "";
  if (!NAME.test(key)) return [];
  return [
    {
      key,
      literal: literal(value),
      fileRef: /_FILE$/i.test(key) || (value ?? "").startsWith("/run/secrets/"),
    },
  ];
}

function environment(v: unknown): Setting[] {
  if (Array.isArray(v)) {
    return strings(v).flatMap((entry) => {
      const eq = entry.indexOf("=");
      return eq === -1
        ? setting(entry, null)
        : setting(entry.slice(0, eq), entry.slice(eq + 1));
    });
  }
  if (!isObj(v)) return [];
  return Object.entries(v).flatMap(([key, value]) => setting(key, str(value)));
}

/** The restart policy: restart:, or deploy's restart_policy (its
 * condition, "any" when it doesn't say). */
function restart(o: Obj): string | null {
  const own = str(o["restart"]);
  if (own !== null) return own;
  const deploy = o["deploy"];
  const policy = isObj(deploy) ? deploy["restart_policy"] : undefined;
  if (!isObj(policy)) return null;
  return str(policy["condition"]) ?? "any";
}

function envFiles(v: unknown): string[] {
  const all = Array.isArray(v) ? v : [v];
  return all.flatMap((x) => str(x) ?? (isObj(x) ? (str(x["path"]) ?? []) : []));
}

function healthcheck(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (v["disable"] === true) return false;
  const test = v["test"];
  if (Array.isArray(test) && test[0] === "NONE") return false;
  return true;
}

function service(name: string, raw: unknown): Service {
  const o = isObj(raw) ? raw : {};
  const networks = o["networks"];
  return {
    name,
    image: str(o["image"]),
    build: o["build"] !== undefined && o["build"] !== null,
    ports: list(o["ports"]).flatMap((p): PortMapping[] => {
      const port = parsePort(p);
      return port ? [port] : [];
    }),
    mounts: list(o["volumes"]).flatMap((m): Mount[] => {
      const found = mount(m);
      return found ? [found] : [];
    }),
    networks: Array.isArray(networks)
      ? strings(networks)
      : isObj(networks)
        ? Object.keys(networks)
        : [],
    networkMode: str(o["network_mode"]),
    dependsOn: dependencies(o["depends_on"]),
    environment: environment(o["environment"]),
    envFiles: o["env_file"] === undefined ? [] : envFiles(o["env_file"]),
    privileged: o["privileged"] === true,
    capAdd: strings(o["cap_add"]),
    devices: strings(o["devices"]),
    restart: restart(o),
    healthcheck: healthcheck(o["healthcheck"]),
    user: str(o["user"]),
    pid: str(o["pid"]),
    extends: o["extends"] !== undefined && o["extends"] !== null,
    profiles: [...new Set(strings(o["profiles"]))],
  };
}

/** The model from an already parsed document (also used at build time). */
export function toModel(doc: unknown): Parsed {
  if (!isObj(doc) || !isObj(doc["services"])) return { error: "empty" };
  const services = Object.entries(doc["services"]).map(([name, raw]) =>
    service(name, raw),
  );
  if (!services.length) return { error: "empty" };
  return {
    file: { services, include: doc["include"] !== undefined, parts: [null] },
  };
}

// A line that names the file a document came from, as the page writes it
// when several files are dropped: "# docker-compose.override.yml".
const NAMED = /^#[ \t]*([^\s#]+\.ya?ml)[ \t]*$/i;
const SEPARATOR = /^---(?:[ \t]|$)/;

/** Each document's file name, from a "# name.yml" line before its first
 * key. Documents with nothing in them (comments only) aren't counted, as
 * the parser skips them. */
export function partNames(text: string): (string | null)[] {
  const parts: { name: string | null; content: boolean }[] = [
    { name: null, content: false },
  ];
  for (const line of text.split(/\r?\n/)) {
    if (SEPARATOR.test(line)) {
      parts.push({ name: null, content: line.slice(3).trim() !== "" });
      continue;
    }
    const part = parts[parts.length - 1];
    if (!part || part.content) continue;
    const named = NAMED.exec(line.trim());
    if (named) part.name ??= named[1] ?? null;
    else if (/^\s*[^\s#]/.test(line)) part.content = true;
  }
  return parts.filter((p) => p.content).map((p) => p.name);
}

const unwrap = (v: unknown) => (v instanceof Override ? v.value : v);

/** For each service, the ports written before the last document that sets
 * it: a ports list in that document would be added to them. A port belongs
 * to the last document that writes it. */
function markEarlier(services: Service[], docs: unknown[]) {
  const last = new Map<string, number>();
  const wrote = new Map<string, Map<string, number>>();
  docs.forEach((doc, i) => {
    const d = unwrap(doc);
    const all = isObj(d) ? unwrap(d["services"]) : null;
    if (!isObj(all)) return;
    for (const [name, raw] of Object.entries(all)) {
      const o = unwrap(raw);
      if (!isObj(o)) continue;
      last.set(name, i);
      const ports = unwrap(o["ports"]);
      if (!Array.isArray(ports)) continue;
      const own = wrote.get(name) ?? new Map<string, number>();
      wrote.set(name, own);
      for (const p of ports) {
        const port = parsePort(p);
        if (port) own.set(portId(port), i);
      }
    }
  });
  for (const s of services) {
    const part = last.get(s.name);
    if (!part) continue;
    const own = wrote.get(s.name);
    const ports = s.ports.filter((p) => (own?.get(portId(p)) ?? part) < part);
    if (ports.length) s.earlier = { part, ports };
  }
}

export function parseCompose(text: string): Parsed {
  // Nothing but blank lines and comments: nothing to map, not an error.
  if (!/^\s*[^\s#]/m.test(text)) return { error: "empty" };
  let doc: unknown;
  let docs: unknown[];
  try {
    docs = loadAll(text, { schema: SCHEMA, maxAliases: 1000 }).filter(
      (d) => d !== null && d !== undefined,
    );
    doc = mergeDocuments(docs);
  } catch (error) {
    if (error instanceof YAMLException) {
      const line = error.mark?.line;
      return {
        error: "yaml",
        line: typeof line === "number" ? line + 1 : null,
      };
    }
    // An empty file, or a limit reached (too many aliases, or a merge that
    // would take too long): nothing to map.
    return { error: "empty" };
  }
  const model = toModel(doc);
  if ("file" in model) {
    const count = docs.length;
    if (count > 1) markEarlier(model.file.services, docs);
    const names = partNames(text);
    // The names line up with the documents, or none is used.
    model.file.parts =
      names.length === count ? names : Array<null>(count).fill(null);
  }
  return model;
}
