import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { TEAM_NARROW_HEIGHT } from "../src/components/review/stage/stage-placeholder";
import { reviewFixture } from "../src/test/fixtures";
import { json, mockApi, RID, streamSse, type SseFrame } from "./mock-api";

// The 2D agent team view (Plan 18), the stage's default view.
type Ev = [string, Record<string, unknown>];

const running = (route: Route) => json(route, 200, { ...reviewFixture, status: "running", result: null });
const QUESTION = "ในผู้ใหญ่ที่เป็นเบาหวาน เมตฟอร์มินลดมะเร็งลำไส้ใหญ่หรือไม่";
const PRE: Ev[] = [
  ["queued", { topic: reviewFixture.topic }],
  ["started", { resume: false, elapsed_s: 0.1 }],
  ["checking_topic", { elapsed_s: 0.5 }],
  ["refining", { elapsed_s: 1 }],
  ["question_refined", { refined_question: QUESTION, interpretation: "ตีความ", sub_questions: [], assumptions: [], elapsed_s: 4 }],
  ["planning", { queries: ["metformin colorectal cancer", "metformin colon", "biguanide CRC"], elapsed_s: 6 }],
  ["searching", { found: 87, elapsed_s: 9 }],
  ["enriching", { candidates: 60, elapsed_s: 11 }],
  ["screening", { batch: 10, elapsed_s: 12 }],
  ["screened", { kept: 30, total: 60, elapsed_s: 16 }],
];
const READING: Ev[] = Array.from({ length: 30 }, (_, i): Ev => ["reading", { ref: `P${i + 1}`, title: `Paper ${i + 1}`, elapsed_s: 17 }]);
const extracted = (i: number, direction = "positive"): Ev =>
  ["extracted", { ref: `P${i}`, ok: true, verified: 2, uncertain: false, direction, design: "cohort", elapsed_s: 20 + i }];
const allAtOnce = (n = 5): SseFrame[] => [{ delayMs: 0, events: [...PRE, ...READING, ...Array.from({ length: n }, (_, i) => extracted(i + 1))] }];
const synthFrames = (): SseFrame[] => [{
  delayMs: 0, events: [...PRE, ...READING, ...Array.from({ length: 30 }, (_, i) => extracted(i + 1)), ["synthesizing", { papers: 30, elapsed_s: 60 }]],
}];

const member = (page: Page, id: string) => page.locator(`[data-member="${id}"]`);
const line = (page: Page, id: string) => member(page, id).locator("[data-line]");
const views = (page: Page) => page.getByRole("group", { name: "มุมมองเวที" });
const viewButton = (page: Page, name: string) => views(page).getByRole("button", { name, exact: true });

async function open(page: Page, frames: SseFrame[]) {
  await streamSse(page, frames);
  await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: running });
  await page.goto(`/r/${RID}`);
  await expect(page.locator("[data-team-stage]")).toBeVisible();
}

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

test("the team view is the default: five named agents, phases and speech follow the streamed events", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const frames: SseFrame[] = [
    { delayMs: 0, events: PRE.slice(0, 3) }, // checking_topic
    { delayMs: 3000, events: [PRE[3]] }, // refining (room for the lazy team chunk to load first)
    { delayMs: 1500, events: [PRE[4]] }, // question_refined
    { delayMs: 1500, events: [PRE[5], PRE[6]] }, // planning, searching
    { delayMs: 1500, events: [PRE[7], PRE[8]] }, // enriching, screening
    { delayMs: 1500, events: [PRE[9], ...READING] }, // screened, reading
    { delayMs: 1500, events: [extracted(1), extracted(2, "negative")] },
  ];
  await open(page, frames);
  await expect(viewButton(page, "ทีมเอเจนต์")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("img", { name: /^ทีมเอเจนต์ 5 คน/ })).toBeVisible();
  for (const id of ["planner", "researcher", "screener", "reader", "synthesizer"]) await expect(member(page, id)).toHaveAttribute("aria-label", /.+: .+/);

  // planner: คิด -> วิเคราะห์ -> วางแผน (quoting the refined question) -> done
  await expect(member(page, "planner")).toHaveAttribute("data-phase", "think");
  await expect(member(page, "planner")).toHaveAttribute("aria-label", "ผู้วางแผน: กำลังคิด");
  await expect(member(page, "planner")).toHaveAttribute("data-phase", "analyse", { timeout: 5000 });
  await expect(member(page, "planner")).toHaveAttribute("data-phase", "plan", { timeout: 5000 });
  await expect(line(page, "planner")).toHaveText(`ตีความคำถามว่า: ${QUESTION}`);
  await expect(member(page, "planner").locator('[aria-current="step"]')).toHaveText("วางแผน");
  await expect(member(page, "planner")).toHaveAttribute("data-status", "done", { timeout: 5000 });
  await expect(line(page, "planner")).toHaveText("วางคำค้น 3 คำ");
  // researcher acts, then the screener scores batches and keeps 30 of 60
  await expect(line(page, "researcher")).toContainText("พบ 87 รายการ", { timeout: 5000 });
  await expect(member(page, "screener")).toHaveAttribute("data-phase", "analyse", { timeout: 5000 });
  await expect(line(page, "screener")).toHaveText(/^ให้คะแนนชุดที่ 1 จาก \d+$/);
  await expect(line(page, "screener")).toHaveText("เลือก 30 จาก 60", { timeout: 5000 });
  // the reader speaks of finished papers only, as the agent read them
  await expect(member(page, "reader")).toHaveAttribute("data-speaking", "1");
  await expect(line(page, "reader")).toHaveText("30 ฉบับกำลังอ่านหรือรอคิว");
  await expect(line(page, "reader")).toContainText("อ่านเสร็จ 2 จาก 30 ฉบับ", { timeout: 5000 });
  await expect(line(page, "reader")).toContainText("ตามที่เอเจนต์อ่าน");
  await expect(member(page, "reader")).toHaveAttribute("data-phase", "act");
  await expect(member(page, "reader").getByTestId("reader-ok")).toHaveCount(2);
  await expect(page.getByText("ขั้นคิด/วิเคราะห์/วางแผน/ลงมือ มาจากเหตุการณ์จริงของระบบ ไม่ใช่ความคิดภายในของโมเดล")).toBeVisible();
});

