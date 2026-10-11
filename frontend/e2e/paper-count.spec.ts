import { expect, test, type Page, type Route } from "@playwright/test";
import { reviewFixture } from "../src/test/fixtures";
import { json, mockApi, OPEN_STATUS, RID, streamSse, type SseFrame } from "./mock-api";

// Plan 21 Task 4: the paper count (5–50, default 30) comes from /status, and the live stage holds 50 readers.
const SHOTS = process.env.MRA_SHOTS_DIR ?? "test-results/screens/p21-t4";
const shot = (name: string) => `${SHOTS}/${name}.png`;
type Ev = [string, Record<string, unknown>];

const form = (page: Page) => page.getByRole("form", { name: "กำหนดขอบเขตการทบทวน" });
const slider = (page: Page) => form(page).getByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
}

async function formShot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const f = (await form(page).boundingBox())!;
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: shot(name), fullPage: true, clip: { x: Math.max(0, f.x - 8), y: f.y + scrollY - 8, width: f.width + 16, height: f.height + 16 } });
}

test("home: the paper-count slider runs over /status limits and the chosen count is sent", async ({ page }) => {
  let body: Record<string, unknown> | null = null;
  await mockApi(page, {
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: RID, status: "queued", cached: false }); },
  });
  await page.goto("/");
  await form(page).getByText("ตัวเลือกเพิ่มเติม").click();
  const s = slider(page);
  await expect(s).toHaveAttribute("min", String(OPEN_STATUS.limits.max_papers.min));
  await expect(s).toHaveAttribute("max", String(OPEN_STATUS.limits.max_papers.max));
  await expect(s).toHaveValue(String(OPEN_STATUS.limits.max_papers.default));
  await expect(form(page).locator(`[id="${await s.getAttribute("aria-describedby")}"]`))
    .toHaveText(`ระบบคัดกรองราว ${OPEN_STATUS.limits.candidate_limit.default} ฉบับที่มีบทคัดย่อ แล้ววิเคราะห์ฉบับที่เกี่ยวข้องที่สุดตามจำนวนนี้ ถ้าผ่านเกณฑ์ไม่ถึงจะวิเคราะห์เท่าที่มีและแจ้งในรายงาน`);
  const box = (await s.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(16);
  expect((await s.locator("xpath=..").boundingBox())!.height).toBeGreaterThanOrEqual(44); // the 44px target row
  await s.focus();
  await page.keyboard.press("End");
  await expect(s).toHaveValue("50");
  await expect(s).toHaveAttribute("aria-valuetext", "50 ฉบับ");
  await expect(form(page).locator("summary")).toContainText("วิเคราะห์ 50 ฉบับ");
  await page.getByLabel(/คำถามหรือวัตถุประสงค์/).fill("statins and dementia");
  await page.getByRole("button", { name: "ส่งให้เอเจนต์ทบทวน" }).click();
  await expect.poll(() => body).not.toBeNull();
  expect((body as unknown as { options: Record<string, unknown> }).options.max_papers).toBe(50);
});

test("home: when the server cannot read /status, the timeline falls back to number-free wording", async ({ page }) => {
  // the server cannot reach the mock API, so the server-rendered copy uses its number-free wording
  await mockApi(page);
  await page.goto("/");
  const steps = page.getByRole("list", { name: "ขั้นตอนของรีวิว" });
  await expect(steps).toContainText("เลือกฉบับที่เกี่ยวข้องที่สุดตามจำนวนที่คุณกำหนด");
  await expect(steps).not.toContainText("ราว 60");
  await expect(steps).not.toContainText("สูงสุด 30");
});

