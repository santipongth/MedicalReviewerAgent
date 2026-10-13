import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type {
  FieldError, GlossaryReport, GlossaryState, GlossaryTerm, HarnessRun, HarnessState, RuntimeKind, RuntimeVersion, SettingValue,
  SettingsReport, SettingsState,
} from "../src/lib/admin-types";
import {
  COMPARE, GLOSSARY, GLOSSARY_VERSIONS, HARNESS, REPORTS, REPORT_TEXT, RESULTS, RUN, RUN_DONE, SETTINGS, SETTINGS_VERSIONS, WORKER,
} from "../src/test/admin-runtime-fixtures";
import { mockApi } from "./mock-api";

/**
 * The admin "ตั้งค่า", "อภิธานศัพท์" and "Harness" pages against a stateful fake of /api/v1/admin (same origin): settings and
 * glossary versions that grow with every save and restore, a worker that reports the version it runs, and a harness whose
 * runs, reports and comparisons are fixtures. Every admin route is answered here with `page.route`: a request the fake does
 * not know is answered 404 and listed in `calls.unmocked`, and a write without `X-MRA-Admin: 1` is answered 403 and listed
 * in `calls.rejected`; each test expects both to stay empty. The harness start (`POST /harness/runs`) is one of those fake
 * routes, so no run, no provider and no spend is ever reached.
 */
interface Recorded<B> { body: B; status: number; headers: Record<string, string> }
interface SettingsBody { values: Record<string, SettingValue>; base_version: number | null; note?: string }
interface GlossaryBody { terms: GlossaryTerm[]; base_version: number | null; note?: string }
interface StartBody {
  max_usd: number; repeats: number; strata: string[]; max_reviews: number | null; compare_run: string | null; confirm: boolean;
}
interface Calls {
  settingsReads: number;
  glossaryReads: number;
  harnessReads: number;
  settingsValidates: Recorded<{ values: Record<string, SettingValue> }>[];
  glossaryValidates: Recorded<{ terms: GlossaryTerm[] }>[];
  settingsSaves: Recorded<SettingsBody>[];
  glossarySaves: Recorded<GlossaryBody>[];
  restores: (Recorded<{ base_version: number | null; note?: string }> & { kind: RuntimeKind; version: number })[];
  harnessStarts: Recorded<StartBody>[];
  /** The `a|b` of each comparison asked for. */
  compares: string[];
  unmocked: string[];
  rejected: string[];
}

/** What the harness fake is doing now; a test changes it and re-reads the page. */
interface HarnessMock {
  available: boolean;
  reasons: string[];
  worker: HarnessState["worker"];
  /** The run that is queued or running: the state then says "active_run" too, as the real route does. */
  active: HarnessRun | null;
  /** When set, a start is refused with 503 and these reason codes. */
  refuseStart: string[] | null;
  /** When set, a comparison answers 404 "no run files for run b". */
  compareMissing: boolean;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const nowIso = () => new Date().toISOString();

// --- the documents --------------------------------------------------------------------------------------------------

const RATE = /^[1-9][0-9]{0,4}\/(second|minute|hour|day)$/;

/** The checks of backend/app/services/runtime_settings.py, limited to the specs of the fixtures (never echoing a value). */
function checkSettings(values: Record<string, SettingValue>): SettingsReport {
  const errors: FieldError[] = [];
  for (const spec of SETTINGS.specs) {
    if (!(spec.name in values)) continue;
    const v = values[spec.name];
    if (spec.kind === "rate") {
      if (typeof v !== "string" || !RATE.test(v)) errors.push({ field: spec.name, message: `${spec.name} must be a rate such as 5/hour` });
    } else if (typeof v !== "number" || !Number.isFinite(v) || v < (spec.min as number) || v > (spec.max as number)
      || (spec.kind === "int" && !Number.isInteger(v))) {
      errors.push({ field: spec.name, message: `${spec.name} must be ${spec.kind === "int" ? "an integer" : "a number"} from ${spec.min} to ${spec.max}` });
    }
  }
  if (errors.length > 0) return { ok: false, errors, warnings: [], values: null, worst_case_review_usd: null };
  const warnings = "llm_concurrency" in values
    ? ["llm_concurrency applies to reviews that start after the workers reload; reviews already running keep the old limit"] : [];
  return { ok: true, errors: [], warnings, values: { ...SETTINGS.env, ...values }, worst_case_review_usd: SETTINGS.worst_case_review_usd };
}

const THAI = /[ก-๙]/; // Thai letters, vowels, tone marks and digits
function checkTerms(terms: GlossaryTerm[]): FieldError[] {
  const errors: FieldError[] = [];
  terms.forEach((t, i) => {
    if (!t.en.trim()) errors.push({ field: `terms.${i}.en`, message: `terms.${i}.en must not be empty` });
    if (!THAI.test(t.th)) errors.push({ field: `terms.${i}.th`, message: `terms.${i}.th must contain Thai script` });
  });
  return errors;
}
const renderTerms = (terms: GlossaryTerm[]) => terms.map((t) => `${t.en} = ${t.th}${t.abbr ? ` (${t.abbr})` : ""}`).join("; ");
function termWarnings(terms: GlossaryTerm[]): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  terms.forEach((t, i) => {
    const first = seen.get(t.th);
    if (first === undefined) seen.set(t.th, i);
    else out.push(`terms.${first} and terms.${i} share one Thai term`);
  });
  return out;
}

/** A kind's saved versions, newest first (the first is in use), each with the document it holds. */
function makeStore<D>(kind: RuntimeKind, seed: RuntimeVersion[], docs: D[], diff: (old: D, next: D) => Record<string, unknown>) {
  const rows: (RuntimeVersion & { doc: D })[] = seed.map((v, i) => ({ ...clone(v), doc: clone(docs[i]) }));
  return {
    rows,
    append(doc: D, by: string, source: RuntimeVersion["source"], note: string | null, restoredFrom: number | null) {
      const row = { version: rows[0].version + 1, kind, created_at: nowIso(), created_by: by, note, source, restored_from: restoredFrom,
        changes: diff(rows[0].doc, doc), doc: clone(doc) };
      rows.unshift(row);
      return row;
    },
    /** The row as the API sends it: without the document it holds. */
    strip: ({ doc: _doc, ...v }: RuntimeVersion & { doc: D }): RuntimeVersion => v, // eslint-disable-line @typescript-eslint/no-unused-vars
    list(): RuntimeVersion[] { return rows.map(this.strip); },
  };
}

