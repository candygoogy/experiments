import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FONTS_DIR, PACKAGES } from "../scripts/fonts.mjs";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "fonts.mjs");
const run = (env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
const sha256 = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

describe("fonts", () => {
  test("downloads both fonts with the pinned hashes", () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    for (const pkg of PACKAGES) {
      for (const [file, expected] of Object.entries(pkg.files)) {
        expect(sha256(join(FONTS_DIR, file))).toBe(expected);
      }
    }
    expect(PACKAGES.flatMap((p) => Object.keys(p.files))).toEqual([
      "CabinetGrotesk-Variable.woff2",
      "Satoshi-Variable.woff2",
    ]);
  });

  test("fails without network", () => {
    const out = mkdtempSync(join(tmpdir(), "exp-fonts-"));
    try {
      // Node's fetch only uses the proxy variables with NODE_USE_ENV_PROXY.
      const result = run({
        FONTS_OUT: out,
        HTTPS_PROXY: "http://127.0.0.1:9",
        NODE_USE_ENV_PROXY: "1",
      });
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