for (const [name, width, height, scheme] of [["slider-1440", 1440, 1000, "light"], ["slider-390", 390, 844, "light"], ["slider-1440-dark", 1440, 1000, "dark"]] as const) {
  test(`home: the folded options with the slider fit at ${width}px (${scheme})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await mockApi(page);
    await page.goto("/");
    await form(page).getByText("ตัวเลือกเพิ่มเติม").click();
    await expect(slider(page)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await noHorizontalScroll(page);
    if (width >= 1024) { // language, paper count and year still start on one row
      const tops = await Promise.all([
        form(page).getByText("ภาษาของรายงาน"), form(page).getByText("จำนวนงานวิจัยที่ต้องการวิเคราะห์"), form(page).getByText("ตั้งแต่ปี (ไม่บังคับ)"),
      ].map(async (l) => Math.round((await l.boundingBox())!.y)));
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(4);
    }
    await formShot(page, name);
  });
}

// --- the live stage with 50 readers ----------------------------------------------------------------------------------

const running = (route: Route) => json(route, 200, { ...reviewFixture, status: "running", result: null, options: { max_papers: 50 } });
const PRE: Ev[] = [
  ["queued", { topic: reviewFixture.topic }], ["started", { resume: false, elapsed_s: 0.1 }], ["checking_topic", { elapsed_s: 0.5 }],
  ["refining", { elapsed_s: 1 }],
  ["question_refined", { refined_question: "ในผู้ใหญ่ที่เป็นเบาหวาน เมตฟอร์มินลดมะเร็งลำไส้ใหญ่หรือไม่", interpretation: "ตีความ", sub_questions: [], assumptions: [], elapsed_s: 4 }],
  ["planning", { queries: ["metformin colorectal cancer", "metformin colon", "biguanide CRC"], elapsed_s: 6 }],
  ["searching", { found: 187, elapsed_s: 9 }], ["enriching", { candidates: 120, elapsed_s: 11 }],
  ["screening", { batch: 10, elapsed_s: 12 }],
  ["screened", { kept: 50, total: 120, requested: 50, elapsed_s: 16 }],
];
const READING: Ev[] = Array.from({ length: 50 }, (_, i): Ev => ["reading", { ref: `P${i + 1}`, title: `Paper ${i + 1}`, elapsed_s: 17 }]);
const DIRS = ["positive", "negative", "null", "mixed", "unclear"];
const extracted = (i: number): Ev =>
  ["extracted", { ref: `P${i}`, ok: true, verified: 2, uncertain: false, direction: DIRS[i % DIRS.length], design: "cohort", elapsed_s: 20 + i }];
const fifty = (done = 20): SseFrame[] => [{ delayMs: 0, events: [...PRE, ...READING, ...Array.from({ length: done }, (_, i) => extracted(i + 1))] }];

async function openStage(page: Page, view: "team" | "steps" | "3d", frames: SseFrame[] = fifty(), review: (route: Route) => unknown = running) {
  await page.addInitScript((v) => { try { localStorage.setItem("mra.stageView", v); } catch { /* storage blocked */ } }, view);
  await streamSse(page, frames);
  await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: review as (route: Route) => Promise<void> });
  await page.goto(`/r/${RID}`);
}

async function stageShot(page: Page, name: string) {
  const section = page.locator("section[aria-labelledby=h-stage]");
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: shot(name) });
}

for (const [width, height] of [[1440, 1000], [1024, 900]] as const) {
  test(`team view ${width}px: 50 readers in five reserved rows, every card's content inside the grown box`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openStage(page, "team");
    const reader = page.locator('[data-member="reader"]');
    await expect(reader.locator('[data-testid^="reader-"]')).toHaveCount(50, { timeout: 20_000 });
    await expect(reader.getByTestId("reader-ok")).toHaveCount(20);
    await page.evaluate(() => document.fonts.ready);
    const geo = await page.evaluate(() => {
      const boxEl = document.querySelector("[data-stage-box]") as HTMLElement;
      const b = boxEl.getBoundingClientRect();
      const cards = [...document.querySelectorAll("[data-member]")].map((li) => {
        const r = li.getBoundingClientRect();
        const kids = [...li.querySelectorAll("*")].map((k) => k.getBoundingClientRect()).filter((k) => k.width > 0);
        return { id: li.getAttribute("data-member"), bottom: r.bottom, right: r.right,
          maxBottom: Math.max(...kids.map((k) => k.bottom)), maxRight: Math.max(...kids.map((k) => k.right)) };
      });
      const pool = document.querySelector("[data-pool]")!;
      const svgSizes = [...pool.querySelectorAll("text")].map((t) => parseFloat(getComputedStyle(t).fontSize) * (t as SVGTextElement).getScreenCTM()!.a);
      return { aspect: boxEl.style.aspectRatio, bottom: b.bottom, cards, viewBox: pool.getAttribute("viewBox"), minSvgFont: Math.min(...svgSizes) };
    });
    expect(geo.aspect.replace(/\s/g, "")).toBe("960/344");
    expect(geo.viewBox).toBe("0 0 280 140");
    expect(geo.minSvgFont).toBeGreaterThanOrEqual(10.95);
    for (const c of geo.cards) {
      expect(c.bottom, `${c.id} card in box`).toBeLessThanOrEqual(geo.bottom + 0.5);
      expect(c.maxBottom, `${c.id} content in card`).toBeLessThanOrEqual(c.bottom + 0.5);
      expect(c.maxRight, `${c.id} content right`).toBeLessThanOrEqual(c.right + 0.5);
    }
    await noHorizontalScroll(page);
    if (width === 1440) await stageShot(page, "stage-team-50-1440");
  });
}