function overrideChanges(old: Record<string, SettingValue>, next: Record<string, SettingValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of new Set([...Object.keys(old), ...Object.keys(next)])) {
    if (old[name] !== next[name]) out[name] = `${old[name] ?? "env"} → ${next[name] ?? "env"}`;
  }
  return out;
}
function termChanges(old: GlossaryTerm[], next: GlossaryTerm[]): Record<string, unknown> {
  const added = next.filter((t) => !old.some((o) => o.en === t.en)).map((t) => t.en);
  const removed = old.filter((t) => !next.some((n) => n.en === t.en)).map((t) => t.en);
  return { ...(added.length ? { added } : {}), ...(removed.length ? { removed } : {}) };
}

/**
 * `harness` overrides what the harness fake starts as. The worker the fake reports for settings and glossary lags until
 * `workersCatchUp()` (a worker picks a version up within 30 s of a save).
 */
async function mockRuntime(page: Page, { signedIn = true, harness: initial = {} }: { signedIn?: boolean; harness?: Partial<HarnessMock> } = {}) {
  const calls: Calls = {
    settingsReads: 0, glossaryReads: 0, harnessReads: 0, settingsValidates: [], glossaryValidates: [], settingsSaves: [],
    glossarySaves: [], restores: [], harnessStarts: [], compares: [], unmocked: [], rejected: [],
  };
  const settings = makeStore<Record<string, SettingValue>>("settings", SETTINGS_VERSIONS.items,
    [{ max_queued_reviews: 80 }, { max_queued_reviews: 50 }], overrideChanges);
  const glossary = makeStore<GlossaryTerm[]>("glossary", GLOSSARY_VERSIONS.items, [GLOSSARY.terms], termChanges);
  const workers = { settings: String(settings.rows[0].version), glossary: String(glossary.rows[0].version) };
  const harness: HarnessMock = { available: true, reasons: [], worker: HARNESS.worker, active: null, refuseStart: null,
    compareMissing: false, ...initial };
  const runs: HarnessRun[] = [clone(RUN_DONE)];

  const loaded = () => [{ ...WORKER, settings: workers.settings, glossary: workers.glossary, loaded_at: nowIso() }];
  const settingsState = (): SettingsState => {
    const active = settings.rows[0];
    return { ...clone(SETTINGS), version: active.version, overrides: clone(active.doc), values: { ...SETTINGS.env, ...active.doc },
      loaded: loaded() };
  };
  const glossaryState = (): GlossaryState => {
    const active = glossary.rows[0];
    return { ...clone(GLOSSARY), version: active.version, terms: clone(active.doc), chars: renderTerms(active.doc).length,
      loaded: loaded() };
  };
  const harnessState = (): HarnessState => ({
    ...clone(HARNESS), available: harness.available && harness.active === null,
    reasons: harness.active ? [...harness.reasons, "active_run"] : harness.reasons, worker: clone(harness.worker),
    active: clone(harness.active),
  });

  await page.route("**/api/v1/admin/**", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/v1/admin", "");
    const method = req.method();
    const headers = req.headers();
    const reply = (status: number, body?: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
    if (method !== "GET" && headers["x-mra-admin"] !== "1") {
      calls.rejected.push(`${method} ${path}`);
      return reply(403, { detail: "the X-MRA-Admin: 1 header is required" });
    }
    if (!signedIn) return reply(401, { detail: "sign in required" });
    if (path === "/me") return reply(200, { kind: "user", label: "owner" });

    // settings and glossary
    if (path === "/settings" && method === "GET") { calls.settingsReads += 1; return reply(200, settingsState()); }
    if (path === "/glossary" && method === "GET") { calls.glossaryReads += 1; return reply(200, glossaryState()); }
    if (path === "/settings/versions" && method === "GET") return reply(200, { items: settings.list(), next: null });
    if (path === "/glossary/versions" && method === "GET") return reply(200, { items: glossary.list(), next: null });
    if (path === "/settings/validate" && method === "POST") {
      const body = req.postDataJSON() as { values: Record<string, SettingValue> };
      calls.settingsValidates.push({ body, status: 200, headers });
      return reply(200, checkSettings(body.values));
    }
    if (path === "/glossary/validate" && method === "POST") {
      const body = req.postDataJSON() as { terms: GlossaryTerm[] };
      calls.glossaryValidates.push({ body, status: 200, headers });
      const errors = checkTerms(body.terms);
      const preview = renderTerms(body.terms);
      const report: GlossaryReport = errors.length > 0 ? { ok: false, errors, warnings: [], preview: null, chars: null }
        : { ok: true, errors: [], warnings: termWarnings(body.terms), preview, chars: preview.length };
      return reply(200, report);
    }
    if (path === "/settings" && method === "POST") {
      const body = req.postDataJSON() as SettingsBody;
      if (body.base_version !== settings.rows[0].version) {
        calls.settingsSaves.push({ body, status: 409, headers });
        return reply(409, { detail: `version ${settings.rows[0].version} is in use now; reload the latest version and try again` });
      }
      const report = checkSettings(body.values);
      if (!report.ok) {
        calls.settingsSaves.push({ body, status: 422, headers });
        return reply(422, { detail: "the settings were refused", errors: report.errors });
      }
      calls.settingsSaves.push({ body, status: 201, headers });
      return reply(201, { ...settings.strip(settings.append(body.values, "owner", "edit", body.note ?? null, null)), workers_notified: true });
    }
    if (path === "/glossary" && method === "POST") {
      const body = req.postDataJSON() as GlossaryBody;
      if (body.base_version !== glossary.rows[0].version) {
        calls.glossarySaves.push({ body, status: 409, headers });
        return reply(409, { detail: `version ${glossary.rows[0].version} is in use now; reload the latest version and try again` });
      }
      const errors = checkTerms(body.terms);
      if (errors.length > 0) {
        calls.glossarySaves.push({ body, status: 422, headers });
        return reply(422, { detail: "the glossary was refused", errors });
      }
      calls.glossarySaves.push({ body, status: 201, headers });
      return reply(201, { ...glossary.strip(glossary.append(body.terms, "owner", "edit", body.note ?? null, null)), workers_notified: true });
    }
    const restore = path.match(/^\/(settings|glossary)\/versions\/(\d+)\/restore$/);
    if (restore && method === "POST") {
      const kind = restore[1] as RuntimeKind;
      const version = Number(restore[2]);
      const body = req.postDataJSON() as { base_version: number | null; note?: string };
      const store = kind === "settings" ? settings : glossary;
      const target = store.rows.find((r) => r.version === version);
      if (!target) return reply(404, { detail: "version not found" });
      if (body.base_version !== store.rows[0].version) {
        calls.restores.push({ kind, version, body, status: 409, headers });
        return reply(409, { detail: `version ${store.rows[0].version} is in use now; reload the latest version and try again` });
      }
      calls.restores.push({ kind, version, body, status: 201, headers });
      const row = kind === "settings"
        ? settings.strip(settings.append(target.doc as Record<string, SettingValue>, "owner", "restore", body.note ?? null, version))
        : glossary.strip(glossary.append(target.doc as GlossaryTerm[], "owner", "restore", body.note ?? null, version));
      return reply(201, { ...row, workers_notified: true });
    }

    // harness
    if (path === "/harness" && method === "GET") { calls.harnessReads += 1; return reply(200, harnessState()); }
    if (path === "/harness/runs" && method === "GET") return reply(200, { items: clone(runs), next: null });
    if (path === "/harness/reports" && method === "GET") return reply(200, { items: REPORTS });
    if (path === "/harness/results" && method === "GET") return reply(200, { items: RESULTS });
    if (path === "/harness/runs" && method === "POST") {
      const body = req.postDataJSON() as StartBody;
      if (harness.refuseStart) {
        calls.harnessStarts.push({ body, status: 503, headers });
        return reply(503, { detail: "the harness cannot start a run now", reasons: harness.refuseStart });
      }
      calls.harnessStarts.push({ body, status: 201, headers });
      const run: HarnessRun = { ...clone(RUN), max_usd: body.max_usd, repeats: body.repeats, strata: body.strata,
        max_reviews: body.max_reviews, compare_run: body.compare_run, planned: 3 * body.repeats, done: 1 };
      harness.active = run;
      runs.unshift(run);
      return reply(201, run);
    }
    const report = path.match(/^\/harness\/reports\/(.+)$/);
    if (report && method === "GET") {
      const name = decodeURIComponent(report[1]);
      if (![...REPORTS.map((r) => r.name), RUN_DONE.report].includes(name)) return reply(404, { detail: "no such report (or it is over 1 MB)" });
      return reply(200, { name, text: REPORT_TEXT });
    }
    if (path === "/harness/compare" && method === "GET") {
      calls.compares.push(`${url.searchParams.get("a")}|${url.searchParams.get("b")}`);
      if (harness.compareMissing) return reply(404, { detail: "no run files for run b" });
      return reply(200, COMPARE);
    }
    calls.unmocked.push(`${method} ${path}`);
    return reply(404, { detail: `no mock for ${method} ${path}` });
  });

  return {
    calls,
    harness,
    /** Another admin saves behind the page's back: settings version 3 sets the queue to 60. */
    otherAdminSavesSettings() {
      return settings.append({ max_queued_reviews: 60 }, "admin2", "edit", "smaller queue", null).version;
    },
    /** Every worker now reports the newest version of both kinds. */
    workersCatchUp() {
      workers.settings = String(settings.rows[0].version);
      workers.glossary = String(glossary.rows[0].version);
    },
  };
}

