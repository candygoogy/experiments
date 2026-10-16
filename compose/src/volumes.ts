// A service's volumes, from compose's short syntax ("./data:/data:ro") or
// long syntax ({ type, source, target, read_only }).
import type { Mount } from "./model.ts";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === "string"
    ? v
    : typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : null;

// Host paths start with /, ./, ../, ~, a variable and a path under it
// (${HOME}/data, $HOME/data, ${DIR:-./data}/x), or a drive letter.
// A variable alone could be a folder or a volume: whatever it's set to,
// unless its default says (${DATA_DIR:-./data} is a folder). Anything else
// before the colon is a named volume.
const HOST = /^(?:[/.~]|\$\{[^}]*\}[\\/]|\$[a-z_]\w*[\\/]|[a-z]:[\\/])/i;
const ONLY_VARIABLE = /^(?:\$\{[A-Za-z_]\w*(?:[:?+-][^}]*)?\}|\$[a-z_]\w*)$/i;
// The default of ${VAR:-default} or ${VAR-default}.
const FALLBACK = /^\$\{[A-Za-z_]\w*:?-([^}]*)\}$/;

/** A short volume's parts, split at the colons outside any ${...}, whose
 * default may hold colons of its own (${DIR:-C:/data}). */
function volumeParts(entry: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < entry.length; i++) {
    const c = entry[i];
    if (c === "$" && entry[i + 1] === "$") i++;
    else if (c === "$" && entry[i + 1] === "{") {
      depth++;
      i++;
    } else if (c === "}" && depth > 0) depth--;
    else if (c === ":" && depth === 0) {
      parts.push(entry.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(entry.slice(start));
  return parts;
}

function sourceKind(source: string): Mount["kind"] {
  if (ONLY_VARIABLE.test(source)) {
    const fallback = FALLBACK.exec(source)?.[1];
    return fallback && HOST.test(fallback) ? "bind" : "variable";
  }
  return HOST.test(source) ? "bind" : "volume";
}

function shortVolume(entry: string): Mount | null {
  // C:\games:/games: the drive letter's colon isn't a separator.
  const drive = /^[a-z]:[\\/]/i.test(entry);
  const parts = volumeParts(drive ? entry.slice(2) : entry);
  if (drive) parts[0] = entry.slice(0, 2) + (parts[0] ?? "");
  const [first, second, mode] = parts;
  if (!first) return null;
  if (second === undefined) {
    return { kind: "anonymous", source: null, target: first, readOnly: false };
  }
  const readOnly = (mode ?? "").split(",").includes("ro");
  return {
    kind: sourceKind(first),
    source: first,
    target: second,
    readOnly,
  };
}

function longVolume(o: Obj): Mount | null {
  const target = str(o["target"]);
  if (!target) return null;
  const source = str(o["source"]);
  const type = str(o["type"]);
  const readOnly = o["read_only"] === true;
  if (type === "tmpfs")
    return { kind: "tmpfs", source: null, target, readOnly };
  // A Windows named pipe (Docker's own, say) is a host mount too.
  if (type === "bind" || type === "npipe") {
    return { kind: "bind", source, target, readOnly };
  }
  if (!source) return { kind: "anonymous", source: null, target, readOnly };
  return { kind: "volume", source, target, readOnly };
}

export const mount = (v: unknown): Mount | null =>
  typeof v === "string" ? shortVolume(v) : isObj(v) ? longVolume(v) : null;
