import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { RuntimeVersion, SourcesReport, SourcesState } from "../src/lib/admin-types";
import { NO_SEARXNG, SOURCES, SOURCES_VERSIONS, SOURCES_WORKER } from "../src/test/admin-sources-fixtures";
import { mockApi } from "./mock-api";

/**
 * The admin "แหล่งค้น" page (Plan 23d) against a stateful fake of /api/v1/admin (same origin): sources versions that grow
 * with every save, restore and reset, and a worker that reports the version it runs. A request the fake does not know is
 * answered 404 and listed in `unmocked`; a write without `X-MRA-Admin: 1` is answered 403 and listed in `rejected`.
 */
type Doc = Record<string, boolean>;
const ENV: Doc = Object.fromEntries(SOURCES.sources.map((s) => [s.id, s.env]));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function check(sources: Doc): SourcesReport {
  const on = { ...ENV, ...sources };
  if (!SOURCES.sources.some((s) => s.kind === "searxng" && on[s.id])) {
    return { ok: false, errors: [{ field: "sources", message: NO_SEARXNG }], warnings: [], document: null, enabled: null };
  }
  const document = { sources: Object.fromEntries(Object.entries(sources).filter(([id, v]) => v !== ENV[id])) };
  return { ok: true, errors: [], warnings: on.europepmc ? [] : ["Europe PMC is off, so the Europe PMC RCT search of meta-analyses is off too"],
    document, enabled: SOURCES.sources.filter((s) => on[s.id]).map((s) => s.id) };
}

async function mockSources(page: Page) {
  const calls = { saves: [] as { sources: Doc; base_version: number | null }[], unmocked: [] as string[], rejected: [] as string[] };
  const rows: (RuntimeVersion & { doc: Doc })[] = [{ ...clone(SOURCES_VERSIONS.items[0]), doc: { openaire: false } }];
  const worker = { sources: "1" };
  const append = (doc: Doc, source: RuntimeVersion["source"], restoredFrom: number | null) => {
    const row = { version: rows[0].version + 1, kind: "sources" as const, created_at: new Date().toISOString(), created_by: "owner",
      note: null, source, restored_from: restoredFrom, changes: {}, doc };
    rows.unshift(row);
    const { doc: _doc, ...out } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...out, workers_notified: true };
  };
  const state = (): SourcesState => {
    const on = { ...ENV, ...rows[0].doc };
    return { ...clone(SOURCES), version: rows[0].version,
      sources: SOURCES.sources.map((s) => ({ ...s, enabled: on[s.id], overridden: on[s.id] !== s.env })),
      loaded: [{ ...SOURCES_WORKER, sources: worker.sources, loaded_at: new Date().toISOString() }] };
  };
  await page.route("**/api/v1/admin/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1/admin", "");
    const method = req.method();
    const reply = (status: number, body?: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body ?? {}) });
    if (method !== "GET" && req.headers()["x-mra-admin"] !== "1") {
      calls.rejected.push(`${method} ${path}`);
      return reply(403, { detail: "the X-MRA-Admin: 1 header is required" });
    }
    if (path === "/me") return reply(200, { kind: "user", label: "owner" });
    if (path === "/sources" && method === "GET") return reply(200, state());
    if (path === "/sources/versions" && method === "GET") return reply(200, { items: rows.map(({ doc: _d, ...v }) => v), next: null }); // eslint-disable-line @typescript-eslint/no-unused-vars
    if (path === "/sources/validate" && method === "POST") return reply(200, check((req.postDataJSON() as { sources: Doc }).sources));
    if (path === "/sources" && method === "POST") {
      const body = req.postDataJSON() as { sources: Doc; base_version: number | null };
      calls.saves.push(body);
      if (body.base_version !== rows[0].version) return reply(409, { detail: "a newer version is in use now; reload the latest version and try again" });
      const report = check(body.sources);
      if (!report.ok) return reply(422, { detail: NO_SEARXNG, errors: report.errors });
      return reply(201, append(report.document!.sources, "edit", null));
    }
    const restore = path.match(/^\/sources\/versions\/(\d+)\/restore$/);
    if (restore && method === "POST") {
      const target = rows.find((r) => r.version === Number(restore[1]));
      return target ? reply(201, append(clone(target.doc), "restore", target.version)) : reply(404, { detail: "version not found" });
    }
    if (path === "/sources/reset" && method === "POST") return reply(201, append({}, "reset", null));
    calls.unmocked.push(`${method} ${path}`);
    return reply(404, { detail: `no mock for ${method} ${path}` });
  });
  return { calls, catchUp: () => { worker.sources = String(rows[0].version); } };
}

