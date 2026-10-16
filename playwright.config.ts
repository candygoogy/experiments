import { defineConfig, devices } from "@playwright/test";

// Browser checks: each experiment's test/*.spec.ts serves its own dist/
// with Wrangler on its own port, so the files can run side by side.
//
// Except the main-thread budgets ("no task over 200 ms", tagged @perf):
// they time the machine as much as the page, and with six other files'
// browsers and Wranglers busy alongside, a task that takes 150 ms alone
// can take 250. So they run after everything else, one at a time, with
// the same budget. (If an earlier check fails, Playwright skips them:
// fix that first.)
//
// On CI they don't run at all. Shared runners are slower than a desktop
// and their speed varies from run to run, so a 200 ms budget there
// measures the runner, not the page, and would fail for no change in the
// code. Run them locally, where the budget means something.
const onCi = !!process.env["CI"];

export default defineConfig({
  testMatch: "*/test/**/*.spec.ts",
  timeout: 120_000,
  forbidOnly: onCi,
  reporter: onCi ? "github" : "list",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@perf/,
    },
    ...(onCi
      ? []
      : [
          {
            name: "perf",
            use: { ...devices["Desktop Chrome"] },
            grep: /@perf/,
            dependencies: ["chromium"],
            workers: 1,
          },
        ]),
  ],
});
