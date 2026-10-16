import { test } from "@playwright/test";
import { checkBasics, serve } from "../../shared/test/e2e";

const PORT = 4420;
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  stop = await serve("template", PORT);
});

test.afterAll(async () => {
  await stop?.();
});

test("meets the shared basics", async ({ page }) => {
  await checkBasics(page, `http://127.0.0.1:${PORT}/`);
});
