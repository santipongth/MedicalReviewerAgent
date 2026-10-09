import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { reviewFixture } from "../src/test/fixtures";
import { json, mockApi, RID, streamSse, type SseFrame } from "./mock-api";

type Ev = [string, Record<string, unknown>];

const ref = (i: number) => `P${i}`;
const running = (route: Route) => json(route, 200, { ...reviewFixture, status: "running", result: null });
const REFINED: Ev = ["question_refined", { refined_question: "คำถามที่ปรับแล้ว", interpretation: "ตีความ", sub_questions: [], assumptions: [], elapsed_s: 4 }];

const PRE_READ: { ev: Ev; agent: string; status: string }[] = [
  { ev: ["queued", { topic: reviewFixture.topic }], agent: "guard", status: "idle" },
  { ev: ["started", { resume: false, elapsed_s: 0.1 }], agent: "guard", status: "idle" },
  { ev: ["checking_topic", { elapsed_s: 0.5 }], agent: "guard", status: "active" },
  { ev: ["refining", { elapsed_s: 1 }], agent: "refine", status: "active" },
  { ev: REFINED, agent: "refine", status: "done" },
  { ev: ["planning", { queries: ["metformin colorectal cancer", "metformin colon"], elapsed_s: 6 }], agent: "search", status: "working" },
  { ev: ["searching", { found: 87, elapsed_s: 9 }], agent: "enrich", status: "working" },
  { ev: ["enriching", { candidates: 60, elapsed_s: 11 }], agent: "screen", status: "working" },
  { ev: ["screening", { batch: 10, elapsed_s: 12 }], agent: "screen", status: "active" },
  { ev: ["screened", { kept: 30, total: 60, elapsed_s: 16 }], agent: "read", status: "working" },
];
const READING: Ev[] = Array.from({ length: 30 }, (_, i): Ev => ["reading", { ref: ref(i + 1), title: `Paper ${i + 1}`, elapsed_s: 17 }]);
const extracted = (i: number): Ev => ["extracted", { ref: ref(i), ok: true, verified: 2, uncertain: false, elapsed_s: 20 + i }];

/** One frame per event (the 30 `reading` events arrive together, as at fan-out), `gap` ms apart. */
function timeline(gap: number) {
  const frames: SseFrame[] = PRE_READ.map((s) => ({ delayMs: gap, events: [s.ev] }));
  const expected = PRE_READ.map((s) => ({ agent: s.agent, status: s.status }));
  frames.push({ delayMs: gap, events: READING });
  expected.push({ agent: "read", status: "active" });
  for (let i = 1; i <= 5; i++) {
    frames.push({ delayMs: gap, events: [extracted(i)] });
    expected.push({ agent: "read", status: "active" });
  }
  return { frames, expected };
}

/** Everything in one frame, delivered immediately. */
const allAtOnce = (): SseFrame[] => [{ delayMs: 0, events: [...PRE_READ.map((s) => s.ev), ...READING, ...[1, 2, 3, 4, 5].map(extracted)] }];

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

const packets = (page: Page) => page.locator("[data-packet]");
const traceRows = (page: Page) => page.getByRole("region", { name: "บันทึกการทำงาน" }).locator("ol li");