const sw = (page: Page, name: string) => page.getByRole("switch", { name: new RegExp(`^${name} (เปิด|ปิด)$`) });

async function openSources(page: Page) {
  await page.goto("/admin/sources");
  const link = page.getByRole("navigation", { name: "ผู้ดูแลระบบ" }).getByRole("link", { name: "แหล่งค้น", exact: true });
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "แหล่งค้น" })).toBeVisible();
  await expect(sw(page, "OpenAIRE")).toBeVisible();
}

test("sources: turn ThaiJO off, check, save as version 2, follow the worker, then restore version 1", async ({ page }) => {
  await mockApi(page);
  const admin = await mockSources(page);
  await openSources(page);
  await expect(page.getByText("ใช้เวอร์ชัน 1 จาก DB")).toBeVisible();
  await expect(sw(page, "OpenAIRE")).toHaveAttribute("aria-checked", "false");
  await sw(page, "ThaiJO").click();
  await expect(sw(page, "ThaiJO")).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "ตรวจ", exact: true }).click();
  await expect(page.getByText("จะค้น 7 แหล่ง: PubMed, Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ")).toBeVisible();
  await page.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" }).click();
  await expect(page.getByText("บันทึกเป็นเวอร์ชัน 2 แล้ว")).toBeVisible();
  expect(admin.calls.saves).toEqual([{ sources: { ...ENV, openaire: false, thaijo: false }, base_version: 1 }]);
  await expect(page.getByText("ใช้เวอร์ชัน 2 จาก DB")).toBeVisible();
  await expect(page.getByRole("list", { name: "worker" })).toContainText("กำลังเปลี่ยนเป็น 2");
  admin.catchUp();
  await page.reload();
  await expect(page.getByRole("list", { name: "worker" })).toContainText("ตรงกับที่ใช้งาน");
  await page.getByRole("button", { name: "ประวัติ", exact: true }).click();
  const v1 = page.getByRole("listitem", { name: "เวอร์ชัน 1", exact: true });
  await v1.getByRole("button", { name: "ย้อนกลับไปเวอร์ชัน 1" }).click();
  await page.getByRole("button", { name: "ยืนยันย้อนกลับ" }).click();
  await expect(page.getByText("ใช้เวอร์ชัน 3 จาก DB")).toBeVisible();
  expect(admin.calls.unmocked).toEqual([]);
  expect(admin.calls.rejected).toEqual([]);
});

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

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`sources at ${width}px (${scheme}): at rest, checked, refused, history — no sideways scroll, axe-clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await mockApi(page);
      await mockSources(page);
      const at = (what: string) => `${what} · ${width}px ${scheme}`;
      await page.goto("/admin/sources");
      await expect(sw(page, "OpenAIRE")).toBeVisible();
      await audit(page, at("at rest"));
      await sw(page, "Europe PMC").click();
      await page.getByRole("button", { name: "ตรวจ", exact: true }).click();
      await expect(page.getByText(/Europe PMC RCT search/)).toBeVisible();
      await audit(page, at("checked with a warning"));
      for (const name of ["PubMed", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ"]) await sw(page, name).click();
      await page.getByRole("button", { name: "ตรวจ", exact: true }).click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(NO_SEARXNG);
      await audit(page, at("the minimum refused"));
      await page.getByRole("button", { name: "ประวัติ", exact: true }).click();
      await expect(page.getByRole("listitem", { name: "เวอร์ชัน 1", exact: true })).toBeVisible();
      await audit(page, at("history"));
    });
  }
}
