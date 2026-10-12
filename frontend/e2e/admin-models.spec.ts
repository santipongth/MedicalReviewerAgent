import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type { CatalogModel, LlmConfigDoc, LlmConfigState, LlmVersion, ProbeResult, ValidateReport } from "../src/lib/admin-types";
import { DASHBOARD } from "../src/test/admin-fixtures";
import { CONFIG, STATE, VERSIONS } from "../src/test/admin-model-fixtures";
import { mockApi } from "./mock-api";

/**
 * The admin "โมเดล" page against a stateful fake of /api/v1/admin (same origin): versions that grow with every save and
 * restore, a catalog, and a test call. Every admin route is answered here with `page.route`; a request the fake does not
 * know is answered 404 and listed in `calls.unmocked`, which each test expects to stay empty. The test call
 * (`POST /llm-models/test`) is one of those fake routes, so no provider and no network is ever reached.
 */
interface SaveBody { base_version: number | null; note?: string; config: LlmConfigDoc }
interface Recorded<B> { body: B; status: number; headers: Record<string, string> }
interface Calls {
  saves: Recorded<SaveBody>[];
  restores: (Recorded<{ base_version: number | null; note?: string }> & { id: number })[];
  validates: { config?: LlmConfigDoc; yaml?: string }[];
  tests: Recorded<{ config: LlmConfigDoc; preset: string; role: string }>[];
  catalogQueries: string[];
  unmocked: string[];
}

/** What one call of a model costs, per role (USD). A model that is not listed is "not found on OpenRouter". */
const PRICE: Record<string, number> = {
  "vendor/cheap": 0.002, "vendor/better": 0.01, "vendor/big": 0.05, "qwen/qwen3-8b": 0.001, "qwen/qwen3-30b-a3b": 0.003,
};
const CATALOG: CatalogModel[] = [
  { id: "qwen/qwen3-8b", context_length: 32768, price_in_per_m: 0.035, price_out_per_m: 0.138, structured: true, tools: true, reasoning: false },
  { id: "qwen/qwen3-30b-a3b", context_length: 131072, price_in_per_m: 0.08, price_out_per_m: 0.29, structured: true, tools: true, reasoning: true },
  { id: "vendor/better", context_length: 200000, price_in_per_m: 0.6, price_out_per_m: 2.4, structured: true, tools: true, reasoning: true },
  { id: "vendor/big", context_length: null, price_in_per_m: 5, price_out_per_m: 25, structured: true, tools: false, reasoning: true },
];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** JSON is YAML, so the fake can hand out and read back "YAML" without a YAML library in the browser tests. */
const asYaml = (config: LlmConfigDoc) => `${JSON.stringify(config, null, 2)}\n`;

/** What a save changed (the shape of summarize_change in backend/app/services/llm_store.py, limited to what these tests touch). */
function summarize(old: LlmConfigDoc, next: LlmConfigDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (old.active_preset !== next.active_preset) out.active_preset = `${old.active_preset} → ${next.active_preset}`;
  const roles: Record<string, string> = {};
  for (const [preset, specs] of Object.entries(next.presets)) {
    for (const [role, spec] of Object.entries(specs)) {
      const was = old.presets[preset]?.[role]?.model;
      if (was !== spec.model) roles[`${preset}.${role}`] = `${was ?? "—"} → ${spec.model}`;
    }
  }
  if (Object.keys(roles).length > 0) out.roles = roles;
  return out;
}