test("real-time progression: statuses, packets and trace follow each streamed frame", async ({ page }) => {
  const GAP = 1000;
  const LEAD = 20_000; // generous boot time before the first frame
  const { frames, expected } = timeline(GAP);
  // The page boots on the flowing fake clock (hydration and the lazy stage chunk need timers); once the stage is up
  // the clock is paused, so from here only runFor() moves time and each frame lands exactly when it is released.
  await page.clock.install({ time: new Date("2026-10-09T08:00:00Z") });
  await streamSse(page, [{ ...frames[0], delayMs: LEAD }, ...frames.slice(1)]);
  await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: running });
  await page.goto(`/r/${RID}`);
  await expect(page.getByRole("img", { name: /เอเจนต์/ })).toBeVisible();
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1500));
  const [now, started] = await page.evaluate(() => [Date.now(), (window as unknown as { __sseStart: number }).__sseStart]);
  await page.clock.runFor(LEAD - (now - started) - GAP); // park one GAP before the first frame
  expect(await traceRows(page).count()).toBe(0);

  let rows = await traceRows(page).count();
  for (const [i, step] of expected.entries()) {
    await page.clock.runFor(GAP);
    await expect(page.locator(`[data-agent="${step.agent}"]`), `frame ${i + 1}`).toHaveAttribute("data-status", step.status);
    await expect(traceRows(page), `trace after frame ${i + 1}`).toHaveCount(rows + 1);
    rows += 1;
    if (i > PRE_READ.length) await expect(packets(page).first(), `packet after extracted frame ${i + 1}`).toBeAttached();
  }
  await expect(page.getByTestId("reader-ok")).toHaveCount(5);
  await expect(page.getByTestId("reader-waiting")).toHaveCount(0);
  // The last frame was an `extracted`: its card packet is in flight, and gone once the travel time has passed.
  await expect(packets(page).first()).toBeAttached();
  await page.clock.runFor(1200);
  await expect(packets(page)).toHaveCount(0);
});

test("burst then live: replayed history shows final states at once, only live events animate", async ({ page }) => {
  await streamSse(page, [
    { delayMs: 0, events: [...PRE_READ.map((s) => s.ev), ...READING, ...[1, 2, 3].map(extracted)] },
    { delayMs: 2500, events: [extracted(4)] },
  ]);
  await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: running });
  await page.goto(`/r/${RID}`);
  await expect(page.getByTestId("reader-ok")).toHaveCount(3);
  await expect(page.locator('[data-agent="read"]')).toHaveAttribute("data-status", "active");
  await expect(page.locator('[data-agent="screen"]')).toHaveAttribute("data-status", "done");
  await expect(page.locator('[data-agent="refine"]')).toHaveAttribute("data-status", "done");
  expect(await packets(page).count()).toBeLessThanOrEqual(24);
  expect(await packets(page).count()).toBe(0); // history is marked as seen at mount
  await expect(page.getByTestId("reader-ok")).toHaveCount(4, { timeout: 10_000 });
  await expect(packets(page).first()).toBeAttached();
});

test("reduced motion: no packets, no running loops, final states visible", async ({ page }) => {
  const { frames } = timeline(300);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await streamSse(page, frames);
  await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: running });
  await page.goto(`/r/${RID}`);
  for (let i = 0; i < 20; i++) {
    expect(await packets(page).count()).toBe(0);
    if ((await page.getByTestId("reader-ok").count()) === 5) break;
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId("reader-ok")).toHaveCount(5);
  await expect(page.locator('[data-agent="read"]')).toHaveAttribute("data-status", "active");
  await expect(page.locator('[data-agent="screen"]')).toHaveAttribute("data-status", "done");
  await expect(packets(page)).toHaveCount(0);
  const animations = await page.evaluate(() => [...document.querySelectorAll(".stage-march, .stage-pulse")].map((el) => el.getAnimations().length));
  expect(animations.every((n) => n === 0)).toBe(true);
});

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`axe: agent stage at ${width}px, ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 1000 : 844 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); // no mid-fade colour sampling
      await streamSse(page, allAtOnce());
      await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: running });
      await page.goto(`/r/${RID}`);
      await expect(page.getByTestId("reader-ok")).toHaveCount(5);
      if (scheme === "dark") {
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 39, 31)");
      }
      await noSeriousA11y(page);
    });
  }
}

test("narrow geometry: the stage fits 390px and keeps its reader and synthesis labels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await streamSse(page, allAtOnce());
  await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: running });
  await page.goto(`/r/${RID}`);
  const svg = page.getByRole("img", { name: /เอเจนต์/ });
  await expect(svg).toBeVisible();
  const box = await svg.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await expect(svg.getByText("ผู้อ่าน", { exact: true })).toBeVisible();
  await expect(svg.getByText("สังเคราะห์", { exact: true })).toBeVisible();
});