test("team view 390px: 50 readers fit the phone list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openStage(page, "team");
  const reader = page.locator('[data-member="reader"]');
  await expect(reader.locator('[data-testid^="reader-"]')).toHaveCount(50, { timeout: 20_000 });
  const geo = await reader.evaluate((li) => {
    const r = li.getBoundingClientRect();
    const kids = [...li.querySelectorAll("*")].map((k) => k.getBoundingClientRect()).filter((k) => k.width > 0);
    return { right: r.right, bottom: r.bottom, maxRight: Math.max(...kids.map((k) => k.right)), maxBottom: Math.max(...kids.map((k) => k.bottom)) };
  });
  expect(geo.right).toBeLessThanOrEqual(390);
  expect(geo.maxRight).toBeLessThanOrEqual(geo.right + 0.5);
  expect(geo.maxBottom).toBeLessThanOrEqual(geo.bottom + 0.5);
  await noHorizontalScroll(page);
  await stageShot(page, "stage-team-50-390");
});

for (const [width, height] of [[1440, 1000], [390, 844]] as const) {
  test(`steps view ${width}px: 50 reader slots stay apart and inside the stage`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openStage(page, "steps");
    const svg = page.locator("svg[role=img]").first();
    await expect(svg.locator('[data-testid^="reader-"]')).toHaveCount(50, { timeout: 20_000 });
    const geo = await svg.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const slots = [...el.querySelectorAll('[data-testid^="reader-"]')].map((g) => g.getBoundingClientRect());
      return { b: { left: b.left, right: b.right, top: b.top, bottom: b.bottom }, slots: slots.map((r) => ({ l: r.left, r: r.right, t: r.top, btm: r.bottom })) };
    });
    for (const s of geo.slots) {
      expect(s.l).toBeGreaterThanOrEqual(geo.b.left - 0.5);
      expect(s.r).toBeLessThanOrEqual(geo.b.right + 0.5);
      expect(s.btm).toBeLessThanOrEqual(geo.b.bottom + 0.5);
    }
    await noHorizontalScroll(page);
    await stageShot(page, `stage-steps-50-${width}`);
  });
}

