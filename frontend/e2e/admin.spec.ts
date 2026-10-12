import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { AUDIT, DASHBOARD, KEYS, REVIEWS } from "../src/test/admin-fixtures";
import { mockApi } from "./mock-api";

const PASSWORD = "correct horse battery staple";
const MINTED_KEY = "mra_e2eKEYe2eKEYe2eKEYe2eKEYe2eKEY";

/**
 * A stateful fake of /api/v1/admin (same origin): sign-in, keys that can be minted and revoked, an audit log that grows.
 * `signOuts` counts the DELETE /session calls it has answered.
 */
async function mockAdmin(page: Page, { signedIn = false } = {}) {
  let session = signedIn;
  const calls = { signOuts: 0 };
  const keys = KEYS.map((k) => ({ ...k }));
  const audit = AUDIT.items.map((a) => ({ ...a }));
  let nextId = 100;
  const log = (action: string, after: Record<string, unknown> | null = null) =>
    audit.unshift({ id: nextId++, created_at: new Date().toISOString(), actor_kind: "user", actor_label: "owner", action,
      target_type: "key", target_id: "k", before: null, after });
  await page.route("**/api/v1/admin/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1/admin", "");
    const method = req.method();
    const reply = (status: number, body?: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
    if (method !== "GET" && req.headers()["x-mra-admin"] !== "1") return reply(403, { detail: "the X-MRA-Admin: 1 header is required" });
    if (path === "/session" && method === "POST") {
      if (req.postDataJSON().password !== PASSWORD) return reply(401, { detail: "invalid username or password" });
      session = true;
      return reply(204);
    }
    if (!session) return reply(401, { detail: "sign in required" });
    if (path === "/session" && method === "DELETE") { session = false; calls.signOuts += 1; return reply(204); }
    if (path === "/me") return reply(200, { kind: "user", label: "owner" });
    if (path === "/dashboard") return reply(200, DASHBOARD);
    if (path === "/reviews") return reply(200, REVIEWS);
    if (path === "/keys" && method === "GET") return reply(200, keys);
    if (path === "/keys" && method === "POST") {
      const body = req.postDataJSON();
      const key = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", key_prefix: MINTED_KEY.slice(0, 12), name: body.name,
        daily_quota: body.daily_quota, is_admin: body.is_admin, created_at: new Date().toISOString(), revoked_at: null, reviews_24h: 0 };
      keys.unshift(key);
      log("key.mint", { key_prefix: key.key_prefix, name: key.name });
      return reply(201, { ...key, key: MINTED_KEY });
    }
    const revoke = path.match(/^\/keys\/([^/]+)\/revoke$/);
    if (revoke && method === "POST") {
      const key = keys.find((k) => k.id === revoke[1])!;
      key.revoked_at = new Date().toISOString();
      log("key.revoke", { revoked: true });
      return reply(200, key);
    }
    if (path === "/audit") return reply(200, { items: audit, next: null });
    return reply(404, { detail: `no mock for ${method} ${path}` });
  });
  return calls;
}

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("sign in, mint and revoke a key, see both in the audit log, sign out", async ({ page }) => {
  await mockApi(page);
  const admin = await mockAdmin(page);
  await page.goto("/admin");
  await page.getByLabel("ชื่อผู้ใช้").fill("owner");
  await page.getByLabel("รหัสผ่าน").fill("wrong password");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");  // Next's route announcer is an alert too
  await page.getByLabel("รหัสผ่าน").fill(PASSWORD);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("รับรีวิวใหม่อยู่")).toBeVisible();

  await page.getByRole("navigation", { name: "ผู้ดูแลระบบ" }).getByRole("link", { name: "API keys" }).click();
  await page.getByLabel("ชื่อ key").fill("e2e lab");
  await page.getByRole("button", { name: "สร้าง key" }).click();
  await expect(page.getByText(MINTED_KEY)).toBeVisible();
  await page.getByRole("button", { name: "เก็บแล้ว ปิด" }).click();
  await expect(page.getByText(MINTED_KEY)).toHaveCount(0);
  const row = page.getByRole("row", { name: /e2e lab/ });
  await row.getByRole("button", { name: "เพิกถอน" }).click();
  await row.getByRole("button", { name: "ยืนยันเพิกถอน" }).click();
  await expect(page.getByRole("row", { name: /e2e lab/ })).toContainText("เพิกถอนแล้ว");

  await page.getByRole("navigation", { name: "ผู้ดูแลระบบ" }).getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("สร้าง API key")).toBeVisible();
  await expect(page.getByText("เพิกถอน API key")).toBeVisible();

  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "เข้าสู่ระบบผู้ดูแล" })).toBeVisible();
  // The sign-in page renders before its /me call returns, so those two checks alone would pass without an ended session.
  // Sign-out must have reached the API, and the console must now be closed.
  expect(admin.signOuts).toBe(1);
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "เข้าสู่ระบบผู้ดูแล" })).toBeVisible();
});

