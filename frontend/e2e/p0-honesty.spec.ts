import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { metaNoPoolReviewFixture, qualitativeReviewFixture } from "../src/test/fixtures";
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
    await expect(page.locator("[data-computed=true]")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const r = await new AxeBuilder({ page }).include("section[aria-labelledby=h-meta]").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.impact} ${v.id}`)).toEqual([]);
  });
}
