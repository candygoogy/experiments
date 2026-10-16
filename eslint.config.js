// @ts-check
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/dist/",
      "**/.wrangler/",
      "shared/fonts/",
      ".shots/",
      "test-results/",
      "playwright-report/",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
);
