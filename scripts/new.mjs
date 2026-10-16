// Starts a new experiment from template/:
//   node scripts/new.mjs <name> <port>
// copies template/ to <name>/, renames it everywhere (the package, the
// Worker, the title, the ports: Vite on <port>, Wrangler on <port> + 10;
// the tab then reads "<Title> – candygoogy", from shared/shell.ts),
// adds it to the workspaces and installs. The reverse:
//   node scripts/new.mjs --remove <name>
// deletes <name>/ and takes it out of the workspaces again.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  if (!/^[a-z][a-z0-9-]*$/.test(name) || KEEP.has(name)) {
    fail(`can't remove "${name}"`);
  }
  await rm(join(ROOT, name), { recursive: true, force: true });
  const pkg = await readPkg();
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
const rename = (text) =>
  text
    .replaceAll("template", name)
    .replaceAll("Template", title)
    .replaceAll("4420", String(port + 10))
    .replaceAll("4410", String(port));

await cp(TEMPLATE, join(ROOT, name), {
  recursive: true,
  filter: (src) => !SKIP.has(src.split(/[\\/]/).at(-1)),
});
for (const entry of await readdir(join(ROOT, name), {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile()) continue;
  const file = join(entry.parentPath, entry.name);
  const text = await readFile(file, "utf8");
  const renamed = rename(text);
  if (renamed !== text) await writeFile(file, renamed);
}

const pkg = await readPkg();
if (!pkg.workspaces.includes(name)) pkg.workspaces.push(name);
await writePkg(pkg);
install();
console.log(
  `new: ${name}/ is ready. npm run dev -w @exp/${name} (port ${port}), ` +
    `npm run preview -w @exp/${name} (port ${port + 10}).`,
);