// --- helpers -----------------------------------------------------------------------------------------------------

const nav = (page: Page) => page.getByRole("navigation", { name: "ผู้ดูแลระบบ" });
const tabButton = (page: Page, name: string) => page.getByRole("group", { name: "มุมมอง" }).getByRole("button", { name, exact: true });
async function openTab(page: Page, name: string) {
  await tabButton(page, name).click();
  await expect(tabButton(page, name)).toHaveAttribute("aria-pressed", "true");
}
const mainAlert = (page: Page) => page.getByRole("main").getByRole("alert"); // Next's route announcer is an alert too
const status = (page: Page, text: string): Locator => page.getByRole("status").filter({ hasText: text });
const version = (page: Page, id: number): Locator => page.getByRole("listitem", { name: `เวอร์ชัน ${id}`, exact: true });
const saveButton = (page: Page) => page.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" });
const checkButton = (page: Page) => page.getByRole("button", { name: "ตรวจ", exact: true });
const workerList = (page: Page) => page.getByRole("list", { name: "worker" });

const queued = (page: Page) => page.getByLabel("ค่าใหม่: รีวิวที่รอคิวได้สูงสุด", { exact: true });
async function openSettings(page: Page, version = 2) {
  await page.goto("/admin/settings");
  await expect(nav(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "ตั้งค่าระบบ" })).toBeVisible();
  await expect(page.getByText(`ใช้เวอร์ชัน ${version} จาก DB`)).toBeVisible();
  await expect(queued(page)).toBeVisible();
}

const cell = (page: Page, field: "English" | "ภาษาไทย" | "ตัวย่อ" | "หมายเหตุ", n: number) =>
  page.getByLabel(`${field} คำที่ ${n}`, { exact: true });
async function openGlossary(page: Page, version = 4) {
  await page.goto("/admin/glossary");
  await expect(nav(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "อภิธานศัพท์ไทย" })).toBeVisible();
  await expect(page.getByText(`ใช้อภิธานศัพท์เวอร์ชัน ${version} จาก DB`)).toBeVisible();
  await expect(cell(page, "English", 1)).toBeVisible();
}

