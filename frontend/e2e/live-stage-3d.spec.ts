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

const views = (page: Page) => page.getByRole("group", { name: "มุมมองเวที" });
const toggle = (page: Page) => views(page).getByRole("button", { name: "3D", exact: true });
const stepsButton = (page: Page) => views(page).getByRole("button", { name: "ขั้นตอน", exact: true });
const teamButton = (page: Page) => views(page).getByRole("button", { name: "ทีมเอเจนต์", exact: true });
const stage3d = (page: Page) => page.locator("[data-stage3d]");
// The 3D view shows the agent team, so its parity is checked against the team view (the default): same box, same
// role="img" team summary.
const teamImg = (page: Page) => page.locator("svg[data-team-overlay][role=img]");
const teamBox = (page: Page) => page.locator("[data-stage-box]");
const MEMBERS = ["planner", "researcher", "screener", "reader", "synthesizer"];

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
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(stage3d(page).locator("canvas")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => stage3d(page).locator("canvas").evaluate((c) => (c as HTMLCanvasElement).width)).toBeGreaterThan(0);
}

test.describe("3D stage view", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  test("toggle at 1440px swaps the team cards for the team in 3D under the same role=img label and box, and back", async ({ page }) => {
    await open(page, allAtOnce());
    if (!(await browserHasWebGL(page))) {
      await expect(toggle(page)).toHaveCount(0);
      test.skip(true, "this browser has no WebGL context (no SwiftShader): the toggle is correctly absent, 3D assertions cannot run");
    }
    await expect(teamImg(page)).toBeAttached();
    const labelTeam = await teamImg(page).getAttribute("aria-label");
    expect(labelTeam).toMatch(/^ทีมเอเจนต์ 5 คน/);
    const boxTeam = (await teamBox(page).boundingBox())!;
    const toggleTeam = (await views(page).boundingBox())!;
    await enable3d(page);
    // parity: the 3D view takes the team view's box and the view buttons stay put in the shared header row
    const box3d = (await stage3d(page).boundingBox())!;
    for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(box3d[k] - boxTeam[k]), `3D ${k}`).toBeLessThan(2);
    const toggle3d = (await views(page).boundingBox())!;
    expect(Math.abs(toggle3d.x + toggle3d.width - toggleTeam.x - toggleTeam.width)).toBeLessThan(2);
    expect(Math.abs(toggle3d.y - toggleTeam.y)).toBeLessThan(2);
    await expect(page.getByRole("list", { name: "ขั้นคิด" })).toBeVisible(); // the team's phase legend (tile variant)
    await expect(page.locator("[data-phase-note]")).toHaveText("ขั้นคิด/วิเคราะห์/วางแผน/ลงมือ มาจากเหตุการณ์จริงของระบบ ไม่ใช่ความคิดภายในของโมเดล");
    await expect(teamImg(page)).toHaveCount(0);
    await expect(stage3d(page)).toHaveAttribute("role", "img");
    await expect(stage3d(page)).toHaveAttribute("aria-label", labelTeam!);
    await expect(stage3d(page).locator("[aria-hidden=true] canvas")).toHaveCount(1); // the R3F wrapper around the canvas is aria-hidden
    // Regression: drei's Html left the first label empty when mounted in the Canvas's first commit.
    const labels = stage3d(page).locator("[data-label3d]");
    await expect.poll(() => labels.count()).toBeGreaterThanOrEqual(5);
    const texts = await labels.evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
    expect(texts.filter((t) => t === "")).toEqual([]);
    for (const id of MEMBERS) await expect(stage3d(page).locator(`[data-label3d="${id}"]`), id).toBeAttached();
    await expect(stage3d(page).locator('[data-label3d="planner"]')).toContainText("ผู้วางแผน");
    // the speaker (the reader, mid-read) has the only bubble, its line from the events; Thai labels are >= 12px DOM text
    const bubble = stage3d(page).locator('[data-label3d="bubble"]');
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toHaveAttribute("data-member", "reader");
    await expect(bubble).toContainText("อ่านเสร็จ 5 จาก 30");
    const sizes = await labels.evaluateAll((els) => els.flatMap((e) =>
      [e, ...e.querySelectorAll("*")].filter((n) => (n.textContent ?? "").trim() !== "" && n.children.length === 0)
        .map((n) => parseFloat(getComputedStyle(n).fontSize))));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
    await expect(page.getByRole("region", { name: "บันทึกการทำงาน" })).toBeVisible(); // the text ledger is untouched

    await stepsButton(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(stepsButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("svg[role=img]")).toBeVisible();
    await expect(stage3d(page)).toHaveCount(0);
    // box constancy across all three views
    const boxSteps = (await page.locator("svg[role=img]").boundingBox())!;
    expect(Math.abs(boxSteps.height - box3d.height)).toBeLessThan(2);
    await teamButton(page).click();
    await expect(teamImg(page)).toBeAttached();
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

  // The bubble is DOM text of a fixed pixel size over a scene that scales with the stage; drei's container clips what
  // sticks out. At the narrowest offered width (1024) a 3-line bubble must still sit inside the stage box.
  const longQuestion = "ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่สองและมีภาวะอ้วนร่วมด้วย การใช้เมตฟอร์มินต่อเนื่องระยะยาวช่วยลดความเสี่ยงการเกิดมะเร็งลำไส้ใหญ่และไส้ตรงเมื่อเทียบกับการใช้ยาลดน้ำตาลกลุ่มอื่นหรือไม่";
  const bubbleCases: { name: string; speaker: string; frames: () => SseFrame[] }[] = [
    {
      name: "planner (refined question)", speaker: "planner",
      frames: () => [{ delayMs: 0, events: [
        PRE_READ[0], PRE_READ[1], PRE_READ[2], PRE_READ[3],
        ["question_refined", { refined_question: longQuestion, interpretation: "ตีความ", sub_questions: [], assumptions: [], elapsed_s: 4 }],
      ] }],
    },
    {
      name: "reader (uncertain SR/MA of observational studies)", speaker: "reader",
      frames: () => [{ delayMs: 0, events: [
        ...PRE_READ, ...READING.slice(0, 12),
        ...Array.from({ length: 11 }, (_, i): Ev => extracted(i + 1)),
        ["extracted", { ref: "P12", ok: true, verified: 2, uncertain: true, direction: "mixed", design: "sr_ma_observational", elapsed_s: 40 }],
      ] }],
    },
  ];
  for (const c of bubbleCases) {
    test(`a 3-line bubble stays inside the stage at 1024px: ${c.name}`, async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 900 });
      await open(page, c.frames());
      if (!(await browserHasWebGL(page))) test.skip(true, "this browser has no WebGL context");
      await enable3d(page);
      const bubble = stage3d(page).locator('[data-label3d="bubble"]');
      await expect(bubble).toHaveAttribute("data-member", c.speaker, { timeout: 15_000 });
      await expect(bubble.locator("p")).not.toHaveText("");
      // let the camera settle on the speaker (it eases while the goal changes)
      await expect.poll(async () => {
        const [b, s] = [await bubble.boundingBox(), await stage3d(page).boundingBox()];
        return b && s ? b.y - s.y : -1;
      }, { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
      await page.waitForTimeout(800);
      const b = (await bubble.boundingBox())!;
      const s = (await stage3d(page).boundingBox())!;
      expect(b.height, "the line wraps to three lines").toBeGreaterThan(60);
      expect(b.y).toBeGreaterThanOrEqual(s.y);
      expect(b.y + b.height).toBeLessThanOrEqual(s.y + s.height);
      expect(b.x).toBeGreaterThanOrEqual(s.x);
      expect(b.x + b.width).toBeLessThanOrEqual(s.x + s.width);
    });
  }

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

test("the 3D button is absent at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page, allAtOnce());
  await expect(page.getByTestId("reader-ok")).toHaveCount(5);
  await expect(toggle(page)).toHaveCount(0);
  await expect(stage3d(page)).toHaveCount(0);
});

test("the 3D button is absent under reduced motion even at 1440px", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, allAtOnce());
  await expect(page.getByTestId("reader-ok")).toHaveCount(5);
  await expect(toggle(page)).toHaveCount(0);
  await expect(page.locator("svg[role=img]")).toBeVisible();
});

test("a stored 3D preference is ignored where 3D is not allowed (reduced motion)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mra.stageView", "3d")); // runs after the beforeEach "steps"
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, allAtOnce());
  await expect(toggle(page)).toHaveCount(0);
  await expect(stage3d(page)).toHaveCount(0);
});

test("3D: the speaker's bubble and the direction piles on the table follow the same events as the board", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page, [{ delayMs: 0, events: [...PRE_READ, ...READING, ...DIRECTION_EVENTS] }]);
  if (!(await browserHasWebGL(page))) test.skip(true, "this browser has no WebGL context");
  const boardCount = async (dir: string) =>
    Number(await page.locator(`section[aria-labelledby="h-evidence"] [data-evidence-dir="${dir}"]`).getAttribute("data-count"));
  await enable3d(page);
  const bubble = stage3d(page).locator('[data-label3d="bubble"]');
  await expect(bubble).toBeAttached({ timeout: 15_000 });
  await expect(bubble).toContainText("อ่านเสร็จ 8 จาก 30 ฉบับ"); // the reader speaks from the finished papers only
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
