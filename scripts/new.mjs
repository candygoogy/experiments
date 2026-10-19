// Starts a new experiment from template/:
//   node scripts/new.mjs <name> <port>
// copies template/ to <name>/, fills in its placeholders (the package, the
// Worker, the title, the ports: Vite on <port>, Wrangler on <port> + 10;
// the tab then reads "<Title> – candygoogy", from shared/shell.ts),
// adds it to the workspaces and installs. The reverse:
//   node scripts/new.mjs --remove <name>
// deletes <name>/ and takes it out of the workspaces again.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TEMPLATE = join(ROOT, "template");
const SKIP = new Set(["node_modules", "dist", ".wrangler", "test-results"]);
const KEEP = new Set(["shared", "template"]);

const fail = (message) => {
  console.error(`new: ${message}`);
  process.exit(1);
};

const pkgFile = join(ROOT, "package.json");
const readPkg = async () => JSON.parse(await readFile(pkgFile, "utf8"));
const writePkg = (pkg) =>
  writeFile(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

const install = () => {
  // One fixed command through the shell (npm is a .cmd file on Windows).
  const r = spawnSync("npm install --no-audit --no-fund", {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) fail("npm install failed");
};

const [first, second] = process.argv.slice(2);

if (first === "--remove") {
  const name = second ?? "";
  const pkg = await readPkg();
  // Only an experiment: a workspace, never shared/ or template/ (and so
  // never scripts/, node_modules/ or anything else at the root).
  if (!pkg.workspaces.includes(name) || KEEP.has(name)) {
    fail(`can't remove "${name}": not an experiment`);
  }
  await rm(join(ROOT, name), { recursive: true, force: true });
  pkg.workspaces = pkg.workspaces.filter((w) => w !== name);
  await writePkg(pkg);
  install();
  console.log(`new: removed ${name}/`);
  process.exit(0);
}

const name = first ?? "";
const port = Number(second);
if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  fail("usage: node scripts/new.mjs <name> <port> (name: a-z, 0-9, -)");
}
if (!Number.isInteger(port) || port < 1024 || port > 65525) {
  fail("the port must be a whole number from 1024 to 65525");
}
if (existsSync(join(ROOT, name))) fail(`${name}/ already exists`);

const title = name
  .split("-")
  .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
  .join(" ");
// The template's placeholders, file by file, written out in full so that
// nothing else is touched (a <template> element, the word in a comment, a
// number that happens to match a port). Each must be found: if one isn't,
// the template has changed and this list needs to follow it.
const PLACES = {
  "package.json": [
    ['"name": "@exp/template"', `"name": "@exp/${name}"`],
    ["--port 4420 ", `--port ${port + 10} `],
  ],
  "wrangler.jsonc": [['"name": "exp-template"', `"name": "exp-${name}"`]],
  "vite.config.ts": [
    ['name: "template"', `name: "${name}"`],
    ['title: "Template"', `title: "${title}"`],
    ["port: 4410,", `port: ${port},`],
  ],
  "index.html": [["<h1>Template</h1>", `<h1>${title}</h1>`]],
  "test/basics.spec.ts": [
    ["const PORT = 4420;", `const PORT = ${port + 10};`],
    ['serve("template", PORT)', `serve("${name}", PORT)`],
  ],
};
// The template's spec also checks the shared page, once for every tool;
// a new tool's copy stops where those checks start.
const SHARED_CHECKS = "\n// The shared page (shared/):";

await cp(TEMPLATE, join(ROOT, name), {
  recursive: true,
  filter: (src) => !SKIP.has(src.split(/[\\/]/).at(-1)),
});
for (const [path, swaps] of Object.entries(PLACES)) {
  const file = join(ROOT, name, path);
  let text = await readFile(file, "utf8");
  for (const [from, to] of swaps) {
    if (!text.includes(from)) fail(`template/${path} has no ${from}`);
    text = text.replaceAll(from, to);
  }
  if (path === "test/basics.spec.ts") {
    const cut = text.indexOf(SHARED_CHECKS);
    if (cut === -1) fail(`template/${path} has no shared checks to leave out`);
    text = text.slice(0, cut);
  }
  await writeFile(file, text);
}

const pkg = await readPkg();
if (!pkg.workspaces.includes(name)) pkg.workspaces.push(name);
await writePkg(pkg);
install();
console.log(
  `new: ${name}/ is ready. npm run dev -w @exp/${name} (port ${port}), ` +
    `npm run preview -w @exp/${name} (port ${port + 10}).`,
);
