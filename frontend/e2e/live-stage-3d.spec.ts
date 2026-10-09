import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { reviewFixture } from "../src/test/fixtures";
import { DIRECTION_EVENTS, json, mockApi, RID, streamSse, type SseFrame } from "./mock-api";

type Ev = [string, Record<string, unknown>];

const running = (route: Route) => json(route, 200, { ...reviewFixture, status: "running", result: null });
const PRE_READ: Ev[] = [
  ["queued", { topic: reviewFixture.topic }],
  ["started", { resume: false, elapsed_s: 0.1 }],
  ["checking_topic", { elapsed_s: 0.5 }],
  ["refining", { elapsed_s: 1 }],
  ["question_refined", { refined_question: "คำถามที่ปรับแล้ว", interpretation: "ตีความ", sub_questions: [], assumptions: [], elapsed_s: 4 }],
  ["planning", { queries: ["metformin colorectal cancer"], elapsed_s: 6 }],
  ["searching", { found: 87, elapsed_s: 9 }],
  ["enriching", { candidates: 60, elapsed_s: 11 }],
  ["screening", { batch: 10, elapsed_s: 12 }],
  ["screened", { kept: 30, total: 60, elapsed_s: 16 }],
];
const READING: Ev[] = Array.from({ length: 30 }, (_, i): Ev => ["reading", { ref: `P${i + 1}`, title: `Paper ${i + 1}`, elapsed_s: 17 }]);
const extracted = (i: number): Ev => ["extracted", { ref: `P${i}`, ok: true, verified: 2, uncertain: false, direction: "positive", design: "cohort", elapsed_s: 20 + i }];

const allAtOnce = (): SseFrame[] => [{ delayMs: 0, events: [...PRE_READ, ...READING, ...[1, 2, 3, 4, 5].map(extracted)] }];

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

const toggle = (page: Page) => page.getByRole("button", { name: /^มุมมอง [23]D$/ });
const stage3d = (page: Page) => page.locator("[data-stage3d]");

/** True when this browser can create a WebGL context (SwiftShader normally provides one in headless Chromium). */
async function browserHasWebGL(page: Page) {
  return page.evaluate(() => {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  });
}

async function open(page: Page, frames: SseFrame[]) {
  await streamSse(page, frames);
  await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: running });
  await page.goto(`/r/${RID}`);
  await expect(page.getByRole("img", { name: /เอเจนต์/ })).toBeVisible();
}

/** Turn 3D on and wait until the canvas and the Thai labels are in the DOM. */
async function enable3d(page: Page) {
  await expect(toggle(page)).toHaveText("มุมมอง 3D");
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(stage3d(page).locator("canvas")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => stage3d(page).locator("canvas").evaluate((c) => (c as HTMLCanvasElement).width)).toBeGreaterThan(0);
}