function check(config: LlmConfigDoc): ValidateReport {
  if (!config.presets[config.active_preset]) {
    return { ok: false, errors: [`active_preset: ${config.active_preset} is not a preset`], warnings: [], cost: {}, config: null, yaml: null };
  }
  const warnings: string[] = [];
  const cost: ValidateReport["cost"] = {};
  for (const [preset, roles] of Object.entries(config.presets)) {
    const perRole: Record<string, number> = {};
    const unknown: string[] = [];
    for (const [role, spec] of Object.entries(roles)) {
      const price = PRICE[spec.model];
      if (price === undefined) {
        unknown.push(`${role}: openrouter:${spec.model}`);
        warnings.push(`${preset}.${role}: ${spec.model} not found on OpenRouter`);
      } else {
        perRole[role] = price;
      }
      if (spec.model === "vendor/big") warnings.push(`${preset}.${role}: vendor/big is the most expensive model in the catalog`);
    }
    const total = Object.values(perRole).reduce((a, b) => a + b, 0);
    cost[preset] = { total_usd: Math.round(total * 1e6) / 1e6, per_role: perRole, unknown_models: unknown };
  }
  return { ok: true, errors: [], warnings, cost, config, yaml: asYaml(config) };
}

interface Stored extends LlmVersion { config: LlmConfigDoc }

/**
 * `alerts` fills the header with everything it can warn about: a key that is not set, a LLM_PRESET that has no effect,
 * and a second worker that is on another version and reports an error.
 */
async function mockModels(page: Page, { signedIn = true, alerts = false } = {}) {
  const calls: Calls = { saves: [], restores: [], validates: [], tests: [], catalogQueries: [], unmocked: [] };
  // newest first, like the history; the first one is the active version
  const versions: Stored[] = [
    { ...clone(VERSIONS.items[0]), config: clone(CONFIG) },
    { ...clone(VERSIONS.items[1]), config: { ...clone(CONFIG), active_preset: "better" } },
  ];
  const append = (config: LlmConfigDoc, by: string, source: LlmVersion["source"], note: string | null, restoredFrom: number | null) => {
    const row: Stored = { id: versions[0].id + 1, created_at: new Date().toISOString(), created_by: by, note, source, restored_from: restoredFrom,
      active_preset: config.active_preset, changes: summarize(versions[0].config, config), config: clone(config) };
    versions.unshift(row);
    return row;
  };
  const strip = ({ config: _config, ...row }: Stored): LlmVersion => row; // eslint-disable-line @typescript-eslint/no-unused-vars
  const state = (): LlmConfigState => {
    const now = new Date().toISOString();
    const active = versions[0];
    return {
      ...clone(STATE), version: active.id, config: clone(active.config), active_preset: active.config.active_preset,
      env_preset: alerts ? "better" : null, keys_present: { OPENROUTER_API_KEY: !alerts },
      loaded: [
        { ...STATE.loaded[0], version: String(active.id), preset: active.config.active_preset, loaded_at: now },
        ...(alerts ? [{ worker: "worker-2:9", version: "2", preset: "better", loaded_at: now, error: "ConfigError: preset better has no guard" }] : []),
      ],
    };
  };

  await page.route("**/api/v1/admin/**", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/v1/admin", "");
    const method = req.method();
    const headers = req.headers();
    const reply = (status: number, body?: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
    if (method !== "GET" && headers["x-mra-admin"] !== "1") return reply(403, { detail: "the X-MRA-Admin: 1 header is required" });
    if (!signedIn) return reply(401, { detail: "sign in required" });
    if (path === "/me") return reply(200, { kind: "user", label: "owner" });
    if (path === "/dashboard") return reply(200, DASHBOARD);
    if (path === "/llm-config" && method === "GET") return reply(200, state());
    if (path === "/llm-config/versions" && method === "GET") return reply(200, { items: versions.map(strip), next: null });
    if (path === "/llm-config/validate" && method === "POST") {
      const body = req.postDataJSON() as { config?: LlmConfigDoc; yaml?: string };
      calls.validates.push(body);
      if (body.config) return reply(200, check(body.config));
      try {
        return reply(200, check(JSON.parse(body.yaml ?? "") as LlmConfigDoc));
      } catch (e) {
        return reply(200, { ok: false, errors: [`YAML: ${(e as Error).message}`], warnings: [], cost: {}, config: null, yaml: null });
      }
    }
    if (path === "/llm-config" && method === "POST") {
      const body = req.postDataJSON() as SaveBody;
      const active = versions[0];
      if (body.base_version !== active.id) {
        calls.saves.push({ body, status: 409, headers });
        return reply(409, { detail: `version ${active.id} is in use now; reload the latest version and try again` });
      }
      if (!check(body.config).ok) {
        calls.saves.push({ body, status: 422, headers });
        return reply(422, { detail: "the active preset does not exist" });
      }
      calls.saves.push({ body, status: 201, headers });
      return reply(201, { ...strip(append(body.config, "owner", "edit", body.note ?? null, null)), workers_notified: true });
    }
    const restore = path.match(/^\/llm-config\/versions\/(\d+)\/restore$/);
    if (restore && method === "POST") {
      const id = Number(restore[1]);
      const body = req.postDataJSON() as { base_version: number | null; note?: string };
      const target = versions.find((v) => v.id === id);
      if (!target) return reply(404, { detail: "version not found" });
      if (body.base_version !== versions[0].id) {
        calls.restores.push({ id, body, status: 409, headers });
        return reply(409, { detail: `version ${versions[0].id} is in use now; reload the latest version and try again` });
      }
      calls.restores.push({ id, body, status: 201, headers });
      return reply(201, { ...strip(append(target.config, "owner", "restore", body.note ?? null, id)), workers_notified: true });
    }
    if (path === "/llm-models" && method === "GET") {
      calls.catalogQueries.push(url.search);
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      if (q === "offline") return reply(200, { items: [], available: false });
      const maxPrice = url.searchParams.get("max_price");
      const items = CATALOG
        .filter((m) => m.id.toLowerCase().includes(q))
        .filter((m) => url.searchParams.get("structured") !== "true" || m.structured)
        .filter((m) => url.searchParams.get("reasoning") !== "true" || m.reasoning)
        .filter((m) => maxPrice === null || m.price_in_per_m <= Number(maxPrice))
        .sort((a, b) => a.price_in_per_m - b.price_in_per_m);
      return reply(200, { items, available: true });
    }
    if (path === "/llm-models/test" && method === "POST") {
      const body = req.postDataJSON() as { config: LlmConfigDoc; preset: string; role: string };
      calls.tests.push({ body, status: 200, headers });
      const result: ProbeResult = { ok: true, latency_ms: 812, cost_usd: 0.0004, model: body.config.presets[body.preset][body.role].model, error: null };
      return reply(200, result);
    }
    calls.unmocked.push(`${method} ${path}`);
    return reply(404, { detail: `no mock for ${method} ${path}` });
  });

  return {
    calls,
    /** Another admin saves behind the page's back (their change is to the planner of the active preset). */
    otherAdminSaves() {
      const next = clone(versions[0].config);
      next.presets[next.active_preset].planner = { ...next.presets[next.active_preset].planner, model: "vendor/better" };
      return append(next, "admin2", "edit", "planner is better", null).id;
    },
  };
}

