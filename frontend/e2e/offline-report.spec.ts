import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { buildStandaloneHtml } from "../src/lib/standalone-html";
import { reviewFixture } from "../src/test/fixtures";

// The downloaded report must work with no network at all: every request is blocked.
test("the single-file HTML report works offline", async ({ page }) => {
  const js = readFileSync("standalone-dist/report.js", "utf8");
  const css = readFileSync("standalone-dist/report.css", "utf8");
  const html = buildStandaloneHtml(reviewFixture, { js, css });
  expect(html.length).toBeLessThan(2_000_000);
  const requests: string[] = [];
  await page.route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(html, { waitUntil: "load" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2");
  const table = page.getByRole("table", { name: "ผลแต่ละการศึกษา" });
  await expect(table).toBeVisible();
  await page.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }).click();
  await expect(page.getByRole("complementary", { name: "ต้นฉบับ" })).toContainText("Metformin use was associated");
  expect(requests.filter((u) => !u.includes("fonts.g"))).toEqual([]); // only the optional web fonts were attempted
});