test.describe("3D stage view", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  test("toggle at 1440px swaps the 2D svg for a canvas under the same role=img label, and back", async ({ page }) => {
    await open(page, allAtOnce());
    await expect(page.getByTestId("reader-ok")).toHaveCount(5);
    if (!(await browserHasWebGL(page))) {
      await expect(toggle(page)).toHaveCount(0);
      test.skip(true, "this browser has no WebGL context (no SwiftShader): the toggle is correctly absent, 3D assertions cannot run");
    }
    await expect(page.locator("svg[role=img]")).toBeVisible();
    const label2d = await page.locator("svg[role=img]").getAttribute("aria-label");
    const box2d = (await page.locator("svg[role=img]").boundingBox())!;
    const toggle2d = (await toggle(page).boundingBox())!;
    await enable3d(page);
    // parity: the 3D view takes the 2D stage's box and the toggle stays put in the shared header row
    const box3d = (await stage3d(page).boundingBox())!;
    for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(box3d[k] - box2d[k]), `3D ${k}`).toBeLessThan(2);
    const toggle3d = (await toggle(page).boundingBox())!;
    expect(Math.abs(toggle3d.x + toggle3d.width - toggle2d.x - toggle2d.width)).toBeLessThan(2);
    expect(Math.abs(toggle3d.y - toggle2d.y)).toBeLessThan(2);
    await expect(page.getByRole("list", { name: "ขั้นตอน" })).toBeVisible(); // the shared legend groups
    await expect(page.getByRole("list", { name: "งานวิจัย" })).toBeVisible();
    await expect(page.locator("svg[role=img]")).toHaveCount(0);
    await expect(stage3d(page)).toHaveAttribute("role", "img");
    await expect(stage3d(page)).toHaveAttribute("aria-label", label2d!);
    await expect(stage3d(page).locator("[aria-hidden=true] canvas")).toHaveCount(1); // the R3F wrapper around the canvas is aria-hidden
    // Regression: drei's Html left the first label empty when mounted in the Canvas's first commit.
    const labels = stage3d(page).locator("[data-label3d]");
    await expect.poll(() => labels.count()).toBeGreaterThanOrEqual(10);
    const texts = await labels.evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
    expect(texts.filter((t) => t === "")).toEqual([]);
    await expect(stage3d(page).locator('[data-label3d="guard"]')).toContainText("ตรวจหัวข้อ");
    await expect(page.getByRole("region", { name: "บันทึกการทำงาน" })).toBeVisible(); // the text ledger is untouched

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(toggle(page)).toHaveText("มุมมอง 3D");
    await expect(page.locator("svg[role=img]")).toBeVisible();
    await expect(stage3d(page)).toHaveCount(0);
  });

  test("streamed frames update the 3D wrapper's label while the 3D view stays on", async ({ page }) => {
    await open(page, [
      { delayMs: 0, events: [...PRE_READ, ...READING] },
      { delayMs: 4000, events: [extracted(1), extracted(2)] },
      { delayMs: 1500, events: [extracted(3)] },
    ]);
    if (!(await browserHasWebGL(page))) test.skip(true, "this browser has no WebGL context");
    await enable3d(page);
    const before = await stage3d(page).getAttribute("aria-label");
    await expect.poll(() => stage3d(page).getAttribute("aria-label"), { timeout: 15_000 }).not.toBe(before);
    await expect(page.getByRole("region", { name: "บันทึกการทำงาน" }).getByText("อ่าน P3 เสร็จ")).toBeVisible({ timeout: 15_000 });
    await expect(stage3d(page).locator("canvas")).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("the choice is remembered across a reload", async ({ page }) => {
    await open(page, allAtOnce());
    if (!(await browserHasWebGL(page))) test.skip(true, "this browser has no WebGL context");
    await enable3d(page);
    await page.reload();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(stage3d(page).locator("canvas")).toBeVisible({ timeout: 20_000 });
  });

  test("no horizontal scroll at 1024px with 3D on", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await open(page, allAtOnce());
    if (!(await browserHasWebGL(page))) test.skip(true, "this browser has no WebGL context");
    await enable3d(page);
    const { scrollW, innerW } = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }));
    expect(scrollW).toBeLessThanOrEqual(innerW);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe with 3D on, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "no-preference" });
      await open(page, allAtOnce());
      await expect(page.getByTestId("reader-ok")).toHaveCount(5);
      if (!(await browserHasWebGL(page))) test.skip(true, "this browser has no WebGL context");
      await enable3d(page);
      if (scheme === "dark") {
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 39, 31)");
      }
      await expect(stage3d(page).locator("[aria-hidden]").first()).toBeAttached();
      await noSeriousA11y(page);
    });
  }
});

test("toggle is absent at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page, allAtOnce());
  await expect(page.getByTestId("reader-ok")).toHaveCount(5);
  await expect(toggle(page)).toHaveCount(0);
  await expect(stage3d(page)).toHaveCount(0);
});

test("toggle is absent under reduced motion even at 1440px", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, allAtOnce());
  await expect(page.getByTestId("reader-ok")).toHaveCount(5);
  await expect(toggle(page)).toHaveCount(0);
  await expect(page.locator("svg[role=img]")).toBeVisible();
});

test("a stored 3D preference is ignored where 3D is not allowed (reduced motion)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mra.stage3d", "1"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, allAtOnce());
  await expect(toggle(page)).toHaveCount(0);
  await expect(stage3d(page)).toHaveCount(0);
});

test("3D: thought label and direction piles follow the same events as the board", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page, [{ delayMs: 0, events: [...PRE_READ, ...READING, ...DIRECTION_EVENTS] }]);
  if (!(await browserHasWebGL(page))) test.skip(true, "this browser has no WebGL context");
  const boardCount = async (dir: string) =>
    Number(await page.locator(`section[aria-labelledby="h-evidence"] [data-evidence-dir="${dir}"]`).getAttribute("data-count"));
  await enable3d(page);
  const thought = stage3d(page).locator('[data-label3d="thought"]');
  await expect(thought).toBeAttached({ timeout: 15_000 });
  expect((await thought.textContent())!.trim()).not.toBe("");
  for (const dir of ["positive", "negative", "null", "mixed", "unclear"]) {
    const pile = stage3d(page).locator(`[data-label3d="pile-${dir}"]`);
    await expect(pile, dir).toBeAttached({ timeout: 15_000 });
    await expect(pile.locator("[data-count]"), dir).toHaveText(String(await boardCount(dir)));
  }
  await expect(stage3d(page).locator('[data-label3d="piles"]')).toContainText("ตามที่เอเจนต์อ่าน");
  // parity: no 3D label is ever empty
  const texts = await stage3d(page).locator("[data-label3d]").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
  expect(texts.filter((t) => t === "")).toEqual([]);
});
