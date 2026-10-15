import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { LlmConfigDoc, LlmConfigState, LlmKeysState, LlmVersion, ProviderKeyRow, ValidateReport } from "../src/lib/admin-types";
import { CONFIG, STATE, VERSIONS } from "../src/test/admin-model-fixtures";
import { mockApi } from "./mock-api";

/**
 * Plan 23e: the "ผู้ให้บริการและคีย์" tab of /admin/models against a stateful fake of /api/v1/admin (same origin). The
 * fake keeps versions and stored keys; it answers a key only with its last 4 characters, as the real API does. A
 * request it does not know is answered 404 and listed in `calls.unmocked`, which each test expects to stay empty. No
 * provider and no network is ever reached.
 */
const KEY = "sk-test-0000000000000000abcd";
const NEW_KEY = "sk-test-1111111111111111efgh";
interface Stored { last4: string; origin: string; at: string }
interface Calls { puts: { name: string; body: unknown; csrf: string | undefined }[]; deletes: string[]; saves: LlmConfigDoc[]; unmocked: string[] }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const LEGACY_KEYS: Record<string, string> = { openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai_compatible: "OPENAI_COMPATIBLE_API_KEY" };
const ok = (config: LlmConfigDoc): ValidateReport => ({ ok: true, errors: [], warnings: [], cost: {}, config, yaml: `${JSON.stringify(config)}\n`, role_errors: [] });

function originOf(name: string, spec: Record<string, unknown>): string {
  const base = typeof spec.base_url === "string" ? spec.base_url : name === "anthropic" ? "https://api.anthropic.com" : "https://openrouter.ai";
  return new URL(base).origin;
}

async function mockProviders(page: Page, { writable = true } = {}) {
  const calls: Calls = { puts: [], deletes: [], saves: [], unmocked: [] };
  const versions: (LlmVersion & { config: LlmConfigDoc })[] = [{ ...clone(VERSIONS.items[0]), config: clone(CONFIG) }];
  const keys = new Map<string, Stored>();
  let revision = 0;
  const config = () => versions[0].config;
  const keyRow = (name: string, spec: Record<string, unknown>): ProviderKeyRow => {
    const stored = keys.get(name);
    const origin = originOf(name, spec);
    const kind = (typeof spec.kind === "string" ? spec.kind : name) as ProviderKeyRow["kind"];
    const used = Object.entries(config().presets[config().active_preset])
      .filter(([, r]) => (r.provider ?? config().default_provider ?? "openrouter") === name).map(([role]) => role);
    const env = LEGACY_KEYS[name] ?? `LLM_KEY_${name.toUpperCase()}`;
    return {
      name, kind, origin, used_by: used, keyless: false, key_allowed: true,
      key: stored
        ? { source: "console", problem: null, last4: stored.last4, bound_origin: stored.origin, updated_at: stored.at, updated_by: "owner" }
        : { source: name === "openrouter" ? "env" : "none", problem: null, last4: null, bound_origin: null, updated_at: null, updated_by: null },
      env: { name: env, set: name === "openrouter", origin_ok: name === "openrouter" },
    };
  };
  const keysState = (): LlmKeysState => ({
    writable, reason: writable ? null : "no_secret", keys_version: revision || null, config_version: versions[0].id, config_error: null,
    providers: Object.entries(config().providers).map(([n, s]) => keyRow(n, s)), orphans: [],
    loaded: [{ worker: "worker-1:7", version: String(versions[0].id), preset: "cheap", loaded_at: new Date().toISOString(), error: null,
      keys: "none" }], // this fake worker never catches up: the page says so
  });
  const configState = (): LlmConfigState => ({
    ...clone(STATE), version: versions[0].id, config: clone(config()),
    key_status: Object.fromEntries(Object.keys(config().providers).map((n) => [n, keys.has(n) ? "console" : n === "openrouter" ? "env" : "none"])),
    known_prices: { "claude-haiku-4-5": [1, 5] },
    loaded: [{ ...STATE.loaded[0], version: String(versions[0].id), loaded_at: new Date().toISOString() }],
  });

  await page.route("**/api/v1/admin/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1/admin", "");
    const method = req.method();
    const reply = (status: number, body?: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
    if (method !== "GET" && req.headers()["x-mra-admin"] !== "1") return reply(403, { detail: "the X-MRA-Admin: 1 header is required" });
    if (path === "/me") return reply(200, { kind: "user", label: "owner" });
    if (path === "/llm-config" && method === "GET") return reply(200, configState());
    if (path === "/llm-config/versions" && method === "GET") {
      return reply(200, { items: versions.map(({ config: _c, ...v }) => v), next: null }); // eslint-disable-line @typescript-eslint/no-unused-vars
    }
    if (path === "/llm-config/validate" && method === "POST") return reply(200, ok((req.postDataJSON() as { config: LlmConfigDoc }).config));
    if (path === "/llm-config" && method === "POST") {
      const body = req.postDataJSON() as { config: LlmConfigDoc; base_version: number };
      calls.saves.push(body.config);
      const id = versions[0].id + 1;
      versions.unshift({ ...clone(VERSIONS.items[0]), id, created_at: new Date().toISOString(), config: clone(body.config), changes: {} });
      return reply(201, { ...versions[0], config: undefined, workers_notified: true });
    }
    if (path === "/llm-keys" && method === "GET") return reply(200, keysState());
    const named = path.match(/^\/llm-keys\/([a-z][a-z0-9_]*)$/);
    if (named && method === "PUT") {
      const body = req.postDataJSON() as { key: string };
      calls.puts.push({ name: named[1], body, csrf: req.headers()["x-mra-admin"] });
      const spec = config().providers[named[1]];
      if (!spec) return reply(404, { detail: `provider ${named[1]} is not configured` });
      if (!writable) return reply(409, { detail: "LLM_KEYS_SECRET is not set on the server", code: "no_secret" });
      revision += 1;
      const key = body.key.trim();
      keys.set(named[1], { last4: key.slice(-4), origin: originOf(named[1], spec), at: new Date().toISOString() });
      return reply(200, { ...keysState(), workers_notified: true });
    }
    if (named && method === "DELETE") {
      calls.deletes.push(named[1]);
      if (!keys.delete(named[1])) return reply(404, { detail: "no stored key" });
      revision += 1;
      return reply(200, { ...keysState(), workers_notified: true });
    }
    if (path === "/llm-models/test" && method === "POST") return reply(200, { ok: true, latency_ms: 420, cost_usd: 0.0001, model: "m", error: null });
    calls.unmocked.push(`${method} ${path}`);
    return reply(404, { detail: `no mock for ${method} ${path}` });
  });
  return calls;
}