// --- helpers -----------------------------------------------------------------------------------------------------

const tabButton = (page: Page, name: string) => page.getByRole("group", { name: "ส่วนของหน้า" }).getByRole("button", { name, exact: true });
async function openTab(page: Page, name: string) {
  await tabButton(page, name).click();
  await expect(tabButton(page, name)).toHaveAttribute("aria-pressed", "true");
}
const roleRow = (page: Page, role: string): Locator =>
  page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: role, exact: true }) });
const version = (page: Page, id: number): Locator => page.getByRole("listitem", { name: `เวอร์ชัน ${id}`, exact: true });
const modelOf = (page: Page, role: string) => page.getByLabel(`model ของ ${role}`, { exact: true });
const saveButton = (page: Page) => page.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" });
const mainAlert = (page: Page) => page.getByRole("main").getByRole("alert"); // Next's route announcer is an alert too

async function openModels(page: Page, version = 3) {
  await page.goto("/admin/models");
  await expect(page.getByRole("navigation", { name: "ผู้ดูแลระบบ" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "โมเดล" })).toBeVisible();
  await expect(page.getByText(`ใช้เวอร์ชัน ${version} จาก DB`)).toBeVisible();
  await expect(modelOf(page, "synthesizer")).toBeVisible();
}

/** Both checks, named by page and state so that a failure says which one it was. */
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

