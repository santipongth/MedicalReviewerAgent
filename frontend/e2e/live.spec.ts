import { expect, test } from "@playwright/test";

// Against the running docker stack (web :3000 → api :8000, GRAPH_MODE=stub is enough):
//   MRA_LIVE_WEB=1 npx playwright test e2e/live.spec.ts
test.skip(!process.env.MRA_LIVE_WEB, "set MRA_LIVE_WEB=1 with docker compose up");
test.use({ baseURL: process.env.MRA_WEB_URL ?? "http://localhost:3000" });

test("submit from the real web container and reach a finished review", async ({ page }) => {
  await page.goto("/");
  const topic = `live web check ${Date.now()}`;
  await page.getByLabel(/หัวข้อ/).fill(topic);
  await page.getByRole("button", { name: "ส่งให้เอเจนต์ทบทวน" }).click();
  await expect(page).toHaveURL(/\/r\/[0-9a-f-]{36}$/);
  await expect(page.getByText(topic).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/การทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติ|Stub review/).first()).toBeVisible({ timeout: 60_000 });
});
