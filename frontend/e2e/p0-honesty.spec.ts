import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { Direction, Paper, Review } from "../src/lib/types";
import { metaNoPoolReviewFixture, qualitativeReviewFixture, reviewFixture } from "../src/test/fixtures";
import { json, mockApi } from "./mock-api";

// Plan 20 Task 2 (P0 honesty), in the real app at desktop width in both themes.
const QID = qualitativeReviewFixture.id;
const MID = metaNoPoolReviewFixture.id;
const DIRECTIONS = ["สนับสนุนผล", "ตรงข้าม/อันตราย", "ไม่มีความสัมพันธ์", "ผสม", "ไม่ชัด"];

for (const scheme of ["light", "dark"] as const) {
  test(`qualitative report, ${scheme}: no direction glyph or label for theme studies anywhere`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    await mockApi(page, { [`GET /api/v1/reviews/${QID}`]: (route) => json(route, 200, qualitativeReviewFixture) });
    await page.goto(`/r/${QID}`);

    // findings matrix: the theme row counts studies, its cells are "found" marks, not direction glyphs
    const matrix = page.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    await expect(matrix.getByRole("rowheader", { name: /ความกลัวการฉีดยา/ })).toContainText("พบใน 2 การศึกษา");
    for (const ref of ["P1", "P2"]) {
      const cell = matrix.getByRole("button", { name: new RegExp(`^${ref}: ความกลัวการฉีดยา`) });
      await expect(cell).toHaveAttribute("aria-label", /พบประเด็นนี้/);
      await expect(cell.locator(".g")).toHaveCount(0);
    }

    // paper list and literature matrix
    const papers = page.locator("section:has(#h-papers)");
    for (const ref of ["P1", "P2"]) {
      const item = papers.getByRole("button", { name: new RegExp(`^${ref} `) });
      await expect(item.locator(".g")).toHaveCount(0);
      await expect(item).toContainText("สรุปเป็นประเด็น ไม่มีทิศทางผล");
    }
    const lit = page.getByRole("table", { name: "ตารางสรุปงานวิจัย" });
    const litRow = lit.locator("tr", { has: page.getByRole("button", { name: /^P1 / }) });
    await expect(litRow.locator(".g")).toHaveCount(0);

    // the bottom-line tally counts only the quantitative papers
    const summary = page.locator("section[aria-labelledby=h-answer]");
    await expect(summary.getByText(/งานเชิงคุณภาพหรือแบบผสมผสาน 2 ฉบับ/)).toBeVisible();

    // the source rail for a theme paper: no glyph, no direction words, an honest "no number" line
    await papers.getByRole("button", { name: /^P1 / }).click();
    const rail = page.getByRole("complementary", { name: /ต้นฉบับ/ });
    await expect(rail.getByText("ประเด็นจากงานเชิงคุณภาพ ไม่มีค่าตัวเลข")).toBeVisible();
    await expect(rail.locator(".g")).toHaveCount(0);
    for (const word of DIRECTIONS) await expect(rail.getByText(word, { exact: true })).toHaveCount(0);

    // a quantitative outcome without an extracted number is "not extracted", not "reports no number"
    await papers.getByRole("button", { name: /^P4 / }).click();
    await expect(rail.getByText("ไม่ได้สกัดตัวเลข (ดูประโยคต้นฉบับ)")).toBeVisible();

    // summary prose: plain text, no verified styling on its "20%"
    await expect(summary.locator("[data-prose] .num-verified, [data-prose] .num-computed")).toHaveCount(0);

    // the legend explains the theme mark; axe below covers it, the matrix and the whole page in this theme
    await expect(page.getByText("ประเด็นจากงานเชิงคุณภาพ/ผสมผสาน (ไม่มีทิศทางผล)")).toBeVisible();
    expect(await martianOutsideVerified(page)).toEqual([]);

    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });

  test(`meta-analysis with no pools, ${scheme}: says it could not pool, no computed banner`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    await mockApi(page, { [`GET /api/v1/reviews/${MID}`]: (route) => json(route, 200, metaNoPoolReviewFixture) });
    await page.goto(`/r/${MID}`);
    await expect(page.getByLabel("ข้อมูลรายงาน")).toContainText("การวิเคราะห์อภิมาน (รวมผลไม่ได้)");
    await expect(page.locator("section[aria-labelledby=h-answer]").getByText("การวิเคราะห์อภิมาน (รวมผลไม่ได้)")).toBeVisible();
    const section = page.locator("section[aria-labelledby=h-meta]");
    await expect(section.getByRole("heading", { name: "การวิเคราะห์อภิมาน: รวมผลไม่ได้" })).toBeVisible();
    await expect(section.getByText(/อย่างน้อย 3 ฉบับต่อผลลัพธ์/)).toBeVisible();
    await expect(section.getByText(/ไม่ใช่ผลจากงานวิจัยฉบับใด/)).toHaveCount(0);
    await expect(section.getByText(/ค่ารวมข้างบน/)).toHaveCount(0);
    // no pooled value anywhere: the only computed numbers are the summary-of-findings participant sums
    await expect(page.locator("[data-computed=true]:not([data-participants] [data-computed=true])")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // the whole page: the title-block chip, the bottom-line warn chip and the section
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });

  test(`meta-analysis whose pooling failed, ${scheme}: says 'failed', never 'fewer than 3 studies'`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    const failed = { ...metaNoPoolReviewFixture, result: { ...metaNoPoolReviewFixture.result!, meta_analysis: null } };
    await mockApi(page, { [`GET /api/v1/reviews/${MID}`]: (route) => json(route, 200, failed) });
    await page.goto(`/r/${MID}`);
    await expect(page.getByLabel("ข้อมูลรายงาน")).toContainText("การวิเคราะห์อภิมาน (รวมผลไม่สำเร็จ)");
    const answer = page.locator("section[aria-labelledby=h-answer] [data-not-pooled=failed]");
    await expect(answer).toContainText("ขั้นตอนรวมผลทำงานไม่สำเร็จ");
    await expect(answer).not.toContainText("3 ฉบับ");
    await expect(page.getByRole("heading", { name: "การวิเคราะห์อภิมาน: ค่ารวมไม่สำเร็จ" })).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });

  test(`charts as rendered, ${scheme}: the flat bar stands out from its CI line; ticks are tabular display face`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    await mockApi(page, { [`GET /api/v1/reviews/${GLYPH_REVIEW.id}`]: (route) => json(route, 200, GLYPH_REVIEW) });
    await page.goto(`/r/${GLYPH_REVIEW.id}`);
    // Plan 20 Task 5: the forest is a DOM panel per outcome; markers are the shared glyph paths as rendered
    const forest = page.getByRole("group", { name: /^Forest plot: CRC incidence, HR/ });
    await expect(forest.locator("[data-marker=null] path")).toBeAttached();
    await forest.scrollIntoViewIfNeeded();
    const geometry = await forest.evaluate((el) => {
      const svg = el.querySelector("[data-marker=null]") as SVGSVGElement;
      const path = svg.querySelector("path")!;
      const b = svg.getBoundingClientRect();
      const ci = el.querySelector("[data-forest-row=P6] [data-ci]")!.getBoundingClientRect();
      const cs = getComputedStyle(path);
      return { w: b.width, h: b.height, ci: ci.height, halo: parseFloat(cs.strokeWidth), stroke: cs.stroke,
        fill: cs.fill, none: getComputedStyle(document.documentElement).getPropertyValue("--none").trim() };
    });
    expect(geometry.w).toBeGreaterThan(geometry.h * 2); // a flat bar, not a dot
    expect(geometry.h).toBeGreaterThanOrEqual(5); // well over the 2px CI line
    expect(geometry.h).toBeGreaterThan(geometry.ci * 2);
    expect(geometry.halo).toBeGreaterThanOrEqual(2); // a surface outline that cuts the same-coloured line
    expect(geometry.stroke).not.toBe("none");
    const ticks = await forest.locator(".tabular-nums").evaluateAll((els) => els.map((t) => {
      const cs = getComputedStyle(t);
      return { family: cs.fontFamily, features: cs.fontFeatureSettings, numeric: cs.fontVariantNumeric };
    }));
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(`${t.features} ${t.numeric}`).toMatch(/tnum|tabular-nums/);
      expect(t.family).not.toMatch(/martian|monospace/i);
    }
    expect(await martianOutsideVerified(page)).toEqual([]);
  });
}

