import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { buildStandaloneHtml } from "../src/lib/standalone-html";
import { metaReviewFixture, reviewFixture, scopingReviewFixture, slrReviewFixture } from "../src/test/fixtures";

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
  // there is no page to link to in a file on disk, so the copy-link button is not rendered
  await expect(page.getByRole("button", { name: "คัดลอกลิงก์" })).toHaveCount(0);
  // with no site header in the file, the section nav sticks to the very top
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  const nav = page.getByRole("navigation", { name: "ในรายงานนี้" });
  await expect(nav).toBeInViewport();
  expect((await nav.boundingBox())!.y).toBeLessThanOrEqual(1);
  expect(requests.filter((u) => !u.includes("fonts.g"))).toEqual([]); // only the optional web fonts were attempted
});

test("the offline report renders the literature matrix and the concept-map outline", async ({ page }) => {
  const js = readFileSync("standalone-dist/report.js", "utf8");
  const css = readFileSync("standalone-dist/report.css", "utf8");
  await page.route("**/*", (route) => route.abort());
  await page.setContent(buildStandaloneHtml(scopingReviewFixture, { js, css }), { waitUntil: "load" });
  await expect(page.getByRole("table", { name: "ตารางสรุปงานวิจัย" })).toBeVisible();
  await page.locator("section[aria-labelledby=h-map]").getByRole("button", { name: "ดูเป็นตาราง" }).click();
  await expect(page.getByRole("list", { name: "โครงร่างแผนที่ความรู้" })).toBeVisible();
});

test("the offline report renders the meta-analysis section from review.result", async ({ page }) => {
  const js = readFileSync("standalone-dist/report.js", "utf8");
  const css = readFileSync("standalone-dist/report.css", "utf8");
  await page.route("**/*", (route) => route.abort());
  await page.setContent(buildStandaloneHtml(metaReviewFixture, { js, css }), { waitUntil: "load" });
  const section = page.locator("section:has(#h-meta)");
  await expect(section.getByText("คำนวณโดยระบบจากตัวเลขที่ตรวจกับบทคัดย่อแล้ว — ไม่ใช่ผลจากงานวิจัยฉบับใด")).toBeVisible();
  await expect(section.getByRole("img", { name: /^0\.96 \(คำนวณโดยระบบ/ }).first()).toBeVisible();
  // the lazy echarts chunk is inlined in the file, so the pooled forest plot draws with no network
  await expect(section.getByRole("img", { name: /Forest plot ค่ารวม/ }).locator("svg")).toBeVisible();
  await section.getByText("วิธีคำนวณ").click();
  await section.getByRole("table", { name: /ตัวเลขที่ใช้คำนวณค่ารวม/ }).getByRole("button", { name: "0.84" }).click();
  await expect(page.getByRole("complementary", { name: "ต้นฉบับ" })).toContainText("Simulated study 3");
});

test("the offline report renders the citation network from review.result", async ({ page }) => {
  const js = readFileSync("standalone-dist/report.js", "utf8");
  const css = readFileSync("standalone-dist/report.css", "utf8");
  await page.route("**/*", (route) => route.abort());
  await page.setContent(buildStandaloneHtml(slrReviewFixture, { js, css }), { waitUntil: "load" });
  const section = page.locator("section:has(#h-citations)");
  // GraphChart is in the inlined echarts runtime, so the network draws with no network access
  await expect(section.getByRole("img", { name: "เครือข่ายการอ้างอิง 5 งานวิจัย 4 เส้นเชื่อม" }).locator("svg")).toBeVisible();
  await expect(section.getByText("ไม่มีข้อมูล ≠ ไม่อ้างอิง")).toBeVisible();
  await section.getByRole("button", { name: "ดูเป็นตาราง" }).click();
  await section.getByRole("table", { name: "ตารางการอ้างอิง" }).getByRole("button", { name: /^P3 / }).click();
  await expect(page.getByRole("complementary", { name: "ต้นฉบับ" })).toContainText("Metformin use and colorectal cancer risk");
});