test("a live hand-off flies a packet with its wake between avatars, and working agents blink and ping", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page, [{ delayMs: 0, events: PRE.slice(0, 9) }, { delayMs: 2500, events: [PRE[9], ...READING] }]);
  await expect(member(page, "screener")).toHaveAttribute("data-status", "working");
  expect(await page.locator("[data-packet]").count()).toBe(0); // history at mount never animates
  await expect(page.locator("[data-team-overlay] [data-packet]").first()).toBeAttached({ timeout: 10_000 });
  await expect(member(page, "screener").locator("[data-eyes]")).toHaveAttribute("data-look", "r"); // glances at the reader
  const running = await page.evaluate(() => ({
    blink: [...document.querySelectorAll("[data-member] .team-blink")].map((e) => e.getAnimations().length),
    ping: [...document.querySelectorAll("[data-member] [data-ping]")].map((e) => e.getAnimations().length),
  }));
  expect(running.blink.some((n) => n > 0)).toBe(true);
  expect(running.ping.some((n) => n > 0)).toBe(true);
});

test("reduced motion: no packets, pings, blinks or typing; final text and states shown", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, [{ delayMs: 0, events: PRE.slice(0, 9) }, { delayMs: 2000, events: [PRE[9], ...READING, extracted(1)] }]);
  await expect(line(page, "reader")).toContainText("อ่านเสร็จ 1 จาก 30 ฉบับ", { timeout: 10_000 });
  await expect(page.locator("[data-packet]")).toHaveCount(0);
  await expect(page.locator("[data-ping]")).toHaveCount(0);
  await expect(page.locator("[data-typing]")).toHaveCount(0);
  const anims = await page.evaluate(() => [...document.querySelectorAll("[data-team-stage] *")].reduce((n, e) => n + e.getAnimations().length, 0));
  expect(anims).toBe(0);
  await expect(member(page, "screener")).toHaveAttribute("data-status", "done");
});

test("switching team / steps / 3D keeps the stage box and the header row, and the choice persists", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page, allAtOnce());
  await expect(member(page, "reader").getByTestId("reader-ok")).toHaveCount(5);
  const box = async () => (await page.getByRole("img", { name: /เอเจนต์/ }).first().boundingBox())!;
  const team = await box();
  const head = (await views(page).boundingBox())!;
  expect(team.width / team.height).toBeCloseTo(960 / 288, 1);
  await viewButton(page, "ขั้นตอน").click();
  await expect(page.locator("svg[role=img][viewBox^='0 0 960 ']")).toBeVisible();
  const steps = (await page.locator("svg[role=img]").boundingBox())!;
  for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(steps[k] - team[k]), `steps ${k}`).toBeLessThan(2);
  const head2 = (await views(page).boundingBox())!;
  expect(Math.abs(head2.y - head.y)).toBeLessThan(2);
  if (await viewButton(page, "3D").count()) {
    await viewButton(page, "3D").click();
    await expect(page.locator("[data-stage3d] canvas")).toBeVisible({ timeout: 20_000 });
    const d3 = (await page.locator("[data-stage3d]").boundingBox())!;
    for (const k of ["y", "width", "height"] as const) expect(Math.abs(d3[k] - team[k]), `3D ${k}`).toBeLessThan(2);
    await viewButton(page, "ขั้นตอน").click();
  }
  await page.reload();
  await expect(viewButton(page, "ขั้นตอน")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-team-stage]")).toHaveCount(0);
  await viewButton(page, "ทีมเอเจนต์").click();
  await expect(page.locator("[data-team-stage]")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-team-stage]")).toBeVisible();
  for (const name of ["ทีมเอเจนต์", "ขั้นตอน"]) {
    const b = (await viewButton(page, name).boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThanOrEqual(44);
  }
});

