import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { Review } from "../src/lib/types";
import { dtaReviewFixture, metaReviewFixture, P20_FIXTURES } from "../src/test/fixtures";
import { json, mockApi } from "./mock-api";

// Plan 20 Task 5: results figures in the real app per review type: forest panels per outcome (with the numeric column
// beside each row), the diagnostic-accuracy family, the findings matrix default, the compact literature matrix (table
// from 1024px, cards below), the scoping evidence map and the concept map (outline on a phone). Light and dark, 1440 and
// 390, axe clean, no page-level horizontal scroll. P20_SHOTS=1 also saves screenshots to ../.superpowers/p20-t5/.

const SHOTS = process.env.P20_SHOTS === "1";
const shot = (name: string) => `../.superpowers/p20-t5/${name}.png`;

/** A narrative review with five HRs on one outcome: its forest shows (narrative needs >= 3 effects per outcome). */
const NARRATIVE_FOREST: Review = {
  ...metaReviewFixture, id: "20200000-0000-4000-8000-000000000007",
  result: { ...metaReviewFixture.result!, review_type: "narrative", meta_analysis: null,
    synthesis: { ...metaReviewFixture.result!.synthesis!, evidence_strength: null } },
};

const REVIEWS: Record<string, Review> = {
  slr: P20_FIXTURES.slr, meta: P20_FIXTURES.meta, narrative: NARRATIVE_FOREST, scoping: P20_FIXTURES.scoping, dta: dtaReviewFixture,
  legacy: P20_FIXTURES.legacy,
};

async function open(page: Page, review: Review) {
  await mockApi(page, { [`GET /api/v1/reviews/${review.id}`]: (route) => json(route, 200, review) });
  await page.goto(`/r/${review.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("SLR forest at 1440: numbers sit on their row, SR/MA apart, favours labels and nice ticks", async ({ page }) => {
  await open(page, REVIEWS.slr);
  const panel = page.getByRole("group", { name: /^Forest plot: อุบัติการณ์มะเร็งลำไส้ใหญ่, HR/ });
  await panel.scrollIntoViewIfNeeded();
  for (const ref of ["P1", "P3"]) {
    const row = panel.locator(`[data-forest-row=${ref}]`);
    const marker = (await row.locator("[data-marker]").boundingBox())!;
    const num = (await row.locator(".num-verified").first().boundingBox())!;
    // the verified number is on the same row as its marker, right of the plot
    expect(Math.abs(marker.y + marker.height / 2 - (num.y + num.height / 2))).toBeLessThan(14);
    expect(num.x).toBeGreaterThan(marker.x);
  }
  await expect(panel.locator("[data-block=reviews]")).toContainText("การทบทวนอย่างเป็นระบบ");
  await expect(panel.locator("[data-favours]")).toContainText("เอื้อต่อmetformin");
  const ticks = await panel.locator(".forest-row .tabular-nums").allTextContents();
  expect(ticks).toEqual(["0.5", "1", "2"]);
  // tick labels never overlap
  const boxes = await panel.locator(".forest-row .tabular-nums").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((b) => [b.left, b.right]));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i][0]).toBeGreaterThan(boxes[i - 1][1]);
});

test("meta forest: the pooled lozenge row and its computed block", async ({ page }) => {
  await open(page, REVIEWS.meta);
  const panel = page.getByRole("group", { name: /^Forest plot: ผลลัพธ์หลัก, HR/ });
  const pooled = panel.locator("[data-pooled-row]");
  await expect(pooled.locator("[data-computed=true]").first()).toHaveText("0.96");
  await expect(pooled.locator("[data-lozenge] polygon")).toHaveAttribute("fill", "none");
  await expect(page.locator("[data-pool-stats]").first()).toContainText("k = 3");
});

test("DTA: sensitivity and specificity panels and the DTA table", async ({ page }) => {
  await open(page, REVIEWS.dta);
  await expect(page.getByRole("group", { name: /^ความไว \(sensitivity\)/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /^ความจำเพาะ \(specificity\)/ })).toBeVisible();
  const table = page.getByRole("table", { name: /ความแม่นยำในการวินิจฉัยตามที่แต่ละงานรายงาน/ });
  await expect(table.getByRole("columnheader")).toHaveText(["งานวิจัย", "ความไว (sensitivity)", "ความจำเพาะ (specificity)", "AUC", "n"]);
});

test("findings matrix: k >= 2 by default with show all; literature matrix pages and a scroll cue", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await open(page, REVIEWS.slr);
  const matrix = page.getByRole("table", { name: "ผลแต่ละการศึกษา" });
  await expect(matrix.getByRole("rowheader")).toHaveCount(1);
  await page.getByRole("button", { name: "แสดงทั้งหมด (2)" }).click();
  await expect(matrix.getByRole("rowheader")).toHaveCount(2);
  await expect(page.getByRole("table", { name: "ตารางสรุปงานวิจัย" })).toBeVisible();
});

test("390: literature matrix cards, concept map outline, no page-level scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, REVIEWS.slr);
  await expect(page.locator("[data-lit-cards]")).toBeVisible();
  await expect(page.getByRole("table", { name: "ตารางสรุปงานวิจัย" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "โครงร่างแผนที่ความรู้" })).toBeVisible();
  expect(await noPageScroll(page)).toBeLessThanOrEqual(0);
});

test("scoping evidence map: total second, ramped counts", async ({ page }) => {
  await open(page, REVIEWS.scoping);
  const table = page.getByRole("table", { name: /ตามประเด็นและชนิดงานวิจัย/ });
  await expect(table.getByRole("columnheader").nth(1)).toHaveText("รวม");
  await expect(table.locator("[data-ramp='4']").first()).toBeVisible();
});

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    for (const type of Object.keys(REVIEWS)) {
      test(`${type} at ${width}px, ${scheme}: figures axe clean, no page-level scroll`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await open(page, REVIEWS[type]);
        expect(await noPageScroll(page)).toBeLessThanOrEqual(0);
        const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
        if (!SHOTS) return;
        const style = "header, nav, [class*=sticky] { position: static !important; }";
        for (const [name, sel] of [["charts", "section[aria-labelledby=h-charts]"], ["matrix", "section[aria-labelledby=h-matrix]"],
          ["litmatrix", "section[aria-labelledby=h-litmatrix]"], ["evidencemap", "section[aria-labelledby=h-evidence-map]"],
          ["conceptmap", "section[aria-labelledby=h-map]"], ["sof", "section[aria-labelledby=h-sof]"]] as const) {
          const el = page.locator(sel);
          if (await el.count()) await el.screenshot({ path: shot(`${type}_${name}_${width}_${scheme}`), style });
        }
      });
    }
  }
}
