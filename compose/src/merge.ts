// Several compose documents read as one, the way Docker Compose merges an
// override file into the main one (docker-compose.override.yml, or each
// -f file in turn, or each "---" document of one file):
//   - a mapping is merged key by key, the later file winning;
//   - a list is added to, skipping exact repeats;
//   - a single value is replaced; an empty one (null) leaves it alone;
//   - environment and labels are merged by name (a name with no value
//     replaces the earlier one: the value then comes from the shell),
//     depends_on and networks by service and network name (written as a
//     list or a mapping);
//   - ports are added unless the same one is already there; volumes and
//     devices are merged by where they appear in the container;
//   - command, entrypoint and the healthcheck's test are replaced whole;
//   - !reset removes what an earlier file set, and !override replaces it
//     whole.
import {
  defineMappingTag,
  defineScalarTag,
  defineSequenceTag,
  type TagDefinition,
} from "js-yaml";
import { parsePort, portId } from "./ports.ts";
import { mount } from "./volumes.ts";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Override);

/** !reset: whatever an earlier file set here is removed. */
export const RESET: unique symbol = Symbol("reset");

/** !override: replaces what an earlier file set here, unmerged. */
export class Override {
  constructor(readonly value: unknown) {}
}

// A mapping that takes any key as data, "__proto__" included.
const put = (o: Obj, key: unknown, value: unknown) => {
  Object.defineProperty(o, String(key), {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

const never = () => false;

/** The two tags, for each kind of node they can mark. */
export const COMPOSE_TAGS: TagDefinition[] = [
  defineScalarTag<typeof RESET>("!reset", {
    resolve: () => RESET,
    identify: never,
  }),
  defineSequenceTag<null, typeof RESET>("!reset", {
    create: () => null,
    addItem: () => undefined,
    finalize: () => RESET,
    identify: never,
  }),
  defineMappingTag<null, typeof RESET>("!reset", {
    create: () => null,
    addPair: () => "",
    has: never,
    keys: () => [],
    get: () => undefined,
    finalize: () => RESET,
    identify: never,
  }),
  defineScalarTag<Override>("!override", {
    resolve: (source) => new Override(source),
    identify: never,
  }),
  defineSequenceTag<unknown[], Override>("!override", {
    create: () => [],
    addItem: (items, item) => {
      items.push(item);
    },
    finalize: (items) => new Override(items),
    identify: never,
  }),
  defineMappingTag<Obj, Override>("!override", {
    create: () => ({}),
    addPair: (o, key, value) => {
      put(o, key, value);
      return "";
    },
    has: (o, key) => Object.hasOwn(o, String(key)),
    keys: (r) => Object.keys(r.value as Obj),
    get: (r, key) => (r.value as Obj)[String(key)],
    finalize: (o) => new Override(o),
    identify: never,
  }),
];

/** Thrown when merging would take more work than any real compose file
 * needs (aliases can make a short file stand for a huge one). */
export class TooComplex extends Error {}

// Nodes visited while merging, at most. Real files need a few thousand.
const BUDGET = 200_000;
let spent = 0;
const spend = () => {
  if (++spent > BUDGET) throw new TooComplex("too complex");
};

// Each node settled once: an alias used many times stays one node, so the
// work grows with the text, never with what its aliases stand for.
let settled = new WeakMap<object, unknown>();

/** A document with its tags settled: !reset entries gone, !override
 * values unwrapped. */
function settle(v: unknown): unknown {
  if (v === RESET) return undefined;
  if (v instanceof Override) return settle(v.value);
  if (!v || typeof v !== "object") return v;
  const known = settled.get(v);
  if (known !== undefined) return known;
  spend();
  let out: unknown;
  if (Array.isArray(v)) {
    out = v.map(settle).filter((x) => x !== undefined);
  } else {
    const o: Obj = {};
    for (const [k, x] of Object.entries(v)) {
      const s = settle(x);
      if (s !== undefined) put(o, k, s);
    }
    out = o;
  }
  settled.set(v, out);
  return out;
}

// What makes two list items the same: a plain value by its value, anything
// else by being the very same node.
const ids = new WeakMap<object, number>();
let nextId = 0;
const itemKey = (v: unknown): string => {
  if (!v || typeof v !== "object") return `${typeof v}:${String(v)}`;
  let id = ids.get(v);
  if (id === undefined) {
    id = nextId++;
    ids.set(v, id);
  }
  return `node:${String(id)}`;
};

/** Later items are added; one with the same key as an earlier one takes
 * its place. Without a key function, only exact repeats are skipped. */
function addTo(
  base: unknown,
  over: unknown[],
  key: (item: unknown) => string = itemKey,
): unknown[] {
  const out = Array.isArray(base) ? [...base] : base == null ? [] : [base];
  for (const item of over) {
    const k = key(item);
    const at = out.findIndex((x) => key(x) === k);
    if (at === -1) out.push(item);
    else out[at] = item;
  }
  return out;
}

/** environment and labels, as a mapping: "KEY=value" (or "KEY" alone) in
 * a list, or KEY: value. */
function asPairs(v: unknown): Obj {
  const out: Obj = {};
  if (Array.isArray(v)) {
    for (const entry of v) {
      if (typeof entry !== "string") continue;
      const eq = entry.indexOf("=");
      if (eq === -1) put(out, entry, null);
      else put(out, entry.slice(0, eq), entry.slice(eq + 1));
    }
  } else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) put(out, k, x);
  }
  return out;
}

/** depends_on and networks, as a mapping: a list of names, or name: {…}. */
function asNames(v: unknown, empty: () => Obj): Obj {
  const out: Obj = {};
  if (Array.isArray(v)) {
    for (const name of v) if (typeof name === "string") put(out, name, empty());
  } else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) put(out, k, x ?? empty());
  }
  return out;
}

