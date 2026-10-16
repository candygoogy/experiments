import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const outs: string[] = [];

/** Builds an experiment into a temporary folder and returns its notices. */
async function notices(name: string): Promise<string> {
  const out = mkdtempSync(join(tmpdir(), `exp-lic-${name}-`));
  outs.push(out);
  const root = join(ROOT, name);
  await build({
    root,
    configFile: join(root, "vite.config.ts"),
    logLevel: "silent",
    build: { outDir: out, emptyOutDir: true },
  });
  return readFileSync(join(out, "third-party-licenses.txt"), "utf8");
}

afterAll(() => {
  for (const out of outs) rmSync(out, { recursive: true, force: true });
});

describe("third-party-licenses.txt", () => {
  test("photo names every bundled package with its licence text", async () => {
    const text = await notices("photo");
    expect(text).toContain("exifr 7.1.3 (MIT)");
    expect(text).toContain("Copyright (c) 2020 Mike Kovařík, Mutiny.cz");
    expect(text).toContain("fflate 0.8.3 (MIT)");
    expect(text).toContain("Copyright (c) 2026 Arjun Barrett");
    // The build's own helpers copied into the page.
    expect(text).toContain("vite 8.3.4 (MIT)");
    expect(text).toContain("rolldown ");
    // Vite's notice, without the licences of its own build-time
    // dependencies, none of which is in the page.
    expect(text).not.toContain("Licenses of bundled dependencies");
    expect(text).toMatch(/Permission is hereby granted/);
  });

  test("battery bundles only the build's own loader", async () => {
    // Vite's helper that loads the example's module after the page draws.
    const text = await notices("battery");
    expect(text).toContain("vite 8.3.4 (MIT)");
    expect(text).not.toContain("exifr");
    expect(text).not.toContain("fflate");
  });

  test("the file is the same on every build", async () => {
    expect(await notices("photo")).toBe(await notices("photo"));
  });
});
