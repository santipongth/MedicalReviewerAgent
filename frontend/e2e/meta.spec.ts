import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { metaReviewFixture } from "../src/test/fixtures";
import { json, mockApi } from "./mock-api";

const MID = metaReviewFixture.id;

// The meta-analysis section (Plan 14b): banner, computed numbers, outlined-lozenge forest plot, inputs disclosure and
// table twin; accessible and without page-level horizontal scroll at desktop and phone widths, in both themes.
for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`meta-analysis section at ${width}px, ${scheme}: axe clean, no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme });
      await mockApi(page, { [`GET /api/v1/reviews/${MID}`]: (route) => json(route, 200, metaReviewFixture) });
      await page.goto(`/r/${MID}`);
      const section = page.locator("section:has(#h-meta)");
      await expect(section.getByText("คำนวณโดยระบบจากตัวเลขที่ตรวจกับบทคัดย่อแล้ว — ไม่ใช่ผลจากงานวิจัยฉบับใด")).toBeVisible();
      await expect(section.getByRole("img", { name: /^0\.96 \(คำนวณโดยระบบ/ }).first()).toBeVisible();
      await expect(section.getByRole("img", { name: /Forest plot ค่ารวม/ })).toBeVisible();
      await section.getByText("วิธีคำนวณ").click();
      await expect(section.getByRole("table", { name: /ตัวเลขที่ใช้คำนวณค่ารวม/ })).toBeVisible();
      await section.getByRole("button", { name: "ดูเป็นตาราง" }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const r = await new AxeBuilder({ page }).include("section:has(#h-meta)").withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    });
  }
}