const tab = (page: Page, name: string) => page.getByRole("group", { name: "ส่วนของหน้า" }).getByRole("button", { name, exact: true });
const providerItem = (page: Page, name: string) =>
  page.getByRole("list", { name: "ผู้ให้บริการ" }).getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });

async function openProviders(page: Page) {
  await page.goto("/admin/models");
  await expect(page.getByRole("heading", { level: 1, name: "โมเดล" })).toBeVisible();
  await tab(page, "ผู้ให้บริการและคีย์").click();
  await expect(providerItem(page, "openrouter")).toContainText("ใช้ค่าจาก .env");
}

async function audit(page: Page, label: string) {
  await test.step(label, async () => {
    await page.evaluate(() => document.fonts.ready);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`), `${label}: serious or critical axe violations`).toEqual([]);
  });
}

test("add DeepSeek from a template, save it, then set, replace and delete its key", async ({ page }) => {
  await mockApi(page);
  const calls = await mockProviders(page);
  await openProviders(page);

  await page.getByLabel("แม่แบบ").selectOption("deepseek");
  await expect(page.getByLabel("base URL")).toHaveValue("https://api.deepseek.com/v1");
  await page.getByRole("button", { name: "เพิ่มลงร่าง" }).click();
  await expect(providerItem(page, "deepseek")).toContainText("บันทึกเวอร์ชันก่อนจึงใส่คีย์ได้");
  await page.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" }).click();
  await expect(page.getByText("ใช้เวอร์ชัน 4 จาก DB")).toBeVisible();
  expect(calls.saves[0].providers.deepseek).toEqual({ kind: "openai_compatible", base_url: "https://api.deepseek.com/v1", require_parameters: false });
  const deepseek = providerItem(page, "deepseek");
  await expect(deepseek).toContainText("ยังไม่มีคีย์");

  await deepseek.getByRole("button", { name: "ใส่คีย์ของ deepseek" }).click();
  await page.getByLabel("คีย์ของ deepseek").fill(KEY);
  await page.getByRole("button", { name: "บันทึกคีย์" }).click();
  await expect(deepseek).toContainText("ตั้งจากหน้านี้ ••••abcd");
  await deepseek.getByRole("button", { name: "เปลี่ยนคีย์ของ deepseek" }).click();
  await expect(page.getByLabel("คีย์ของ deepseek")).toHaveValue(""); // never filled back in
  await page.getByLabel("คีย์ของ deepseek").fill(NEW_KEY);
  await page.getByRole("button", { name: "บันทึกคีย์" }).click();
  await expect(deepseek).toContainText("ตั้งจากหน้านี้ ••••efgh");
  await expect(page.getByRole("list", { name: "worker" }).last()).toContainText("ยังใช้คีย์ชุดเดิม"); // the fake worker is on revision 0
  await deepseek.getByRole("button", { name: "ลบคีย์ของ deepseek" }).click();
  await page.getByRole("button", { name: "ยืนยันลบคีย์" }).click();
  await expect(deepseek).toContainText("ยังไม่มีคีย์");

  expect(calls.puts.map((p) => [p.name, p.body, p.csrf])).toEqual([["deepseek", { key: KEY }, "1"], ["deepseek", { key: NEW_KEY }, "1"]]);
  expect(calls.deletes).toEqual(["deepseek"]);
  const html = await page.content();
  expect(html).not.toContain(KEY);
  expect(html).not.toContain(NEW_KEY);
  expect(calls.unmocked).toEqual([]);
});

test("a role on DeepSeek gets a provider dropdown and price fields in the presets tab", async ({ page }) => {
  await mockApi(page);
  const calls = await mockProviders(page);
  await page.goto("/admin/models");
  await tab(page, "ผู้ให้บริการและคีย์").click();
  await page.getByLabel("แม่แบบ").selectOption("deepseek");
  await page.getByRole("button", { name: "เพิ่มลงร่าง" }).click();
  await tab(page, "Presets").click();
  await page.getByLabel("provider ของ extractor").selectOption("deepseek");
  await expect(page.getByText("ต้องใส่ราคา input และ output (USD ต่อ 1M token)")).toBeVisible();
  await page.getByLabel("ราคา input ของ extractor (USD ต่อ 1M token)").fill("0.27");
  await page.getByLabel("ราคา output ของ extractor (USD ต่อ 1M token)").fill("1.1");
  await expect(page.getByText("ต้องใส่ราคา")).toHaveCount(0);
  await page.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" }).click();
  await expect(page.getByText("ใช้เวอร์ชัน 4 จาก DB")).toBeVisible();
  expect(calls.saves[0].presets.cheap.extractor).toMatchObject({ provider: "deepseek", price_in: 0.27, price_out: 1.1 });
  expect(calls.unmocked).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`providers tab at ${width}px (${scheme}): at rest, key form, a stored key, read-only — no sideways scroll, axe-clean`, async ({ page }) => {
      test.slow();
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await mockApi(page);
      const calls = await mockProviders(page);
      const at = (what: string) => `${what} · ${width}px ${scheme}`;
      await openProviders(page);
      await audit(page, at("at rest"));
      const openrouter = providerItem(page, "openrouter");
      await openrouter.getByRole("button", { name: "ใส่คีย์ของ openrouter" }).click();
      await audit(page, at("key form open"));
      await page.getByLabel("คีย์ของ openrouter").fill(KEY);
      await page.getByRole("button", { name: "บันทึกคีย์" }).click();
      await expect(openrouter).toContainText("ตั้งจากหน้านี้ ••••abcd");
      await openrouter.getByRole("button", { name: "ลบคีย์ของ openrouter" }).click();
      await audit(page, at("a stored key, delete asking to be confirmed"));
      await page.getByLabel("แม่แบบ").selectOption("ollama");
      await page.getByRole("button", { name: "เพิ่มลงร่าง" }).click();
      await expect(providerItem(page, "ollama")).toContainText("บันทึกเวอร์ชันก่อนจึงใส่คีย์ได้");
      await audit(page, at("a provider only in the draft"));
      expect(calls.unmocked).toEqual([]);
    });
  }
  test(`providers tab read-only without LLM_KEYS_SECRET (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await mockApi(page);
    await mockProviders(page, { writable: false });
    await openProviders(page);
    await expect(page.getByText("ยังใส่หรือเปลี่ยนคีย์จากหน้านี้ไม่ได้: เซิร์ฟเวอร์ไม่มี LLM_KEYS_SECRET")).toBeVisible();
    await expect(page.getByRole("button", { name: /ใส่คีย์ของ/ })).toHaveCount(0);
    await audit(page, `read-only · ${scheme}`);
  });
}