// --- behaviour ---------------------------------------------------------------------------------------------------

test("signed in, the models page shows the version in use and the worker", async ({ page }) => {
  await mockApi(page);
  const admin = await mockModels(page);
  await page.goto("/admin/dashboard");
  await page.getByRole("navigation", { name: "ผู้ดูแลระบบ" }).getByRole("link", { name: "โมเดล" }).click();
  await expect(page).toHaveURL(/\/admin\/models$/);
  await expect(page.getByRole("heading", { level: 1, name: "โมเดล" })).toBeVisible();
  await expect(page.getByText("ใช้เวอร์ชัน 3 จาก DB")).toBeVisible();
  await expect(page.getByRole("list", { name: "worker" })).toContainText("worker-1:7: เวอร์ชัน 3 · preset cheap");
  await expect(page.getByText("ยังไม่ได้ตั้ง")).toHaveCount(0);
  await expect(page.getByText("ไม่ตรงกับเวอร์ชันที่ใช้")).toHaveCount(0);
  expect(admin.calls.unmocked).toEqual([]);
});

test("the header warns about a missing key, an ignored LLM_PRESET and a worker on another version", async ({ page }) => {
  await mockApi(page);
  const admin = await mockModels(page, { alerts: true });
  await openModels(page);
  await expect(page.getByText("OPENROUTER_API_KEY ยังไม่ได้ตั้ง: role ที่ใช้ provider นี้จะรันไม่ได้")).toBeVisible();
  await expect(page.getByText("ตั้ง LLM_PRESET=better ไว้ แต่ไม่มีผลเพราะใช้เวอร์ชันจาก DB อยู่")).toBeVisible();
  const workers = page.getByRole("list", { name: "worker" });
  await expect(workers).toContainText("worker-2:9: เวอร์ชัน 2 · preset better");
  await expect(workers).toContainText("ไม่ตรงกับเวอร์ชันที่ใช้");
  await expect(workers).toContainText("error: ConfigError: preset better has no guard");
  expect(admin.calls.unmocked).toEqual([]);
});

test("a signed-out visit to the models page goes to sign-in", async ({ page }) => {
  await mockApi(page);
  await mockModels(page, { signedIn: false });
  await page.goto("/admin/models");
  await expect(page).toHaveURL(/\/admin$/);
});

