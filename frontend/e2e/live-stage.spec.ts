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
const traceRows = (page: Page) => page.getByRole("region", { name: "บันทึกการทำงาน" }).locator("[data-trace-row]");

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
    if (i > PRE_READ.length) {
      // The previous frame's packet (700ms travel) has landed before this frame arrives.
      await page.clock.runFor(GAP - 100);
      await expect(packets(page), `no packet before frame ${i + 1}`).toHaveCount(0);
      await page.clock.runFor(100);
    } else {
      await page.clock.runFor(GAP);
    }
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
  expect(await packets(page).count()).toBe(0); // history is marked as seen at mount
  // Waiting on the packet itself (not on the card) so the 700ms flight cannot be missed.
  await expect(packets(page).first()).toBeAttached({ timeout: 10_000 });
  await expect(page.getByTestId("reader-ok")).toHaveCount(4);
});

const loops = (page: Page, sel: string) =>
  page.evaluate((q) => [...document.querySelectorAll(q)].map((el) => el.getAnimations().length), sel);

for (const reduced of [true, false]) {
  test(`${reduced ? "reduced motion" : "control"}: ${reduced ? "no packets, no running loops, final states visible" : "loops do run without the preference"}`, async ({ page }) => {
    const upToEnrich = PRE_READ.slice(0, 8).map((s) => s.ev); // screen is `working` (indeterminate) after `enriching`
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await streamSse(page, [
      { delayMs: 0, events: upToEnrich },
      { delayMs: 3000, events: [PRE_READ[8].ev, PRE_READ[9].ev, ...READING] },
      { delayMs: 1500, events: [1, 2, 3, 4, 5].map(extracted) },
    ]);
    await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: running });
    await page.goto(`/r/${RID}`);

    // Phase 1: an agent is working, so the dashed `.stage-march` outline exists.
    await expect(page.locator('[data-agent="screen"]')).toHaveAttribute("data-status", "working");
    const march = await loops(page, ".stage-march");
    expect(march.length).toBeGreaterThan(0);
    if (reduced) expect(march.every((n) => n === 0)).toBe(true);
    else expect(march.some((n) => n > 0)).toBe(true);

    // Phase 2: readers are reading, so `.stage-pulse` slots exist.
    await expect(page.getByTestId("reader-reading")).toHaveCount(30, { timeout: 10_000 });
    await expect.poll(async () => (await loops(page, ".stage-pulse")).length).toBeGreaterThan(0);
    const pulse = await loops(page, ".stage-pulse");
    if (reduced) expect(pulse.every((n) => n === 0)).toBe(true);
    else expect(pulse.some((n) => n > 0)).toBe(true);

    // Phase 3: papers finish; under reduced motion no packet ever appears and the final states are visible.
    if (reduced) {
      await expect.poll(() => page.getByTestId("reader-ok").count(), { timeout: 15_000 }).toBe(5);
      await expect(packets(page)).toHaveCount(0);
      await expect(page.locator('[data-agent="read"]')).toHaveAttribute("data-status", "active");
      await expect(page.locator('[data-agent="screen"]')).toHaveAttribute("data-status", "done");
    }
  });
}

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

/** Every svg <text> box (CSS px) with its effective font size; refs are the reader-slot labels. */
async function stageText(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector("svg[role=img]") as SVGSVGElement;
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const box = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll("text")].map((t) => {
      const r = t.getBoundingClientRect();
      return {
        text: t.textContent ?? "", ref: !!t.closest('[data-cluster="readers"]'), px: Number(t.getAttribute("font-size")) * scale,
        x0: r.left, y0: r.top, x1: r.right, y1: r.bottom,
      };
    });
    return { texts, box: { x0: box.left, x1: box.right }, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
  });
}

function overlaps(texts: Awaited<ReturnType<typeof stageText>>["texts"]) {
  const bad: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (w > 1 && h > 1) bad.push(`"${a.text}" x "${b.text}" (${w.toFixed(1)}x${h.toFixed(1)})`);
    }
  }
  return bad;
}

const synthFrames = (): SseFrame[] => [{
  delayMs: 0,
  events: [...PRE_READ.map((s) => s.ev), ...READING, ...Array.from({ length: 30 }, (_, i) => extracted(i + 1)), ["synthesizing", { papers: 30, elapsed_s: 60 }]],
}];

for (const width of [390, 900, 1024]) {
  for (const [name, frames] of [["reading", allAtOnce], ["synthesizing", synthFrames]] as const) {
    test(`stage text at ${width}px (${name}): legible sizes, no collisions, no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await streamSse(page, frames());
      await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: running });
      await page.goto(`/r/${RID}`);
      if (name === "reading") await expect(page.getByTestId("reader-ok")).toHaveCount(5);
      else await expect(page.locator('[data-caption="synth"]')).toBeVisible();
      await expect(page.locator("svg[role=img]")).toHaveAttribute("viewBox", width >= 1024 ? /^0 0 960 / : /^0 0 360 /);
      await page.evaluate(() => document.fonts.ready);
      const { texts, box, scrollW, innerW } = await stageText(page);
      expect(scrollW).toBeLessThanOrEqual(innerW);
      // 12px labels on a 360 viewBox drawn 358px wide are 11.93px: allow that rounding, nothing smaller
      for (const t of texts) expect(t.px, `${t.text} font`).toBeGreaterThanOrEqual(t.ref ? 10.9 : 11.9);
      for (const t of texts) {
        expect(t.x0, `${t.text} inside left`).toBeGreaterThanOrEqual(box.x0 - 0.5);
        expect(t.x1, `${t.text} inside right`).toBeLessThanOrEqual(box.x1 + 0.5);
      }
      expect(overlaps(texts)).toEqual([]);
    });
  }
}
