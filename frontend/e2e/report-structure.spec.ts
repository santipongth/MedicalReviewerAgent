import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { P20_FIXTURES } from "../src/test/fixtures";
import type { Review } from "../src/lib/types";
import { json, mockApi } from "./mock-api";

// Plan 20 Task 3: the answer-first report in the real app, per review type: the section order and the table of
// contents (from 1280px), the top nav with an edge fade below it, no page-level horizontal scroll at 390px, and axe
// clean in light and dark at 1440 and 390.

const ORDER: Record<keyof typeof P20_FIXTURES, string[]> = {
  slr: ["คำตอบ", "ผลสำคัญ", "ตารางสรุปผล", "การคัดเลือก", "ลักษณะงานวิจัย", "ผลลัพธ์", "ตรงกัน/ขัดกัน", "ภาพรวมความรู้", "ข้อจำกัด",
    "สิ่งที่ยังไม่รู้", "อภิปราย", "วิธีการ", "งานวิจัยที่อ่าน", "ดาวน์โหลด"],
  meta: ["คำตอบ", "ผลสำคัญ", "ตารางสรุปผล", "การคัดเลือก", "ลักษณะงานวิจัย", "ผลลัพธ์", "ตรงกัน/ขัดกัน", "ภาพรวมความรู้", "ข้อจำกัด",
    "สิ่งที่ยังไม่รู้", "อภิปราย", "วิธีการ", "งานวิจัยที่อ่าน", "ดาวน์โหลด"],
  metaNoPool: ["คำตอบ", "ผลสำคัญ", "ตารางสรุปผล", "การคัดเลือก", "ลักษณะงานวิจัย", "ผลลัพธ์", "ตรงกัน/ขัดกัน", "ภาพรวมความรู้", "ข้อจำกัด",
    "สิ่งที่ยังไม่รู้", "อภิปราย", "วิธีการ", "งานวิจัยที่อ่าน", "ดาวน์โหลด"],
  scoping: ["คำตอบ", "ผลสำคัญ", "การคัดเลือก", "ลักษณะงานวิจัย", "ภาพรวมความรู้", "ข้อจำกัด", "สิ่งที่ยังไม่รู้", "อภิปราย", "วิธีการ",
    "งานวิจัยที่อ่าน", "ดาวน์โหลด"],
  narrative: ["คำตอบ", "ผลสำคัญ", "ลักษณะงานวิจัย", "ผลลัพธ์", "ตรงกัน/ขัดกัน", "ภาพรวมความรู้", "ข้อจำกัด", "สิ่งที่ยังไม่รู้", "อภิปราย",
    "วิธีการ", "งานวิจัยที่อ่าน", "ดาวน์โหลด"],
  legacy: ["คำตอบ", "การคัดเลือก", "ผลลัพธ์", "ตรงกัน/ขัดกัน", "ข้อจำกัด", "สิ่งที่ยังไม่รู้", "วิธีการ", "งานวิจัยที่อ่าน", "ดาวน์โหลด"],
};

async function open(page: Page, review: Review) {
  await mockApi(page, { [`GET /api/v1/reviews/${review.id}`]: (route) => json(route, 200, review) });
  await page.goto(`/r/${review.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

for (const [type, review] of Object.entries(P20_FIXTURES) as [keyof typeof P20_FIXTURES, Review][]) {
  test(`${type}: answer-first order in the table of contents and on the page (1440)`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, review);
    const toc = page.getByRole("navigation", { name: "สารบัญ" });
    await expect(toc).toBeVisible();
    await expect(page.getByRole("navigation", { name: "ในรายงานนี้" })).toBeHidden();
    await expect(toc.getByRole("link")).toHaveText(ORDER[type]);
    // the headings follow the same order, and each link lands on its heading
    const hrefs = await toc.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    const tops = await page.evaluate((ids) => ids.map((id) => document.querySelector(id)!.getBoundingClientRect().top + scrollY), hrefs);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    // the table of contents stays in view while reading
    await toc.getByRole("link", { name: "ข้อจำกัด" }).click();
    await expect(page.locator("#h-limitations")).toBeInViewport();
    await expect(toc.getByRole("link", { name: "คำตอบ" })).toBeInViewport();
    await expect(toc.getByRole("link", { name: "ข้อจำกัด" })).toHaveAttribute("aria-current", "location");
    // the rail starts empty
    await expect(page.getByRole("complementary", { name: /ต้นฉบับ/ })).toContainText("แตะตัวเลขหรือรหัสงานวิจัยเพื่อดูประโยคต้นฉบับ");
  });

  test(`${type} at 390: no horizontal scroll, the top nav scrolls with an edge fade`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, review);
    const nav = page.getByRole("navigation", { name: "ในรายงานนี้" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("navigation", { name: "สารบัญ" })).toBeHidden();
    await expect(nav.locator("ul")).toHaveAttribute("data-fade-end", "true");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    for (const type of ["slr", "meta", "metaNoPool", "scoping", "narrative", "legacy"] as const) {
      test(`${type} at ${width}px, ${scheme}: axe clean`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: scheme });
        await open(page, P20_FIXTURES[type]);
        const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      });
    }
  }
}

test("the bottom line and key findings: computed pool, verified range, the rationale behind a disclosure", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, P20_FIXTURES.meta);
  const answer = page.locator("section[aria-labelledby=h-answer]");
  await expect(answer.getByRole("img", { name: /^0\.96 \(คำนวณโดยระบบ/ })).toBeVisible();
  await expect(answer.locator(".num-verified")).toHaveCount(0);
  const why = answer.getByText("เหตุผลของระดับหลักฐาน");
  await expect(why).toBeVisible();
  const sof = page.getByRole("table", { name: /ตารางสรุปผลการศึกษาตามผลลัพธ์/ });
  await sof.getByRole("button", { name: "0.84" }).click();
  await expect(page.getByRole("complementary", { name: /ต้นฉบับ/ })).toContainText("Simulated study 3");
  // Thai reading text at 17px / 1.75
  const size = await answer.locator("[data-prose]").evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).lineHeight]);
  expect(size).toEqual(["17px", `${17 * 1.75}px`]);
});