const hasWebGL = (page: Page) => page.evaluate(() => { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") ?? c.getContext("webgl")); });
const allPositive: SseFrame[] = [{ delayMs: 0, events: [...PRE, ...READING, ...Array.from({ length: 50 }, (_, i): Ev =>
  ["extracted", { ref: `P${i + 1}`, ok: true, verified: 2, uncertain: false, direction: "positive", design: "rct", elapsed_s: 20 + i }])] }];

// M1: 20 read (mixed), a full pile (50 tokens in one direction, 9 stacks of 6), and 10 per direction
for (const [name, frames] of [["stage-3d-50-1440", fifty()], ["stage-3d-50-one-pile-1440", allPositive], ["stage-3d-50-ten-each-1440", fifty(50)]] as const) {
  test(`3D view 1440px: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openStage(page, "3d", [...frames]);
    test.skip(!(await hasWebGL(page)), "this browser has no WebGL context");
    await expect(page.locator("[data-stage3d] canvas")).toBeVisible({ timeout: 20_000 });
    // 20 of 50 read: the reader speaks; all 50 read: the synthesizer has taken over
    await expect(page.locator("[data-stage3d]")).toHaveAttribute("aria-label", name === "stage-3d-50-1440" ? /จาก 50/ : /ผู้สังเคราะห์/, { timeout: 20_000 });
    await page.waitForTimeout(4000); // let the tokens land on their piles before the screenshot
    await stageShot(page, name);
  });
}

// I1: one box per run in every view. The default fixture (no max_papers) is the 960/288 box; 50 asked is 960/344.
const defaultReview = (route: Route) => json(route, 200, { ...reviewFixture, status: "running", result: null });
const thirty: SseFrame[] = [{ delayMs: 0, events: [...PRE.slice(0, 9), ["screened", { kept: 30, total: 60, elapsed_s: 16 }], ...READING.slice(0, 30),
  ...Array.from({ length: 5 }, (_, i) => extracted(i + 1))] }];
for (const [label, review, frames, ratio] of [["max_papers 50", running, fifty(), 960 / 344], ["default fixture", defaultReview, thirty, 960 / 288]] as const) {
  test(`switching team / steps / 3D keeps one stage box (${label})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openStage(page, "team", [...frames], review);
    await expect(page.locator('[data-member="reader"] [data-testid="reader-ok"]')).toHaveCount(label === "default fixture" ? 5 : 20, { timeout: 20_000 });
    const views = page.getByRole("group", { name: "มุมมองเวที" });
    const team = (await page.locator("[data-stage-box]").boundingBox())!;
    expect(team.width / team.height).toBeCloseTo(ratio, 2);
    await views.getByRole("button", { name: "ขั้นตอน", exact: true }).click();
    const svg = page.locator("svg[role=img][viewBox^='0 0 960 ']");
    await expect(svg).toBeVisible({ timeout: 20_000 });
    const steps = (await svg.boundingBox())!;
    for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(steps[k] - team[k]), `steps ${k}`).toBeLessThan(2);
    if (await views.getByRole("button", { name: "3D", exact: true }).count()) {
      await views.getByRole("button", { name: "3D", exact: true }).click();
      await expect(page.locator("[data-stage3d] canvas")).toBeVisible({ timeout: 20_000 });
      const d3 = (await page.locator("[data-stage3d]").boundingBox())!;
      for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(d3[k] - team[k]), `3D ${k}`).toBeLessThan(2);
    }
  });
}

test("steps view 1440px with 50 readers while synthesizing: the caption sits under the pool, inside the box (M2)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openStage(page, "steps", [{ delayMs: 0, events: [...PRE, ...READING, ...Array.from({ length: 50 }, (_, i) => extracted(i + 1)),
    ["synthesizing", { papers: 50, elapsed_s: 90 }]] }]);
  const svg = page.locator("svg[role=img][viewBox^='0 0 960 ']");
  await expect(svg.getByTestId("reader-ok")).toHaveCount(50, { timeout: 20_000 });
  await expect(svg).toHaveAttribute("viewBox", "0 0 960 344");
  const cap = svg.locator("[data-caption=synth]");
  await expect(cap).toBeVisible();
  const [c, z, b] = [(await cap.boundingBox())!, (await svg.locator("[data-zone=read]").boundingBox())!, (await svg.boundingBox())!];
  expect(c.y).toBeGreaterThanOrEqual(z.y + z.height - 0.5);
  expect(c.y + c.height).toBeLessThanOrEqual(b.y + b.height + 0.5);
  await stageShot(page, "stage-steps-50-synth-1440");
});