test("edit a role, check it, save it as version 4, then restore version 3 from the history", async ({ page }) => {
  await mockApi(page);
  const admin = await mockModels(page);
  await openModels(page);

  // Presets: change the synthesizer of the active preset and check the draft
  await modelOf(page, "synthesizer").fill("vendor/big");
  await page.getByRole("button", { name: "ตรวจ", exact: true }).click();
  await expect(page.getByRole("main").getByText("cheap.synthesizer: vendor/big is the most expensive model in the catalog")).toBeVisible();
  const cost = page.getByRole("list", { name: "ค่าใช้จ่ายโดยประมาณ" });
  await expect(cost).toContainText("cheap: ~$0.058 ต่อรีวิว"); // four roles at 0.002 and the synthesizer at 0.05
  await expect(cost).toContainText("better: ~$0.050 ต่อรีวิว");

  await page.getByLabel("หมายเหตุ").fill("ใช้ synthesizer รุ่นใหญ่");
  await saveButton(page).click();
  await expect(page.getByText("บันทึกเป็นเวอร์ชัน 4 แล้ว")).toBeVisible(); // the bar stays busy until the page has re-read
  await expect(page.getByText("ใช้เวอร์ชัน 4 จาก DB")).toBeVisible();
  expect(admin.calls.saves).toHaveLength(1);
  const [save] = admin.calls.saves;
  expect(save.status).toBe(201);
  expect(save.headers["x-mra-admin"]).toBe("1");
  expect(save.body.base_version).toBe(3);
  expect(save.body.note).toBe("ใช้ synthesizer รุ่นใหญ่");
  expect(save.body.config.presets.cheap.synthesizer).toMatchObject({ model: "vendor/big" });
  expect(save.body.config.presets.cheap.guard).toMatchObject({ model: "vendor/cheap" });

  // History: version 4 is listed with the change
  await openTab(page, "ประวัติ");
  const v4 = version(page, 4);
  await expect(v4).toContainText("ใช้งานอยู่");
  await expect(v4).toContainText("ใช้ synthesizer รุ่นใหญ่");
  await expect(v4).toContainText("cheap.synthesizer: vendor/cheap → vendor/big");
  await expect(version(page, 3)).not.toContainText("ใช้งานอยู่");

  // restore version 3 through the in-page confirm: a new version 5 with the content of version 3
  await version(page, 3).getByRole("button", { name: "ย้อนกลับไปเวอร์ชันนี้" }).click();
  await page.getByRole("button", { name: "ยืนยันย้อนกลับ" }).click();
  await expect(page.getByText("สร้างเวอร์ชัน 5 จากเวอร์ชัน 3 แล้ว")).toBeVisible();
  expect(admin.calls.restores).toHaveLength(1);
  const [restore] = admin.calls.restores;
  expect(restore.id).toBe(3);
  expect(restore.status).toBe(201);
  expect(restore.headers["x-mra-admin"]).toBe("1");
  expect(restore.body.base_version).toBe(4);
  await expect(version(page, 5)).toContainText("ใช้งานอยู่");
  await expect(version(page, 5)).toContainText("จากเวอร์ชัน 3");
  await expect(version(page, 5)).toContainText("cheap.synthesizer: vendor/big → vendor/cheap");
  await expect(page.getByText("ใช้เวอร์ชัน 5 จาก DB")).toBeVisible();
  await openTab(page, "Presets");
  await expect(modelOf(page, "synthesizer")).toHaveValue("vendor/cheap");
  expect(admin.calls.unmocked).toEqual([]);
});

test("a save on a stale version is refused: the draft moves to the YAML tab and can be saved on the latest version", async ({ page }) => {
  await mockApi(page);
  const admin = await mockModels(page);
  await openModels(page);

  await modelOf(page, "synthesizer").fill("vendor/big");
  const other = admin.otherAdminSaves(); // version 4, made while this page still holds version 3
  expect(other).toBe(4);
  await saveButton(page).click();

  // 409: the YAML tab, the explanation, the draft's text, and (after the re-read) the note that the draft is one version behind
  await expect(mainAlert(page)).toContainText("ผู้ดูแลอื่น");
  await expect(tabButton(page, "YAML ขั้นสูง")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("ใช้เวอร์ชัน 4 จาก DB")).toBeVisible(); // the re-read has landed
  await expect(page.getByLabel("YAML ของร่าง")).toHaveValue(/vendor\/big/);
  await expect(page.getByText("ร่างนี้แก้จากเวอร์ชัน 3 แต่ตอนนี้ใช้เวอร์ชัน 4 อยู่")).toBeVisible();
  expect(admin.calls.saves.map((s) => [s.body.base_version, s.status])).toEqual([[3, 409]]);

  // keep the draft on top of the latest version, then save it
  await page.getByRole("button", { name: "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด" }).click();
  await expect(page.getByText("ร่างนี้ใช้เวอร์ชัน 4 เป็นฐานแล้ว")).toBeVisible();
  await expect(page.getByText("ร่างนี้แก้จากเวอร์ชัน")).toHaveCount(0);
  await expect(page.getByLabel("YAML ของร่าง")).toHaveValue(/vendor\/big/);
  await saveButton(page).click();
  await expect(page.getByText("บันทึกเป็นเวอร์ชัน 5 แล้ว")).toBeVisible();
  expect(admin.calls.saves.map((s) => [s.body.base_version, s.status])).toEqual([[3, 409], [4, 201]]);
  expect(admin.calls.saves[1].body.config.presets.cheap.synthesizer).toMatchObject({ model: "vendor/big" });
  await expect(page.getByText("ใช้เวอร์ชัน 5 จาก DB")).toBeVisible();
  expect(admin.calls.unmocked).toEqual([]);
});