const askStart = (page: Page) => page.getByRole("button", { name: "เริ่มรัน harness" });
const confirmStart = (page: Page) => page.getByRole("button", { name: "ยืนยัน เริ่มรันและใช้เงินจริง" });
const stratum = (page: Page, name: string) => page.getByRole("checkbox", { name: new RegExp(`^${name} ·`) });
const acknowledgement = (page: Page) => page.getByRole("checkbox", { name: /^เข้าใจว่าการรันนี้เรียกโมเดลจริง/ });
async function openHarness(page: Page, ready = "พร้อมเริ่มรัน") {
  await page.goto("/admin/harness");
  await expect(nav(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Cochrane harness" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: ready })).toBeVisible();
  await expect(page.getByRole("button", { name: REPORTS[0].name, exact: true })).toBeVisible(); // the lists have loaded
}
async function openReport(page: Page) {
  await page.getByRole("button", { name: REPORTS[0].name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 4, name: "Cochrane harness report: 2026-10-11.1 (run baseline)" })).toBeVisible();
}
async function compareResults(page: Page) {
  await page.getByLabel("รุ่น A").selectOption(RESULTS[0].label);
  await page.getByLabel("รุ่น B").selectOption(RESULTS[1].label);
  await page.getByRole("button", { name: "เทียบ", exact: true }).click();
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

function expectNothingStray(admin: Awaited<ReturnType<typeof mockRuntime>>) {
  expect(admin.calls.unmocked).toEqual([]);
  expect(admin.calls.rejected).toEqual([]);
}

// --- access and navigation ---------------------------------------------------------------------------------------

test("the console nav reaches the three pages", async ({ page }) => {
  await mockApi(page);
  const admin = await mockRuntime(page);
  await openSettings(page);
  await nav(page).getByRole("link", { name: "อภิธานศัพท์", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/glossary$/);
  await expect(page.getByRole("heading", { level: 1, name: "อภิธานศัพท์ไทย" })).toBeVisible();
  await expect(page.getByText("ใช้อภิธานศัพท์เวอร์ชัน 4 จาก DB")).toBeVisible();
  await nav(page).getByRole("link", { name: "Harness", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/harness$/);
  await expect(page.getByRole("heading", { level: 1, name: "Cochrane harness" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "พร้อมเริ่มรัน" })).toBeVisible();
  await nav(page).getByRole("link", { name: "ตั้งค่า", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(page.getByText("ใช้เวอร์ชัน 2 จาก DB")).toBeVisible();
  expectNothingStray(admin);
});

test("a signed-out visit to any of the three pages goes to sign-in", async ({ page }) => {
  await mockApi(page);
  await mockRuntime(page, { signedIn: false });
  for (const path of ["/admin/settings", "/admin/glossary", "/admin/harness"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1, name: "เข้าสู่ระบบผู้ดูแล" })).toBeVisible();
  }
});

// --- settings ----------------------------------------------------------------------------------------------------

test("settings: edit, check and save as version 3, follow the worker to it, then restore version 1 from the history", async ({ page }) => {
  await page.clock.install(); // the page re-reads every 10 s while a worker lags; the test moves that clock instead of waiting
  await mockApi(page);
  const admin = await mockRuntime(page);
  await openSettings(page);
  const workers = workerList(page);
  await expect(workers).toContainText("worker-1:7 · ตรงกับที่ใช้งาน");

  await queued(page).fill("90");
  await checkButton(page).click();
  await expect(status(page, "ผ่านการตรวจ")).toBeVisible();
  expect(admin.calls.settingsValidates.map((v) => v.body)).toEqual([{ values: { max_queued_reviews: 90 } }]);
  await saveButton(page).click();

  // saved as version 3: the notice has focus, the header moves on, the worker is still on 2 and "changing"
  const saved = status(page, "บันทึกเป็นเวอร์ชัน 3 แล้ว");
  await expect(saved).toBeVisible();
  await expect(saved).toBeFocused();
  await expect(page.getByText("ใช้เวอร์ชัน 3 จาก DB")).toBeVisible();
  expect(admin.calls.settingsSaves).toHaveLength(1);
  const [save] = admin.calls.settingsSaves;
  expect(save.status).toBe(201);
  expect(save.headers["x-mra-admin"]).toBe("1");
  expect(save.body).toEqual({ values: { max_queued_reviews: 90 }, base_version: 2 });
  await expect(workers).toContainText("ยังใช้ 2");
  await expect(workers).toContainText("กำลังเปลี่ยนเป็น 3 (ภายใน 30 วินาที)");

  // the worker reports 3 from now on; the page finds out at its next read, which is 10 s after the last (not before)
  const readsBefore = admin.calls.settingsReads;
  admin.workersCatchUp();
  await page.clock.runFor(5_000);
  await expect(workers).toContainText("กำลังเปลี่ยนเป็น 3 (ภายใน 30 วินาที)"); // still the old report
  expect(admin.calls.settingsReads).toBe(readsBefore);
  await page.clock.runFor(6_000);
  await expect(workers).toContainText("worker-1:7 · ตรงกับที่ใช้งาน");
  await expect(workers).not.toContainText("กำลังเปลี่ยน");
  await expect(workers).not.toContainText("ยังใช้");
  expect(admin.calls.settingsReads).toBe(readsBefore + 1);

  // History: version 3 is in use with its change; restore version 1 through the in-page confirm
  await openTab(page, "ประวัติ");
  await expect(version(page, 3)).toContainText("ใช้งานอยู่");
  await expect(version(page, 3)).toContainText("max_queued_reviews: 80 → 90");
  await expect(version(page, 2)).not.toContainText("ใช้งานอยู่");
  await version(page, 1).getByRole("button", { name: "ย้อนกลับไปเวอร์ชัน 1" }).click();
  await page.getByRole("button", { name: "ยืนยันย้อนกลับ" }).click();
  const restored = status(page, "สร้างเวอร์ชัน 4 จากเวอร์ชัน 1 แล้ว");
  await expect(restored).toBeVisible();
  await expect(restored).toBeFocused();
  expect(admin.calls.restores).toHaveLength(1);
  const [restore] = admin.calls.restores;
  expect([restore.kind, restore.version, restore.status]).toEqual(["settings", 1, 201]);
  expect(restore.headers["x-mra-admin"]).toBe("1");
  expect(restore.body).toEqual({ base_version: 3 });
  await expect(version(page, 4)).toContainText("ใช้งานอยู่");
  await expect(version(page, 4)).toContainText("ย้อนกลับ จากเวอร์ชัน 1");
  await expect(version(page, 4)).toContainText("max_queued_reviews: 90 → 50");
  await expect(version(page, 3)).not.toContainText("ใช้งานอยู่");
  await expect(page.getByText("ใช้เวอร์ชัน 4 จาก DB")).toBeVisible();
  await openTab(page, "แก้ไข");
  await expect(queued(page)).toHaveValue("50");
  expectNothingStray(admin);
});

test("settings: a refused save marks the field beside its row and saves nothing; editing the value clears the mark", async ({ page }) => {
  await mockApi(page);
  const admin = await mockRuntime(page);
  await openSettings(page);

  await queued(page).fill("abc");
  await saveButton(page).click();
  const message = "max_queued_reviews must be an integer from 1 to 1000";
  await expect(page.getByText(message)).toBeVisible();
  await expect(queued(page)).toHaveAttribute("aria-invalid", "true");
  await expect(queued(page)).toHaveAccessibleDescription(new RegExp(message));
  await expect(mainAlert(page).filter({ hasText: "ยังบันทึกไม่ได้" })).toBeVisible();
  expect(admin.calls.settingsSaves.map((s) => [s.body.base_version, s.status])).toEqual([[2, 422]]);
  await expect(page.getByText("ใช้เวอร์ชัน 2 จาก DB")).toBeVisible(); // nothing was saved

  await queued(page).fill("90");
  await expect(page.getByText(message)).toHaveCount(0);
  await expect(queued(page)).not.toHaveAttribute("aria-invalid", "true");
  await saveButton(page).click();
  await expect(status(page, "บันทึกเป็นเวอร์ชัน 3 แล้ว")).toBeVisible();
  expect(admin.calls.settingsSaves.map((s) => [s.body.base_version, s.status])).toEqual([[2, 422], [2, 201]]);
  expectNothingStray(admin);
});

test("settings: a save on a stale version is refused; the typed value stays and can be built on the latest version", async ({ page }) => {
  await mockApi(page);
  const admin = await mockRuntime(page);
  await openSettings(page);

  await queued(page).fill("95");
  expect(admin.otherAdminSavesSettings()).toBe(3); // made while this page still holds version 2
  await saveButton(page).click();

  // 409: the alert, the header on the newer version, the typed value, and the note that the draft is one version behind
  await expect(mainAlert(page).filter({ hasText: "มีผู้ดูแลอีกคนบันทึกเวอร์ชันใหม่ก่อน" })).toBeVisible();
  await expect(page.getByText("ใช้เวอร์ชัน 3 จาก DB")).toBeVisible();
  await expect(queued(page)).toHaveValue("95");
  await expect(page.getByText("ร่างนี้แก้จากเวอร์ชัน 2 แต่ตอนนี้ใช้เวอร์ชัน 3 อยู่")).toBeVisible();
  expect(admin.calls.settingsSaves.map((s) => [s.body.base_version, s.status])).toEqual([[2, 409]]);

  // "ทิ้งการแก้ไข" asks again inside the page; "ไม่ใช่" leaves everything as it was
  await page.getByRole("button", { name: "ทิ้งการแก้ไข", exact: true }).click();
  await expect(page.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" })).toBeVisible();
  await page.getByRole("button", { name: "ไม่ใช่" }).click();
  await expect(page.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" })).toHaveCount(0);
  await expect(page.getByText("ร่างนี้แก้จากเวอร์ชัน 2 แต่ตอนนี้ใช้เวอร์ชัน 3 อยู่")).toBeVisible();
  await expect(queued(page)).toHaveValue("95");

  // keep the draft on top of the latest version, then save it: the next save carries base_version 3
  await page.getByRole("button", { name: "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด" }).click();
  const rebased = status(page, "ร่างนี้ใช้เวอร์ชัน 3 เป็นฐานแล้ว");
  await expect(rebased).toBeVisible();
  await expect(rebased).toBeFocused();
  await expect(page.getByText("ร่างนี้แก้จากเวอร์ชัน")).toHaveCount(0);
  await expect(queued(page)).toHaveValue("95");
  await saveButton(page).click();
  await expect(status(page, "บันทึกเป็นเวอร์ชัน 4 แล้ว")).toBeVisible();
  expect(admin.calls.settingsSaves.map((s) => [s.body.base_version, s.status])).toEqual([[2, 409], [3, 201]]);
  expect(admin.calls.settingsSaves[1].body.values).toEqual({ max_queued_reviews: 95 });
  await expect(page.getByText("ใช้เวอร์ชัน 4 จาก DB")).toBeVisible();
  await expect(mainAlert(page)).toHaveCount(0);
  expectNothingStray(admin);
});

test("settings: after a stale save, discarding the edits shows the latest version's value", async ({ page }) => {
  await mockApi(page);
  const admin = await mockRuntime(page);
  await openSettings(page);

  await queued(page).fill("95");
  admin.otherAdminSavesSettings();
  await saveButton(page).click();
  await expect(page.getByText("ร่างนี้แก้จากเวอร์ชัน 2 แต่ตอนนี้ใช้เวอร์ชัน 3 อยู่")).toBeVisible();
  await expect(queued(page)).toHaveValue("95");

  await page.getByRole("button", { name: "ทิ้งการแก้ไข", exact: true }).click();
  await page.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" }).click();
  const discarded = status(page, "ทิ้งการแก้ไขแล้ว: ร่างตรงกับเวอร์ชัน 3");
  await expect(discarded).toBeVisible();
  await expect(discarded).toBeFocused();
  await expect(queued(page)).toHaveValue("60"); // the other admin's value
  await expect(page.getByText("ร่างนี้แก้จากเวอร์ชัน")).toHaveCount(0);
  expect(admin.calls.settingsSaves).toHaveLength(1); // only the refused one
  expectNothingStray(admin);
});

// --- glossary ----------------------------------------------------------------------------------------------------

test("glossary: add a term, check it for the preview and its size, then save the three terms on version 4", async ({ page }) => {
  await mockApi(page);
  const admin = await mockRuntime(page);
  await openGlossary(page);
  const before = "hazard ratio = อัตราส่วนฮาซาร์ด (HR); placebo = ยาหลอก";
  await expect(page.getByText(`2 คำ · ${before.length} / 4000 ตัวอักษร`)).toBeVisible();
  await expect(workerList(page)).toContainText("worker-1:7 · ตรงกับที่ใช้งาน");

  await page.getByRole("button", { name: "เพิ่มคำ" }).click();
  await expect(cell(page, "English", 3)).toBeFocused();
  await cell(page, "English", 3).fill("mortality");
  await cell(page, "ภาษาไทย", 3).fill("อัตราการเสียชีวิต");
  await checkButton(page).click();

  // the check: the verdict and the size are in the status, the preview is a focusable region beside it, not inside it
  const preview = "hazard ratio = อัตราส่วนฮาซาร์ด (HR); placebo = ยาหลอก; mortality = อัตราการเสียชีวิต";
  const verdict = status(page, "ผ่านการตรวจ");
  await expect(verdict).toContainText(`${preview.length} / 4000 ตัวอักษร`);
  const region = page.getByRole("region", { name: "ตัวอย่างข้อความ glossary ใน prompt" });
  await expect(region).toHaveText(preview);
  await expect(verdict.getByRole("region")).toHaveCount(0);
  await region.focus();
  await expect(region).toBeFocused();
  expect(admin.calls.glossaryValidates).toHaveLength(1);
  expect(admin.calls.glossaryValidates[0].body.terms).toHaveLength(3);

  await saveButton(page).click();
  const saved = status(page, "บันทึกเป็นเวอร์ชัน 5 แล้ว");
  await expect(saved).toBeVisible();
  await expect(saved).toBeFocused();
  expect(admin.calls.glossarySaves).toHaveLength(1);
  const [save] = admin.calls.glossarySaves;
  expect(save.status).toBe(201);
  expect(save.headers["x-mra-admin"]).toBe("1");
  expect(save.body).toEqual({
    terms: [
      { en: "hazard ratio", th: "อัตราส่วนฮาซาร์ด", abbr: "HR", note: null },
      { en: "placebo", th: "ยาหลอก", abbr: null, note: "ไม่ใช่ยาจริง" },
      { en: "mortality", th: "อัตราการเสียชีวิต", abbr: null, note: null },
    ],
    base_version: 4,
  });
  await expect(page.getByText("ใช้อภิธานศัพท์เวอร์ชัน 5 จาก DB")).toBeVisible();
  await expect(page.getByText(/^3 คำ · /)).toBeVisible();
  await expect(workerList(page)).toContainText("ยังใช้ 4");
  await expect(workerList(page)).toContainText("กำลังเปลี่ยนเป็น 5");
  expectNothingStray(admin);
});

test("glossary: a refused save marks the cell, the row stays under a filter that would hide it, and a filter that matches nothing says so", async ({ page }) => {
  await mockApi(page);
  const admin = await mockRuntime(page);
  await openGlossary(page);

  await page.getByRole("button", { name: "เพิ่มคำ" }).click();
  await cell(page, "English", 3).fill("bad");
  await cell(page, "ภาษาไทย", 3).fill("english only");
  await saveButton(page).click();
  await expect(page.getByText("terms.2.th must contain Thai script")).toBeVisible();
  await expect(cell(page, "ภาษาไทย", 3)).toHaveAttribute("aria-invalid", "true");
  await expect(cell(page, "English", 3)).not.toHaveAttribute("aria-invalid", "true");
  await expect(mainAlert(page).filter({ hasText: "ยังบันทึกไม่ได้" })).toBeVisible();
  expect(admin.calls.glossarySaves.map((s) => [s.body.base_version, s.status])).toEqual([[4, 422]]);

  // the filter hides placebo but not the row with the error
  await page.getByLabel("ค้นหาคำ").fill("hazard");
  await expect(cell(page, "English", 1)).toBeVisible();
  await expect(cell(page, "English", 2)).toHaveCount(0);
  await expect(cell(page, "English", 3)).toBeVisible();

  // fixing the cell ends the refusal; a filter that matches nothing then shows the empty line and no rows
  await cell(page, "ภาษาไทย", 3).fill("ผิดพลาด");
  await expect(page.getByText("terms.2.th must contain Thai script")).toHaveCount(0);
  await page.getByLabel("ค้นหาคำ").fill("zzz");
  await expect(page.getByText("ไม่พบคำที่ตรงกับคำค้น")).toBeVisible();
  await expect(page.getByLabel(/^English คำที่ /)).toHaveCount(0);
  await page.getByLabel("ค้นหาคำ").fill("");
  await expect(page.getByLabel(/^English คำที่ /)).toHaveCount(3);
  await expect(page.getByText("ไม่พบคำที่ตรงกับคำค้น")).toHaveCount(0);

  await saveButton(page).click();
  await expect(status(page, "บันทึกเป็นเวอร์ชัน 5 แล้ว")).toBeVisible();
  expect(admin.calls.glossarySaves.map((s) => [s.body.base_version, s.status])).toEqual([[4, 422], [4, 201]]);
  expectNothingStray(admin);
});

// --- harness -----------------------------------------------------------------------------------------------------

test("harness unavailable: the reason is shown with the profile command and a start cannot be asked for", async ({ page }) => {
  await mockApi(page);
  const admin = await mockRuntime(page, { harness: { available: false, reasons: ["no_worker"], worker: null } });
  await openHarness(page, "ยังเริ่มรันไม่ได้");
  const state = page.getByRole("region", { name: "ยังเริ่มรันไม่ได้" });
  await expect(state).toContainText("harness worker ไม่ทำงาน (เริ่มด้วย docker compose --profile harness up -d harness)");
  await expect(state).not.toContainText("harness-1:9"); // the worker line says there is none
  await expect(page.getByRole("heading", { level: 2, name: "พร้อมเริ่มรัน" })).toHaveCount(0);
  await expect(askStart(page)).toBeVisible();
  await expect(askStart(page)).toBeDisabled();
  await expect(stratum(page, "cv")).toBeDisabled();
  expect(admin.calls.harnessStarts).toEqual([]);
  expectNothingStray(admin);
});

test("harness: a capped start waits for the acknowledgement and the confirm, posts exactly once, then shows progress and polls", async ({ page }) => {
  await page.clock.install(); // the page polls every 5 s while a run is active; the test moves that clock instead of waiting
  await mockApi(page);
  const admin = await mockRuntime(page);
  await openHarness(page);

  await stratum(page, "cv").check();
  await page.getByRole("radio", { name: "1 รอบ" }).check();
  await expect(page.getByText(/ประมาณการ: 3 รอบ/)).toBeVisible();
  await expect(askStart(page)).toBeDisabled(); // the estimate is there; the acknowledgement is not
  await acknowledgement(page).check();
  await expect(askStart(page)).toBeEnabled();
  await askStart(page).click();
  await expect(confirmStart(page)).toBeVisible();
  expect(admin.calls.harnessStarts).toEqual([]); // asking is not starting
  await confirmStart(page).click();

  // started: one POST with the exact body and the admin header, a notice with focus, and the run's progress line
  const started = status(page, "เริ่มรัน console-20261013-100000-a1b2 แล้ว (งบ $1.00)");
  await expect(started).toBeVisible();
  await expect(started).toBeFocused();
  expect(admin.calls.harnessStarts).toHaveLength(1);
  const [start] = admin.calls.harnessStarts;
  expect(start.status).toBe(201);
  expect(start.headers["x-mra-admin"]).toBe("1");
  expect(start.body).toEqual({ max_usd: 1, repeats: 1, strata: ["cv"], max_reviews: null, compare_run: null, confirm: true });
  await expect(page.getByText("console-20261013-100000-a1b2 · กำลังรัน")).toBeVisible();
  await expect(page.getByText(/เสร็จ 1 · ล้มเหลว 0 · ข้าม 0 จาก 3 · ใช้ไป \$0\.130 จากงบ \$1\.00/)).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "ความคืบหน้าของการรัน" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "ยังเริ่มรันไม่ได้" })).toBeVisible(); // one run at a time
  await expect(askStart(page)).toBeDisabled();

  // while the run is active the page reads /harness again once its 5 s poll comes round
  const readsBefore = admin.calls.harnessReads;
  await page.clock.runFor(5_500);
  await expect.poll(() => admin.calls.harnessReads).toBeGreaterThan(readsBefore);
  expect(admin.calls.harnessStarts).toHaveLength(1); // exactly one POST, whatever the polling and the re-reads did
  expectNothingStray(admin);
});

test("harness: the start stays disabled for a cap or a review limit out of range, and a confirm cannot outlive the acknowledgement", async ({ page }) => {
  await mockApi(page);
  const admin = await mockRuntime(page);
  await openHarness(page);
  const cap = page.getByLabel("งบสูงสุด (USD)");
  const limit = page.getByLabel("ไม่เกินกี่รีวิว (ไม่บังคับ)");
  const capRange = page.getByText("งบต้องอยู่ระหว่าง $0.280 ถึง $5.00");
  const limitRange = page.getByText("ต้องเป็นจำนวนเต็ม 1 ถึง 1000 หรือเว้นว่าง");

  await stratum(page, "cv").check();
  await acknowledgement(page).check();
  await expect(askStart(page)).toBeEnabled(); // everything valid: this is what the cases below break one at a time
  await expect(capRange).toHaveCount(0);

  for (const [text, ok] of [["6", false], ["0.1", false], ["5", true], ["1", true]] as const) {
    await cap.fill(text);
    if (ok) await expect(askStart(page)).toBeEnabled();
    else {
      await expect(capRange).toBeVisible();
      await expect(cap).toHaveAttribute("aria-invalid", "true");
      await expect(askStart(page)).toBeDisabled();
    }
  }
  await expect(capRange).toHaveCount(0);

  for (const [text, ok] of [["1001", false], ["0", false], ["-1", false], ["1.5", false], ["1000", true], ["", true], ["7", true]] as const) {
    await limit.fill(text);
    if (ok) {
      await expect(limitRange).toHaveCount(0);
      await expect(askStart(page)).toBeEnabled();
    } else {
      await expect(limitRange).toBeVisible();
      await expect(askStart(page)).toBeDisabled();
    }
  }

  // asked, then the acknowledgement is withdrawn: the confirm is disabled and nothing is sent
  await limit.fill("");
  await askStart(page).click();
  await expect(confirmStart(page)).toBeEnabled();
  await acknowledgement(page).uncheck();
  await expect(confirmStart(page)).toBeDisabled();
  expect(admin.calls.harnessStarts).toEqual([]);
  expectNothingStray(admin);
});

test("harness: a start refused with reasons shows them, and a comparison with no run files shows the server's text", async ({ page }) => {
  await mockApi(page);
  const admin = await mockRuntime(page);
  admin.harness.refuseStart = ["no_worker"]; // the worker went away between the page's read and the start
  admin.harness.compareMissing = true;
  await openHarness(page);

  await stratum(page, "cv").check();
  await acknowledgement(page).check();
  await askStart(page).click();
  await confirmStart(page).click();
  const refusal = mainAlert(page).filter({ hasText: "เริ่มรันไม่สำเร็จ เพราะตอนนี้" });
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText("harness worker ไม่ทำงาน (เริ่มด้วย docker compose --profile harness up -d harness)");
  expect(admin.calls.harnessStarts.map((s) => s.status)).toEqual([503]);
  await expect(page.getByRole("progressbar")).toHaveCount(0); // no run was started

  await compareResults(page);
  await expect(mainAlert(page).filter({ hasText: "no run files for run b" })).toBeVisible();
  expect(admin.calls.compares).toEqual([`${RESULTS[0].label}|${RESULTS[1].label}`]);
  await expect(page.getByRole("region", { name: "ตารางเทียบผลสองรุ่น" })).toHaveCount(0);
  expectNothingStray(admin);
});

test("harness: a report opens as elements (its table, its script as text) and two results compare row by row", async ({ page }) => {
  await mockApi(page);
  const admin = await mockRuntime(page);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await openHarness(page);

  await openReport(page);
  await expect(page.getByRole("heading", { level: 3, name: REPORTS[0].name })).toBeFocused();
  const table = page.getByRole("region", { name: "ตารางที่ 1 ในรายงาน" });
  await expect(table.getByRole("row", { name: /Batch cost/ })).toContainText("$3.90");
  await expect(table.getByRole("row", { name: /Runs \(failed\)/ })).toContainText("60 (0)");
  await expect(page.locator("main").getByText("<script>alert(1)</script>")).toBeVisible(); // shown as text, inside <main>
  await expect(page.locator("main script")).toHaveCount(0); // and not as an element
  expect(dialogs).toEqual([]);

  // compare: the button needs two different results
  const compare = page.getByRole("button", { name: "เทียบ", exact: true });
  await expect(compare).toBeDisabled();
  await page.getByLabel("รุ่น A").selectOption(RESULTS[0].label);
  await page.getByLabel("รุ่น B").selectOption(RESULTS[0].label);
  await expect(compare).toBeDisabled();
  await page.getByLabel("รุ่น B").selectOption(RESULTS[1].label);
  await expect(compare).toBeEnabled();
  await compare.click();
  const comparison = page.getByRole("region", { name: "ตารางเทียบผลสองรุ่น" });
  const batch = comparison.getByRole("row", { name: /Batch cost/ });
  await expect(batch).toContainText("$3.90");
  await expect(batch).toContainText("$0.40");
  await expect(comparison.getByRole("row", { name: /Runs \(failed\)/ })).toContainText("60 (0)");
  await expect(comparison.getByRole("row", { name: /Runs \(failed\)/ })).toContainText("6 (0)");
  await expect(comparison.locator("caption")).toBeFocused();
  await expect(page.getByText("CD1: consensus:positive → none")).toBeVisible();
  expect(admin.calls.compares).toEqual([`${RESULTS[0].label}|${RESULTS[1].label}`]);
  expectNothingStray(admin);
});

// --- layout and accessibility --------------------------------------------------------------------------------------

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`settings, glossary and harness at ${width}px (${scheme}): every state — no sideways scroll, axe-clean`, async ({ page }) => {
      test.slow(); // about twenty axe scans in one test: three times the usual timeout
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await mockApi(page);
      const admin = await mockRuntime(page);
      const at = (what: string) => `${what} · ${width}px ${scheme}`;

      // Settings: at rest, edited and checked (a warning), a refused check, the history asking, a conflict
      await openSettings(page);
      await audit(page, at("Settings · edit, at rest (worker line)"));
      await page.getByRole("checkbox", { name: "ตั้งค่าเอง: LLM call พร้อมกันต่อ worker" }).check();
      await queued(page).fill("90");
      await checkButton(page).click();
      await expect(status(page, "ผ่านการตรวจ")).toBeVisible();
      await expect(page.getByText(/llm_concurrency applies to reviews that start after/)).toBeVisible();
      await audit(page, at("Settings · edited and checked (with a warning)"));
      await queued(page).fill("abc");
      await checkButton(page).click();
      await expect(page.getByText("max_queued_reviews must be an integer from 1 to 1000")).toBeVisible();
      await audit(page, at("Settings · a refused check marks the field"));
      await queued(page).fill("90");
      await openTab(page, "ประวัติ");
      await expect(version(page, 2)).toBeVisible();
      await audit(page, at("Settings · history"));
      await version(page, 1).getByRole("button", { name: "ย้อนกลับไปเวอร์ชัน 1" }).click();
      await expect(page.getByRole("button", { name: "ยืนยันย้อนกลับ" })).toBeVisible();
      await page.getByRole("button", { name: "กลับไปใช้ค่า env" }).click();
      await expect(page.getByText(/ทุกค่ากลับไปใช้ env ทันที/)).toBeVisible();
      await audit(page, at("Settings · restore and reset asking to be confirmed"));
      await openTab(page, "แก้ไข");
      admin.otherAdminSavesSettings();
      await saveButton(page).click();
      await expect(mainAlert(page).filter({ hasText: "มีผู้ดูแลอีกคนบันทึกเวอร์ชันใหม่ก่อน" })).toBeVisible();
      await expect(page.getByText("ร่างนี้แก้จากเวอร์ชัน 2 แต่ตอนนี้ใช้เวอร์ชัน 3 อยู่")).toBeVisible();
      await audit(page, at("Settings · conflict (alert and the moved note)"));
      await page.getByRole("button", { name: "ทิ้งการแก้ไข", exact: true }).click();
      await expect(page.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" })).toBeVisible();
      await audit(page, at("Settings · discard asking to be confirmed"));

      // Glossary: at rest, a filter that matches nothing, checked with a warning and its preview, a refused save, the history
      await openGlossary(page);
      await audit(page, at("Glossary · edit, at rest"));
      await page.getByLabel("ค้นหาคำ").fill("zzz");
      await expect(page.getByText("ไม่พบคำที่ตรงกับคำค้น")).toBeVisible();
      await expect(page.getByLabel(/^English คำที่ /)).toHaveCount(0);
      await audit(page, at("Glossary · a filter that matches nothing"));
      await page.getByLabel("ค้นหาคำ").fill("");
      await page.getByRole("button", { name: "เพิ่มคำ" }).click();
      await cell(page, "English", 3).fill("dummy treatment");
      await cell(page, "ภาษาไทย", 3).fill("ยาหลอก"); // the same Thai term as row 2: the check warns
      await checkButton(page).click();
      await expect(page.getByText("terms.1 and terms.2 share one Thai term")).toBeVisible();
      await expect(page.getByRole("region", { name: "ตัวอย่างข้อความ glossary ใน prompt" })).toBeVisible();
      await audit(page, at("Glossary · checked (warning and the preview region)"));
      await cell(page, "ภาษาไทย", 3).fill("english only");
      await saveButton(page).click();
      await expect(page.getByText("terms.2.th must contain Thai script")).toBeVisible();
      await audit(page, at("Glossary · a refused save marks the cell"));
      await page.getByLabel("ค้นหาคำ").fill("zzz");
      await expect(cell(page, "English", 3)).toBeVisible(); // the row with the error stays under the filter
      await audit(page, at("Glossary · a filter with an error row kept"));
      await openTab(page, "ประวัติ");
      await expect(version(page, 4)).toBeVisible();
      await audit(page, at("Glossary · history"));

      // Harness: at rest, the start asking for its confirm, a report and a comparison, a run started, unavailable
      await openHarness(page);
      await audit(page, at("Harness · at rest"));
      await stratum(page, "cv").check();
      await acknowledgement(page).check();
      await askStart(page).click();
      await expect(confirmStart(page)).toBeVisible();
      await audit(page, at("Harness · start asking to be confirmed"));
      await openReport(page);
      await expect(page.getByRole("region", { name: "ตารางที่ 1 ในรายงาน" })).toBeVisible();
      await compareResults(page);
      await expect(page.getByRole("region", { name: "ตารางเทียบผลสองรุ่น" }).getByRole("row", { name: /Batch cost/ })).toBeVisible();
      await audit(page, at("Harness · report open and a comparison shown"));
      await confirmStart(page).click();
      await expect(page.getByRole("progressbar", { name: "ความคืบหน้าของการรัน" })).toBeVisible();
      await audit(page, at("Harness · a run started (progress, cancel)"));
      admin.harness.active = null;
      admin.harness.available = false;
      admin.harness.reasons = ["no_worker", "no_fixtures"];
      admin.harness.worker = null;
      await page.reload();
      await expect(page.getByRole("heading", { level: 2, name: "ยังเริ่มรันไม่ได้" })).toBeVisible();
      await expect(page.getByRole("button", { name: REPORTS[0].name, exact: true })).toBeVisible();
      await audit(page, at("Harness · unavailable (warning tint, reasons)"));
      expectNothingStray(admin);
    });
  }
}