/** Every element set in Martian Mono that is not a verified number (or inside one): must be empty. */
function martianOutsideVerified(page: Page) {
  return page.evaluate(() => [...document.body.querySelectorAll("*")]
    .filter((el) => /martian/i.test(getComputedStyle(el).fontFamily) && !el.closest(".num-verified"))
    .map((el) => `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(" ").slice(0, 3).join(".")}: ${el.textContent?.slice(0, 30)}`));
}

/** An SLR whose forest plot has every direction, including the flat-bar "no association". */
function withDir(p: Paper, ref: string, dir: Direction, year: number): Paper {
  const c = p.card_en!;
  const card = { ...c, overall_direction: dir, outcomes: c.outcomes.map((o, i) => (i === 0 ? { ...o, direction: dir } : o)) };
  return { ...p, ref, year, card, card_en: card };
}
const PS = reviewFixture.result!.papers!;
const GLYPH_ROW = { outcome: "CRC incidence", cells: ([["P1", "mixed"], ["P2", "positive"], ["P3", "positive"], ["P4", "negative"], ["P6", "null"], ["P7", "unclear"]] as const)
  .map(([ref, direction]) => ({ ref, finding: "x", direction })) };
const GLYPH_REVIEW: Review = {
  ...reviewFixture, id: "99999999-0000-1111-2222-333333333333",
  result: {
    ...reviewFixture.result!, review_type: "slr",
    papers: [withDir(PS[0], "P1", "mixed", 2019), PS[1], withDir(PS[2], "P3", "positive", 2021), PS[3],
      withDir(PS[2], "P6", "null", 2016), withDir(PS[2], "P7", "unclear", 2023)],
    // the forest groups by the summary-of-findings rows (Plan 20 Task 5): one English row the cards' outcome matches
    synthesis: { ...reviewFixture.result!.synthesis!, comparison: [GLYPH_ROW] },
    synthesis_en: { ...reviewFixture.result!.synthesis_en!, comparison: [GLYPH_ROW] },
  },
};