test("a Plan 12 3D preference falls back to the team view where 3D is not offered", async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("mra.stage3d", "1"); sessionStorage.setItem("seeded", "1"); } });
  await page.emulateMedia({ reducedMotion: "reduce" }); // no 3D under reduced motion
  await open(page, allAtOnce());
  await expect(viewButton(page, "3D")).toHaveCount(0);
  await expect(viewButton(page, "ทีมเอเจนต์")).toHaveAttribute("aria-pressed", "true");
});

for (const width of [1024, 1440]) {
  for (const [name, frames] of [["reading", allAtOnce], ["synthesizing", synthFrames]] as const) {
    test(`wide ${width}px (${name}): every card's content stays inside the constant box; Thai text >= 12px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, frames());
      if (name === "reading") await expect(member(page, "reader").getByTestId("reader-ok")).toHaveCount(5);
      else await expect(member(page, "synthesizer")).toHaveAttribute("data-status", "working");
      await page.evaluate(() => document.fonts.ready);
      const geo = await page.evaluate(() => {
        const boxEl = document.querySelector("[data-stage-box]")!;
        const b = boxEl.getBoundingClientRect();
        const cards = [...document.querySelectorAll("[data-member]")].map((li) => {
          const r = li.getBoundingClientRect();
          const kids = [...li.querySelectorAll("*")].map((k) => k.getBoundingClientRect()).filter((k) => k.width > 0);
          return { id: li.getAttribute("data-member"), top: r.top, bottom: r.bottom, left: r.left, right: r.right,
            maxBottom: Math.max(...kids.map((k) => k.bottom)), maxRight: Math.max(...kids.map((k) => k.right)) };
        });
        const sizes = [...boxEl.querySelectorAll("li span, li p, li li")].filter((e) => (e.textContent ?? "").trim() && !e.closest("svg"))
          .map((e) => parseFloat(getComputedStyle(e).fontSize));
        return { b: { top: b.top, bottom: b.bottom, left: b.left, right: b.right }, cards, minFont: Math.min(...sizes),
          scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
      });
      expect(geo.scrollW).toBeLessThanOrEqual(geo.innerW);
      expect(geo.minFont).toBeGreaterThanOrEqual(12);
      for (const c of geo.cards) {
        expect(c.bottom, `${c.id} card in box`).toBeLessThanOrEqual(geo.b.bottom + 0.5);
        expect(c.maxBottom, `${c.id} content in card`).toBeLessThanOrEqual(c.bottom + 0.5);
        expect(c.maxRight, `${c.id} content right`).toBeLessThanOrEqual(c.right + 0.5);
      }
      // five cards side by side in one row
      expect(new Set(geo.cards.map((c) => Math.round(c.top))).size).toBe(1);
    });
  }
}

test("390px: a vertical list that fits the phone, nothing overflows its card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, allAtOnce(12));
  await expect(member(page, "reader").getByTestId("reader-ok")).toHaveCount(12);
  await page.evaluate(() => document.fonts.ready);
  const geo = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-member]")].map((li) => {
      const r = li.getBoundingClientRect();
      const kids = [...li.querySelectorAll("*")].map((k) => k.getBoundingClientRect()).filter((k) => k.width > 0);
      return { id: li.getAttribute("data-member"), top: r.top, bottom: r.bottom, right: r.right, left: r.left,
        maxRight: Math.max(...kids.map((k) => k.right)), maxBottom: Math.max(...kids.map((k) => k.bottom)) };
    });
    return { cards, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
  });
  expect(geo.scrollW).toBeLessThanOrEqual(geo.innerW);
  for (let i = 1; i < geo.cards.length; i++) expect(geo.cards[i].top).toBeGreaterThan(geo.cards[i - 1].bottom - 0.5); // stacked
  for (const c of geo.cards) {
    expect(c.right, c.id!).toBeLessThanOrEqual(390);
    expect(c.maxRight, `${c.id} content right`).toBeLessThanOrEqual(c.right + 0.5);
    expect(c.maxBottom, `${c.id} content bottom`).toBeLessThanOrEqual(c.bottom + 0.5);
  }
});

test("390px before any paper: the list is as tall as its loading placeholder (no jump when the chunk lands)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, [{ delayMs: 0, events: PRE.slice(0, 3) }]);
  await expect(member(page, "planner")).toHaveAttribute("data-status", "working");
  await page.evaluate(() => document.fonts.ready);
  const h = await page.locator("[data-stage-box]").evaluate((e) => e.getBoundingClientRect().height);
  expect(Math.abs(h - TEAM_NARROW_HEIGHT)).toBeLessThan(24);
});

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`axe: team view at ${width}px, ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 1000 : 844 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await open(page, allAtOnce());
      await expect(member(page, "reader").getByTestId("reader-ok")).toHaveCount(5);
      if (scheme === "dark") {
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 39, 31)");
      }
      await noSeriousA11y(page);
    });
  }
}
