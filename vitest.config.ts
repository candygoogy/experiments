import { defineConfig } from "vitest/config";

// Unit tests only; the browser checks (*.spec.ts) run under Playwright.
export default defineConfig({
  test: {
    include: ["*/test/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