test("pick a model in the catalog for cheap.guard and see it in the presets tab", async ({ page }) => {
  await mockApi(page);
  const admin = await mockModels(page);
  await openModels(page);

  await openTab(page, "Catalog");
  await expect(page.getByRole("region", { name: "โมเดลใน catalog" })).toBeVisible();
  await page.getByLabel("ค้นหาโมเดล").fill("qwen");
  await page.getByRole("button", { name: "ค้นหา", exact: true }).click();
  const rows = page.getByRole("region", { name: "โมเดลใน catalog" }).getByRole("rowheader");
  await expect(rows).toHaveText(["qwen/qwen3-8b", "qwen/qwen3-30b-a3b"]); // cheapest first, and nothing that does not match
  expect(admin.calls.catalogQueries.at(-1)).toBe("?q=qwen");

  await page.getByLabel("ใส่ใน role").selectOption("cheap.guard");
  await page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "qwen/qwen3-8b", exact: true }) })
    .getByRole("button", { name: "ใช้กับ role ที่เลือก" }).click();
  await expect(page.getByText("ใส่ qwen/qwen3-8b ใน cheap.guard ของร่างแล้ว")).toBeVisible();

  await openTab(page, "Presets");
  await expect(modelOf(page, "guard")).toHaveValue("qwen/qwen3-8b");
  await expect(modelOf(page, "planner")).toHaveValue("vendor/cheap");
  expect(admin.calls.saves).toEqual([]); // a pick is a draft until it is saved
  expect(admin.calls.unmocked).toEqual([]);
});

test("the test call of a role answers in its row and sends the admin header", async ({ page }) => {
  await mockApi(page);
  const admin = await mockModels(page);
  await openModels(page);

  const guard = roleRow(page, "guard");
  await guard.getByRole("button", { name: "ทดสอบ" }).click();
  await expect(guard.getByText("ใช้ได้ · 812 ms · $0.0004")).toBeVisible();
  expect(admin.calls.tests).toHaveLength(1);
  const [probe] = admin.calls.tests;
  expect(probe.headers["x-mra-admin"]).toBe("1");
  expect(probe.body).toMatchObject({ preset: "cheap", role: "guard" });
  expect(probe.body.config.presets.cheap.guard).toMatchObject({ model: "vendor/cheap" });
  await expect(roleRow(page, "planner").getByText("ใช้ได้")).toHaveCount(0); // the answer belongs to the role that was tested

  // editing the role ends the result: it was for other settings
  await modelOf(page, "guard").fill("vendor/better");
  await expect(guard.getByText("ใช้ได้")).toHaveCount(0);
  expect(admin.calls.unmocked).toEqual([]);
});