const portKey = (p: unknown) => {
  const port = parsePort(p);
  return port ? portId(port) : itemKey(p);
};

const volumeKey = (v: unknown) => mount(v)?.target ?? itemKey(v);

// A device: "host:container[:permissions]", or { source, target }.
const deviceKey = (d: unknown) => {
  if (typeof d === "string") {
    const [host, inside] = d.split(":");
    return inside || host || d;
  }
  return isObj(d) && typeof d["target"] === "string" ? d["target"] : itemKey(d);
};

const ONE_VALUE = new Set(["command", "entrypoint"]);

function mergeValue(base: unknown, over: unknown, path: string[]): unknown {
  spend();
  if (over === RESET) return undefined;
  if (over instanceof Override) return settle(over.value);
  if (over === null || over === undefined) return base;
  // What the service-level rules key on: services.<name>.<field>.
  const field = path[0] === "services" && path.length === 3 ? path[2] : null;
  const inHealthcheck =
    path[0] === "services" && path.length === 4 && path[2] === "healthcheck";
  if ((field && ONE_VALUE.has(field)) || (inHealthcheck && path[3] === "test"))
    return settle(over);
  switch (field) {
    case "environment":
    case "labels":
      return mergePairs(asPairs(base), asPairs(over));
    case "depends_on":
      return mergeMaps(
        asNames(base, () => ({ condition: "service_started" })),
        asNames(over, () => ({ condition: "service_started" })),
        path,
      );
    case "networks":
      return mergeMaps(
        asNames(base, () => ({})),
        asNames(over, () => ({})),
        path,
      );
    case "ports":
      if (Array.isArray(over)) return addTo(base, over.map(settle), portKey);
      break;
    case "volumes":
      if (Array.isArray(over)) return addTo(base, over.map(settle), volumeKey);
      break;
    case "devices":
      if (Array.isArray(over)) return addTo(base, over.map(settle), deviceKey);
      break;
    case "dns":
    case "env_file":
      return addTo(base, [over].flat().map(settle));
  }
  if (isObj(base) && isObj(over)) return mergeMaps(base, over, path);
  if (Array.isArray(base) && Array.isArray(over)) {
    const out = [...base];
    const seen = new Set(out.map(itemKey));
    for (const item of over.map(settle)) {
      if (item === undefined || seen.has(itemKey(item))) continue;
      seen.add(itemKey(item));
      out.push(item);
    }
    return out;
  }
  return settle(over);
}

function mergeMaps(base: Obj, over: Obj, path: string[]): Obj {
  const entries = new Map(Object.entries(base));
  for (const [k, v] of Object.entries(over)) {
    const merged = mergeValue(entries.get(k), v, [...path, k]);
    if (merged === undefined) entries.delete(k);
    else entries.set(k, merged);
  }
  const out: Obj = {};
  for (const [k, v] of entries) put(out, k, v);
  return out;
}

/** environment and labels, by name. Unlike other mappings, a name with no
 * value (a "KEY" alone in a list, or KEY: with nothing after it) replaces
 * the earlier value: the value then comes from the shell. KEY: !reset null
 * removes the name. */
function mergePairs(base: Obj, over: Obj): Obj {
  const entries = new Map(Object.entries(base));
  for (const [k, v] of Object.entries(over)) {
    spend();
    if (v === RESET) entries.delete(k);
    else entries.set(k, settle(v) ?? null);
  }
  const out: Obj = {};
  for (const [k, v] of entries) put(out, k, v);
  return out;
}

/** The documents merged in order, each later one over the ones before.
 * Throws TooComplex past the work budget. */
export function mergeDocuments(docs: unknown[]): unknown {
  spent = 0;
  settled = new WeakMap();
  let out: unknown = undefined;
  for (const doc of docs) {
    if (doc === null || doc === undefined) continue;
    out = out === undefined ? settle(doc) : mergeValue(out, doc, []);
  }
  return out;
}
