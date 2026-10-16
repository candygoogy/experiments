// The notices for third-party code shipped in a page: every package from
// node_modules that the build put into any chunk (the lazy ones too), and
// the build's own helpers it copies in (Vite's preload helper, Rolldown's
// runtime), each with its licence text as the package ships it. Sorted by
// name and free of dates or paths, so every build writes the same file.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NODE_MODULES = fileURLToPath(
  new URL("../node_modules/", import.meta.url),
);
const MARK = "node_modules/";

/** The package a bundled module came from, as its folder and name. */
function packageOf(id: string): { dir: string; name: string } | null {
  const path = id.replace(/\\/g, "/");
  // The build's own helpers arrive as virtual modules: "\0vite/…".
  if (path.startsWith("\0")) {
    const name = /^\0(@[^/]+\/[^/]+|[^/]+)\//.exec(path)?.[1];
    if (!name) return null;
    const dir = join(NODE_MODULES, name);
    return existsSync(join(dir, "package.json")) ? { dir, name } : null;
  }
  const at = path.lastIndexOf(MARK);
  if (at === -1) return null; // our own code
  const rest = path.slice(at + MARK.length).split("/");
  const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  if (!name) return null;
  return { dir: path.slice(0, at + MARK.length) + name, name };
}

/** The package's licence text; a licence file that also carries the
 * licences of the package's own build-time dependencies (Vite's) is cut
 * at that point, since none of those is in the page. */
function licenceText(dir: string): string {
  const file = readdirSync(dir)
    .filter((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f))
    .sort()[0];
  if (!file) return "(The package ships no licence file.)";
  const text = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
  const cut = text.search(/^#+\s*Licen[cs]es? of bundled dependencies/im);
  return (cut === -1 ? text : text.slice(0, cut)).trim();
}

export function thirdPartyNotices(moduleIds: Iterable<string>): string {
  const packages = new Map<string, string>();
  for (const id of moduleIds) {
    const found = packageOf(id);
    if (found) packages.set(found.name, found.dir);
  }
  const head = [
    "Third-party code in this page",
    "",
    packages.size
      ? "This page includes code from the open-source packages below, each under its own licence."
      : "This page includes no third-party code.",
  ];
  const entries = [...packages]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, dir]) => {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as {
        version?: string;
        license?: string;
      };
      return [
        "-".repeat(72),
        `${name} ${pkg.version ?? ""} (${pkg.license ?? "licence not stated"})`,
        "",
        licenceText(dir),
      ].join("\n");
    });
  return `${[...head, ...entries.flatMap((e) => ["", e])].join("\n")}\n`;
}
