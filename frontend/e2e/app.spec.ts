import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { reviewFixture } from "../src/test/fixtures";
import { json, LIVE_EVENTS, mockApi, RID, sse, OPEN_STATUS } from "./mock-api";

const shots = (name: string) => `test-results/screens/${name}.png`;

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("landing: receipt from a real verified number, then submit opens the live run and the report", async ({ page }) => {
  let posted = false;
  let afterPost = 0;
  await mockApi(page, {
    "POST /api/v1/reviews": (route) => { posted = true; return json(route, 202, { review_id: RID, status: "queued", cached: false }); },
    [`GET /api/v1/reviews/${RID}`]: (route) => {
      if (posted) afterPost += 1;
      return json(route, 200, posted && afterPost <= 1 ? { ...reviewFixture, status: "running", result: null } : reviewFixture);
    },
    [`GET /api/v1/reviews/${RID}/events`]: async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" },
        body: sse([...LIVE_EVENTS, ["synthesizing", { papers: 4, elapsed_s: 48 }], ["done", { cost_usd: 0.12, elapsed_s: 58 }]]) });
    },
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ทุกตัวเลขพร้อมประโยคต้นฉบับ");
  await expect(page.locator("aside .num-verified").first()).toHaveText("HR 0.86");
  await page.screenshot({ path: shots("landing-light"), fullPage: true });
  await noSeriousA11y(page);

  await page.getByRole("button", { name: "ส่งให้เอเจนต์ทบทวน" }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${RID}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2", { timeout: 15_000 });
  await expect(page.getByRole("table", { name: "ผลแต่ละการศึกษา" })).toBeVisible();
});

test("live run shows the refined question and the specimen tray while reading", async ({ page }) => {
  await mockApi(page, {
    [`GET /api/v1/reviews/${RID}`]: (route) => json(route, 200, { ...reviewFixture, status: "running", result: null }),
    [`GET /api/v1/reviews/${RID}/events`]: (route) => route.fulfill({ status: 200,
      headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse(LIVE_EVENTS) }),
  });
  await page.goto(`/r/${RID}`);
  await expect(page.getByText("เอเจนต์เข้าใจคำถามของคุณว่า")).toBeVisible();
  await expect(page.getByTestId("well-cap")).toHaveCount(30);
  await expect(page.getByTestId("well-out")).toHaveCount(30);
  await expect(page.getByText("Metformin and incident colorectal cancer in a national diabetes cohort")).toBeVisible();
  await page.screenshot({ path: shots("live-run"), fullPage: true });
  await noSeriousA11y(page);
});

test("report: matrix cell opens the verbatim sentence; charts and filters work; dark theme", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/r/${RID}`);
  await page.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }).click();
  const rail = page.getByRole("complementary", { name: "ต้นฉบับ" });
  await expect(rail.locator("mark")).toHaveText("0.80");
  await expect(rail.getByText("HR 0.80", { exact: true })).toHaveClass(/num-verified/);
  await expect(page.getByRole("img", { name: "Forest plot ของ 3 ผลลัพธ์" })).toBeVisible();
  await expect(page.locator("svg").first()).toBeVisible();
  await page.screenshot({ path: shots("report-light"), fullPage: true });
  await noSeriousA11y(page);

  await page.getByLabel(/ความเกี่ยวข้องขั้นต่ำ/).fill("90");
  await expect(page.getByText("แสดง 2 จาก 5 ฉบับ")).toBeVisible();

  await page.getByRole("button", { name: "ใช้ธีมมืด" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /^P4: / }).first().click();
  await page.screenshot({ path: shots("report-dark"), fullPage: true });
  await noSeriousA11y(page);
});

test("live wells fit phone: 60 candidates without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, {
    [`GET /api/v1/reviews/${RID}`]: (route) => json(route, 200, { ...reviewFixture, status: "running", result: null }),
    [`GET /api/v1/reviews/${RID}/events`]: (route) => route.fulfill({ status: 200,
      headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse(LIVE_EVENTS) }),
  });
  await page.goto(`/r/${RID}`);
  await expect(page.getByTestId("well-cap")).toHaveCount(30);
  await noHorizontalScroll(page);
  await page.screenshot({ path: shots("live-run-phone"), fullPage: true });
});

test("phone width: no horizontal scroll, source rail opens as a drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto("/");
  await noHorizontalScroll(page);
  await page.goto(`/r/${RID}`);
  await expect(page.getByRole("table", { name: "ผลแต่ละการศึกษา" })).toBeVisible();
  await noHorizontalScroll(page);
  await expect(page.getByRole("complementary", { name: "ต้นฉบับ" })).toBeHidden();
  await page.getByRole("button", { name: /^P1: / }).click();
  const rail = page.getByRole("complementary", { name: "ต้นฉบับ" });
  await expect(rail).toBeVisible();
  await page.screenshot({ path: shots("report-phone-drawer") });
  await rail.getByRole("button", { name: "ปิด" }).click();
  await expect(rail).toBeHidden();
});

test("landing: a full service says so and keeps the submit button off", async ({ page }) => {
  await mockApi(page, {
    "GET /api/v1/status": (route) => json(route, 200, { ...OPEN_STATUS, accepting: false, reason: "queue_full", retry_after: 60 }),
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("คิวเต็มชั่วคราว");
  await expect(page.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ })).toBeDisabled();
  await noSeriousA11y(page);
});

test("submit errors: rate limit shows the wait time", async ({ page }) => {
  await mockApi(page, {
    "POST /api/v1/reviews": (route) => json(route, 429, { detail: "rate limit exceeded" }, { "retry-after": "1800", "access-control-expose-headers": "Retry-After" }),
  });
  await page.goto("/");
  await page.getByRole("button", { name: "ส่งให้เอเจนต์ทบทวน" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "นาที" })).toContainText("30 นาที");
});

test("rejected and missing reviews explain themselves", async ({ page }) => {
  await mockApi(page, {
    "GET /api/v1/reviews/rej": (route) => json(route, 200, { ...reviewFixture, id: "rej", topic: "best pizza", status: "rejected",
      error: "not a medical topic", result: null }),
  });
  await page.goto("/r/rej");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("หัวข้อนี้ไม่ใช่คำถามวิจัยทางการแพทย์");
  await expect(page.getByText("not a medical topic")).toBeVisible();
  await page.goto("/r/does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ไม่พบรีวิวนี้");
  await page.goto("/r/empty");
  await expect(page.getByText(/ไม่พบงานวิจัยที่ตรงกับหัวข้อนี้/)).toBeVisible();
});

test("about page renders the deployment's API address in every snippet", async ({ page }) => {
  await mockApi(page);
  await page.goto("/about");
  await expect(page.getByText("claude mcp add --transport http medical-reviewer http://api.mock/mcp")).toBeVisible();
  await noSeriousA11y(page);
  await noHorizontalScroll(page);
});