// --- layout and accessibility --------------------------------------------------------------------------------------

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`models page at ${width}px (${scheme}): every tab and state — no sideways scroll, axe-clean`, async ({ page }) => {
      test.slow(); // about thirty axe scans and tab changes in one test: three times the usual timeout
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await mockApi(page);
      const admin = await mockModels(page, { alerts: true });
      const at = (what: string) => `${what} · ${width}px ${scheme}`;
      await openModels(page);

      // Presets: at rest, an edited and checked draft (warning and cost lists), a test result with a name error
      await audit(page, at("Presets · at rest (header with its warnings)"));
      await modelOf(page, "synthesizer").fill("vendor/big");
      await page.getByRole("button", { name: "ตรวจ", exact: true }).click();
      await expect(page.getByRole("list", { name: "ค่าใช้จ่ายโดยประมาณ" })).toBeVisible();
      await audit(page, at("Presets · draft edited and checked"));
      const guard = roleRow(page, "guard");
      await guard.getByRole("button", { name: "ทดสอบ" }).click();
      await expect(guard.getByText("ใช้ได้ · 812 ms")).toBeVisible();
      await page.getByLabel("ชื่อ preset ใหม่").fill("Bad Name");
      await page.getByRole("button", { name: "คัดลอก preset" }).click();
      await expect(mainAlert(page).filter({ hasText: "ชื่อ preset ใช้ได้เฉพาะ" })).toBeVisible();
      await audit(page, at("Presets · test result and a name error"));

      // YAML: loaded from the draft, text typed and not applied, checked with a warning, applied
      await openTab(page, "YAML ขั้นสูง");
      const box = page.getByLabel("YAML ของร่าง");
      await expect(box).toHaveValue(/vendor\/big/);
      await audit(page, at("YAML · loaded from the draft"));
      await box.fill(`${await box.inputValue()}\n`);
      await expect(page.getByText(/กด "ใช้ YAML นี้" ก่อน/)).toBeVisible();
      await expect(saveButton(page)).toBeDisabled();
      await audit(page, at("YAML · text typed, not applied (save blocked)"));
      await page.getByRole("button", { name: "ตรวจ YAML" }).click();
      await expect(page.getByText(/ใช้ได้ มีคำเตือน \d+ ข้อ/)).toBeVisible();
      await audit(page, at("YAML · checked, with a warning"));
      await page.getByRole("button", { name: "ใช้ YAML นี้", exact: true }).click();
      await expect(page.getByText("ใช้ YAML นี้เป็นร่างแล้ว")).toBeVisible();
      await audit(page, at("YAML · applied as the draft"));

      // History: the versions, then the two confirms asking
      await openTab(page, "ประวัติ");
      await expect(version(page, 3)).toBeVisible();
      await audit(page, at("History · versions"));
      await version(page, 2).getByRole("button", { name: "ย้อนกลับไปเวอร์ชันนี้" }).click();
      await expect(page.getByRole("button", { name: "ยืนยันย้อนกลับ" })).toBeVisible();
      await page.getByRole("button", { name: "สร้างเวอร์ชันใหม่จาก llm.yaml" }).click();
      await expect(page.getByText(/เวอร์ชันใหม่จาก llm.yaml จะถูกใช้ทันที/)).toBeVisible();
      await audit(page, at("History · restore and reset asking to be confirmed"));

      // Catalog: the list, a model picked for a role, OpenRouter unreachable
      await openTab(page, "Catalog");
      await expect(page.getByRole("region", { name: "โมเดลใน catalog" })).toBeVisible();
      await audit(page, at("Catalog · all models"));
      await page.getByLabel("ใส่ใน role").selectOption("cheap.guard");
      await page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "qwen/qwen3-8b", exact: true }) })
        .getByRole("button", { name: "ใช้กับ role ที่เลือก" }).click();
      await expect(page.getByText("ใส่ qwen/qwen3-8b ใน cheap.guard ของร่างแล้ว")).toBeVisible();
      await audit(page, at("Catalog · a model put in the draft"));
      await page.getByLabel("ค้นหาโมเดล").fill("offline");
      await page.getByRole("button", { name: "ค้นหา", exact: true }).click();
      await expect(page.getByText("ดึง catalog ของ OpenRouter ไม่ได้ตอนนี้")).toBeVisible();
      await audit(page, at("Catalog · OpenRouter unavailable"));

      // Conflict: another admin saved, this save is refused; the YAML tab with the alert, the moved note and the discard confirm
      admin.otherAdminSaves();
      await openTab(page, "Presets");
      await saveButton(page).click();
      await expect(mainAlert(page).filter({ hasText: "ผู้ดูแลอื่น" })).toBeVisible();
      await expect(page.getByText("ร่างนี้แก้จากเวอร์ชัน 3 แต่ตอนนี้ใช้เวอร์ชัน 4 อยู่")).toBeVisible();
      await expect(box).toHaveValue(/qwen\/qwen3-8b/);
      await audit(page, at("Conflict · YAML tab with the draft and the moved note"));
      await page.getByRole("button", { name: "ทิ้งการแก้ไข", exact: true }).click();
      await expect(page.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" })).toBeVisible();
      await audit(page, at("Conflict · discard asking to be confirmed"));
      expect(admin.calls.unmocked).toEqual([]);
    });
  }
}
