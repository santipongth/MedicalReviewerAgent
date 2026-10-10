import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { slrReviewFixture } from "../src/test/fixtures";
import { json, mockApi } from "./mock-api";

// A distinct id: the default mock serves reviewFixture (legacy, no citation view) at RID.
const SID = "77777777-1111-2222-3333-444444444444";
const slr = { ...slrReviewFixture, id: SID };

// The citation network (Plan 14b): a fixed-layout graph with a table twin, accessible and without page-level horizontal
// scroll at desktop and phone widths, in both themes.
for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`citation network at ${width}px, ${scheme}: axe clean, no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme });
      await mockApi(page, { [`GET /api/v1/reviews/${SID}`]: (route) => json(route, 200, slr) });
      await page.goto(`/r/${SID}`);
      const section = page.locator("section[aria-labelledby=h-citations]");
      await expect(section.getByRole("heading", { level: 3, name: "เครือข่ายการอ้างอิง" })).toBeVisible();
      await expect(section.getByRole("img", { name: "เครือข่ายการอ้างอิง 5 งานวิจัย 4 เส้นเชื่อม" }).locator("svg")).toBeVisible();
      await expect(section.getByText("ไม่มีข้อมูล ≠ ไม่อ้างอิง")).toBeVisible();
      // the citation network sits in the evidence landscape; the table of contents (xl) or the top nav links the group
      const nav = page.getByRole("navigation", { name: width >= 1280 ? "สารบัญ" : "ในรายงานนี้" });
      await expect(nav.getByRole("link", { name: "ภาพรวมความรู้" })).toHaveAttribute("href", "#h-landscape");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const axe = async () => {
        const r = await new AxeBuilder({ page }).include("section[aria-labelledby=h-citations]").withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      };
      await axe();
      await section.getByRole("button", { name: "ดูเป็นตาราง" }).click();
      await expect(section.getByRole("table", { name: "ตารางการอ้างอิง" })).toBeVisible();
      await axe();
    });
  }
}

test("clicking a node of the graph opens the paper in the rail", async ({ page }) => {
  await mockApi(page, { [`GET /api/v1/reviews/${SID}`]: (route) => json(route, 200, slr) });
  await page.goto(`/r/${SID}`);
  const chart = page.locator("section[aria-labelledby=h-citations]").getByRole("img", { name: /^เครือข่ายการอ้างอิง/ });
  await expect(chart.locator("svg")).toBeVisible();
  // Each node is labelled with its ref, and a click on the label is a click on the node (the label is part of it).
  await chart.locator("svg text", { hasText: /^P4$/ }).click();
  await expect(page.getByRole("complementary", { name: "ต้นฉบับ" })).toContainText("Short-term metformin initiation");
});

test("the citation table twin opens a paper in the rail; the lit matrix shows cited-by counts", async ({ page }) => {
  await mockApi(page, { [`GET /api/v1/reviews/${SID}`]: (route) => json(route, 200, slr) });
  await page.goto(`/r/${SID}`);
  const section = page.locator("section[aria-labelledby=h-citations]");
  await section.getByRole("button", { name: "ดูเป็นตาราง" }).click();
  const table = section.getByRole("table", { name: "ตารางการอ้างอิง" });
  await expect(table.getByRole("row", { name: /^P5/ })).toContainText("ไม่มีข้อมูล");
  await table.getByRole("button", { name: /^P4 / }).click();
  await expect(page.getByRole("complementary", { name: "ต้นฉบับ" })).toContainText("Short-term metformin initiation");
  const matrix = page.getByRole("table", { name: "ตารางสรุปงานวิจัย" });
  await expect(matrix.getByRole("columnheader", { name: "ถูกอ้างอิง" })).toBeVisible();
  await expect(matrix.getByTitle(/OpenAlex/).first()).toBeVisible();
});