test("a signed-out visit to a console page goes to sign-in", async ({ page }) => {
  await mockApi(page);
  await mockAdmin(page);
  await page.goto("/admin/keys");
  await expect(page).toHaveURL(/\/admin$/);
});

async function checkLayoutAndA11y(page: Page) {
  await noHorizontalScroll(page);
  await noSeriousA11y(page);
}

/**
 * Each console page: text that proves its data has rendered (axe must not run against the loading line), and a step
 * that opens the states the page keeps hidden or tints (the table twin, the shown-once key panel, the confirm buttons).
 */
const CONSOLE_PAGES: { path: string; ready: string; open: (page: Page) => Promise<void> }[] = [
  { path: "/admin/dashboard", ready: "รับรีวิวใหม่อยู่", open: async (page) => {
    await page.getByText("ดูเป็นตาราง").click();
    await expect(page.getByRole("table", { name: /รีวิวและค่าใช้จ่ายรายวัน/ })).toBeVisible();
  } },
  { path: "/admin/reviews", ready: REVIEWS.items[1].topic, open: async (page) => {
    await page.getByRole("row", { name: new RegExp(REVIEWS.items[1].topic) }).getByRole("button", { name: "ลบ" }).click();
    await expect(page.getByRole("button", { name: "ยืนยันลบ" })).toBeVisible();
  } },
  { path: "/admin/keys", ready: KEYS[0].name, open: async (page) => {
    await page.getByLabel("ชื่อ key").fill("axe lab");
    await page.getByRole("button", { name: "สร้าง key" }).click();
    await expect(page.getByRole("group", { name: /แสดงครั้งเดียว/ })).toBeVisible();
    await page.getByRole("row", { name: new RegExp(KEYS[0].name) }).getByRole("button", { name: "เพิกถอน" }).click();
    await expect(page.getByRole("button", { name: "ยืนยันเพิกถอน" })).toBeVisible();
  } },
  { path: "/admin/audit", ready: "แก้ไข API key", open: async () => {} },
];

async function setUp(page: Page, width: number, scheme: "light" | "dark") {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await mockApi(page);
}

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`admin pages at ${width}px (${scheme}): no sideways scroll, axe-clean, noindex`, async ({ page }) => {
      await setUp(page, width, scheme);
      await mockAdmin(page, { signedIn: true });
      for (const { path, ready, open } of CONSOLE_PAGES) {
        await page.goto(path);
        await expect(page.getByRole("navigation", { name: "ผู้ดูแลระบบ" })).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByRole("main").getByText(ready).first()).toBeVisible();
        await checkLayoutAndA11y(page);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
        await open(page);
        await checkLayoutAndA11y(page);
      }
    });

    test(`admin sign-in at ${width}px (${scheme}): no sideways scroll, axe-clean with its error, noindex`, async ({ page }) => {
      await setUp(page, width, scheme);
      await mockAdmin(page);
      await page.goto("/admin");
      await expect(page.getByRole("heading", { level: 1, name: "เข้าสู่ระบบผู้ดูแล" })).toBeVisible();
      await checkLayoutAndA11y(page);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await page.getByLabel("ชื่อผู้ใช้").fill("owner");
      await page.getByLabel("รหัสผ่าน").fill("wrong password");
      await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      await checkLayoutAndA11y(page);
    });
  }
}
