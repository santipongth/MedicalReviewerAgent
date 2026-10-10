import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { narrativeReviewFixture, reviewFixture, scopingReviewFixture, slrReviewFixture } from "../src/test/fixtures";
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
  await expect(page.getByRole("heading", { level: 1 })).toContainText("แตะที่ตัวเลข");
  const rail = page.getByRole("region", { name: "แหล่งที่มาของตัวเลขที่เลือก" });
  await expect(rail.locator("mark")).toHaveText("0.77");
  await page.getByRole("button", { name: /^P2 HR 0\.99/ }).click();
  await expect(rail.locator("mark")).toHaveText("0.99");
  await expect(page.getByRole("button", { name: /^P2 HR 0\.99/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("unplotted").locator(".hole")).toBeVisible();
  await expect(page.getByRole("link", { name: /เมตฟอร์มินกับมะเร็งลำไส้ใหญ่/ })).toContainText("86%");
  await page.screenshot({ path: shots("landing-light"), fullPage: true });
  await noSeriousA11y(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: shots("landing-dark"), fullPage: true });
  await noSeriousA11y(page);
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByLabel(/คำถามหรือวัตถุประสงค์/).fill("metformin colorectal cancer");
  await page.getByRole("button", { name: "ส่งให้เอเจนต์ทบทวน" }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${RID}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2", { timeout: 15_000 });
  await expect(page.getByRole("table", { name: "ผลแต่ละการศึกษา" })).toBeVisible();
});

test("live run shows the refined question and the agent stage while reading", async ({ page }) => {
  await mockApi(page, {
    [`GET /api/v1/reviews/${RID}`]: (route) => json(route, 200, { ...reviewFixture, status: "running", result: null }),
    [`GET /api/v1/reviews/${RID}/events`]: (route) => route.fulfill({ status: 200,
      headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse(LIVE_EVENTS) }),
  });
  await page.goto(`/r/${RID}`);
  await expect(page.getByText("เอเจนต์เข้าใจคำถามของคุณว่า")).toBeVisible();
  await expect(page.getByRole("img", { name: /เอเจนต์/ })).toBeVisible();
  // the default team view: the reader is at work
  await expect(page.locator('[data-member="reader"][data-status="working"]')).toBeVisible();
  await expect(page.getByTestId("reader-ok")).toHaveCount(1);
  await expect(page.getByTestId("reader-waiting")).toHaveCount(29);
  await expect(page.getByRole("region", { name: "บันทึกการทำงาน" })).toContainText("ผ่านคัดกรอง 30 จาก 60 ฉบับ");
  // the title shows in the reading list and (as the latest finished paper) in the thought card: scope to the list
  await expect(page.getByRole("listitem").filter({ hasText: "P1" }).getByText("Metformin and incident colorectal cancer in a national diabetes cohort")).toBeVisible();
  await expect(page.locator('section[aria-labelledby="h-evidence"]')).toContainText("กระดานหลักฐานสด");
  await expect(page.locator('[aria-labelledby="h-thought"]')).toContainText("อ่านเสร็จล่าสุด P1");
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

  await page.getByRole("button", { name: /^กรอง \(แสดง 5 จาก 5 ฉบับ\)/ }).click();
  await page.getByLabel(/ความเกี่ยวข้องขั้นต่ำ/).fill("90");
  await expect(page.getByRole("status").filter({ hasText: "กำลังกรอง" }).first()).toContainText("แสดง 2 จาก 5 ฉบับ");
  await page.getByRole("button", { name: "ล้างตัวกรอง" }).first().click();
  await expect(page.getByRole("button", { name: /^กรอง \(แสดง 5 จาก 5 ฉบับ\)/ })).toBeVisible();

  await page.getByRole("button", { name: "ใช้ธีมมืด" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /^P4: / }).first().click();
  await page.screenshot({ path: shots("report-dark"), fullPage: true });
  await noSeriousA11y(page);
});

test("live stage fits phone: 30 reader slots without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, {
    [`GET /api/v1/reviews/${RID}`]: (route) => json(route, 200, { ...reviewFixture, status: "running", result: null }),
    [`GET /api/v1/reviews/${RID}/events`]: (route) => route.fulfill({ status: 200,
      headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse(LIVE_EVENTS) }),
  });
  await page.goto(`/r/${RID}`);
  await expect(page.getByTestId("reader-ok")).toHaveCount(1);
  await expect(page.getByTestId("reader-waiting")).toHaveCount(29);
  await expect(page.getByTestId("reader-waiting").first()).toBeVisible();
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
  const drawer = page.getByRole("dialog");
  await expect(rail).toBeVisible();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { level: 2 })).toBeFocused();
  await page.screenshot({ path: shots("report-phone-drawer") });
  await rail.getByRole("button", { name: "ปิด" }).click();
  await expect(rail).toBeHidden();
  // Esc closes it
  await page.getByRole("button", { name: /^P1: / }).click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  // a tap on the backdrop (above the sheet) closes it
  await page.getByRole("button", { name: /^P1: / }).click();
  await expect(drawer).toBeVisible();
  await page.getByTestId("rail-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(drawer).toBeHidden();
});

test("landing on a phone: no horizontal scroll, the source sits under the plot, a dead API leaves the page usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, { "GET /api/v1/reviews": (route) => route.abort() });
  await page.goto("/");
  await expect(page.getByText("โหลดรายการไม่ได้ตอนนี้", { exact: false })).toBeVisible();
  await noHorizontalScroll(page);
  const lastRow = await page.getByRole("button", { name: /^P15 / }).boundingBox();
  const rail = await page.getByRole("region", { name: "แหล่งที่มาของตัวเลขที่เลือก" }).boundingBox();
  expect(rail!.y).toBeGreaterThan(lastRow!.y);
  await page.getByRole("button", { name: /^P5 RR 0\.56/ }).click();
  await expect(page.getByRole("region", { name: "แหล่งที่มาของตัวเลขที่เลือก" }).locator("mark")).toHaveText("0.56");
  await expect(page.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ })).toBeEnabled();
  await page.screenshot({ path: shots("landing-phone"), fullPage: true });
  await noSeriousA11y(page);
});

test("landing on a phone: recent reviews read topic first, share on the right", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto("/");
  const row = page.getByRole("link", { name: /เมตฟอร์มินกับมะเร็งลำไส้ใหญ่/ });
  const topic = await row.getByText("เมตฟอร์มินกับมะเร็งลำไส้ใหญ่").boundingBox();
  const share = await row.getByText("86%").boundingBox();
  expect(topic!.x).toBeLessThan(share!.x);
  // the column label sits over the share column, not over the topics
  const label = await page.locator('[aria-hidden="true"]', { hasText: "ตรวจผ่าน" }).getByText("ตรวจผ่าน", { exact: true }).boundingBox();
  expect(label!.x + label!.width).toBeGreaterThan(share!.x);
  await noHorizontalScroll(page);
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
  await page.getByLabel(/คำถามหรือวัตถุประสงค์/).fill("statins and dementia");
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
  // limits come from GET /api/v1/status, not hard-coded text
  await expect(page.getByText(/5 รีวิวต่อชั่วโมง/)).toBeVisible();
  await expect(page.getByText(/สตรีมสดพร้อมกันได้ 5/)).toBeVisible();
  await noSeriousA11y(page);
  await noHorizontalScroll(page);
});

test("landing: ?q= pre-fills the request slip", async ({ page }) => {
  await mockApi(page);
  await page.goto("/?q=statins");
  await expect(page.getByLabel(/คำถามหรือวัตถุประสงค์/)).toHaveValue("statins");
  await page.goto("/");
  await expect(page.getByLabel(/คำถามหรือวัตถุประสงค์/)).toHaveValue("");
});

test("live run: a queued review shows the รอคิว step as current", async ({ page }) => {
  await mockApi(page, {
    [`GET /api/v1/reviews/${RID}`]: (route) => json(route, 200, { ...reviewFixture, status: "queued", result: null }),
    [`GET /api/v1/reviews/${RID}/events`]: (route) => route.fulfill({ status: 200,
      headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse([LIVE_EVENTS[0]]) }),
  });
  await page.goto(`/r/${RID}`);
  await expect(page.locator("li[aria-current='step']")).toContainText("รอคิว");
  await expect(page.getByText(/อยู่ในคิว/)).toBeVisible();
});

test("live run: the search queries are listed under the PubMed step", async ({ page }) => {
  await mockApi(page, {
    [`GET /api/v1/reviews/${RID}`]: (route) => json(route, 200, { ...reviewFixture, status: "running", result: null }),
    [`GET /api/v1/reviews/${RID}/events`]: (route) => route.fulfill({ status: 200,
      headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse(LIVE_EVENTS) }),
  });
  await page.goto(`/r/${RID}`);
  await expect(page.locator("ol li").filter({ hasText: "metformin colorectal cancer" })).toBeVisible();
});

test("report: the section nav jumps to the papers", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/r/${RID}`);
  const nav = page.getByRole("navigation", { name: "ในรายงานนี้" });
  await nav.getByRole("link", { name: "งานวิจัยที่อ่าน" }).click();
  await expect(page).toHaveURL(/#h-papers$/);
  await expect(page.locator("#h-papers")).toBeInViewport();
});

test("report on a phone: the section nav sticks below the wrapped site header and jumps clear of it", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockApi(page);
  await page.goto(`/r/${RID}`);
  const nav = page.getByRole("navigation", { name: "ในรายงานนี้" });
  await expect(nav).toBeVisible();
  // nothing covers the given point: the topmost element there belongs to the expected element
  const uncovered = (selector: string, y: "centre" | "top") => page.evaluate(([sel, at]) => {
    const el = document.querySelector(sel)!;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 40), at === "top" ? r.top + 2 : r.top + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  }, [selector, y] as const);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await expect(nav).toBeInViewport();
  expect(await uncovered('nav[aria-label="ในรายงานนี้"]', "centre")).toBe(true);
  const header = await page.locator("header").first().boundingBox();
  const navBox = await nav.boundingBox();
  expect(navBox!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
  await nav.getByRole("link", { name: "งานวิจัยที่อ่าน" }).click();
  await expect(page).toHaveURL(/#h-papers$/);
  await expect(page.locator("#h-papers")).toBeInViewport();
  await expect.poll(() => uncovered("#h-papers", "top")).toBe(true);
});

test("report on a phone: a glossary term opens on tap and closes on Esc", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockApi(page);
  await page.goto(`/r/${RID}`);
  const term = page.getByRole("button", { name: "จำนวนงานวิจัยตามทิศทางผลที่เอเจนต์อ่าน" });
  await term.scrollIntoViewIfNeeded();
  await term.click();
  await expect(term).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("note")).toBeVisible();
  await noHorizontalScroll(page);
  await page.keyboard.press("Escape");
  await expect(term).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("note")).toHaveCount(0);
});

test("axe: landing at 375px in light and dark", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByLabel(/คำถามหรือวัตถุประสงค์/)).toBeVisible();
  await noSeriousA11y(page);
  // Reduced motion switches the colour transitions off, so axe never samples mid-fade colours.
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 39, 31)"); // dark ground
  await noSeriousA11y(page);
});

test("axe: report with the source drawer open at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockApi(page);
  await page.goto(`/r/${RID}`);
  await page.getByRole("button", { name: /^P1: / }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await noSeriousA11y(page);
});

test("phone width: the literature matrix scrolls inside its own container, not the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: (route) => json(route, 200, narrativeReviewFixture) });
  await page.goto(`/r/${RID}`);
  const table = page.getByRole("table", { name: "ตารางสรุปงานวิจัย" });
  await expect(table).toBeVisible();
  await noHorizontalScroll(page);
  const scroller = await table.evaluate((t) => ({ box: t.parentElement!.clientWidth, content: t.parentElement!.scrollWidth }));
  expect(scroller.box).toBeLessThanOrEqual(390);
  expect(scroller.content).toBeGreaterThan(scroller.box);
  const first = await table.getByRole("rowheader").first().boundingBox();
  await table.evaluate((t) => { t.parentElement!.scrollLeft = 400; });
  const after = await table.getByRole("rowheader").first().boundingBox();
  expect(Math.abs(after!.x - first!.x)).toBeLessThan(2);
});

// ---- Plan 14a: review types, literature matrix, concept map ----

const typeFixtures = { slr: slrReviewFixture, narrative: narrativeReviewFixture, scoping: scopingReviewFixture };

async function openReport(page: Page, fixture: typeof reviewFixture) {
  await mockApi(page, { [`GET /api/v1/reviews/${RID}`]: (route) => json(route, 200, fixture) });
  await page.goto(`/r/${RID}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "ตารางสรุปงานวิจัย" })).toBeVisible();
}

test("landing: the scope form sends the chosen review_type", async ({ page }) => {
  let body: { options?: { review_type?: string } } = {};
  await mockApi(page, {
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: RID, status: "queued", cached: false }); },
  });
  await page.goto("/");
  const select = page.getByRole("combobox", { name: /รูปแบบการทบทวน/ });
  await expect(select).toHaveValue("slr");
  await select.selectOption("scoping");
  await expect(page.getByRole("form", { name: "กำหนดขอบเขตการทบทวน" }).getByText(/ด้วยกรอบ PCC/)).toBeVisible();
  await page.getByLabel(/คำถามหรือวัตถุประสงค์/).fill("metformin colorectal cancer");
  await page.getByRole("button", { name: "ส่งให้เอเจนต์ทบทวน" }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${RID}$`));
  expect(body.options?.review_type).toBe("scoping");
});

test("landing: choosing the meta-analysis type sends review_type=meta_analysis", async ({ page }) => {
  let body: { options?: { review_type?: string } } = {};
  await mockApi(page, {
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: RID, status: "queued", cached: false }); },
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: /รูปแบบการทบทวน/ }).selectOption("meta_analysis");
  await page.getByLabel(/คำถามหรือวัตถุประสงค์/).fill("metformin colorectal cancer");
  await page.getByRole("button", { name: "ส่งให้เอเจนต์ทบทวน" }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${RID}$`));
  expect(body.options?.review_type).toBe("meta_analysis");
});

test("report per review type: badge, sections and nav", async ({ page }) => {
  const nav = () => page.getByRole("navigation", { name: "ในรายงานนี้" });
  await openReport(page, scopingReviewFixture);
  await expect(page.getByText("อัตโนมัติ · อ่านเฉพาะบทคัดย่อ").first()).toContainText("การทบทวนขอบเขต");
  await expect(page.getByRole("heading", { name: "แผนที่หลักฐาน" })).toBeVisible();
  await expect(nav().getByRole("link", { name: "แผนที่หลักฐาน" })).toBeVisible();
  await expect(nav().getByRole("link", { name: "ตารางงานวิจัย" })).toBeVisible();
  await expect(nav().getByRole("link", { name: "แผนที่ความรู้" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "จุดที่ตรงกันและขัดกัน" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: /^Forest plot/ })).toHaveCount(0);
  await expect(nav().getByRole("link", { name: "จุดตรงกัน/ขัดกัน" })).toHaveCount(0);

  await openReport(page, narrativeReviewFixture);
  await expect(page.getByText("อัตโนมัติ · อ่านเฉพาะบทคัดย่อ").first()).toContainText("การทบทวนแบบบรรยาย");
  await expect(nav().getByRole("link", { name: "ตารางงานวิจัย" })).toBeVisible();
  await expect(nav().getByRole("link", { name: "แผนที่ความรู้" })).toBeVisible();
  await expect(nav().getByRole("link", { name: "แผนที่หลักฐาน" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "เหตุผลที่คัดออก" })).toHaveCount(0);

  await openReport(page, slrReviewFixture);
  await expect(page.getByText("อัตโนมัติ · อ่านเฉพาะบทคัดย่อ").first()).toContainText("การทบทวนวรรณกรรมอย่างเป็นระบบ");
  await expect(nav().getByRole("link", { name: "จุดตรงกัน/ขัดกัน" })).toBeVisible();
  await expect(nav().getByRole("link", { name: "แผนภาพ" })).toBeVisible();
  await expect(nav().getByRole("link", { name: "แผนที่หลักฐาน" })).toHaveCount(0);
});

test("scoping report: PRISMA lists the exclusion reasons; the concept map toggles to its outline", async ({ page }) => {
  await openReport(page, scopingReviewFixture);
  const reasons = page.getByRole("table", { name: "เหตุผลที่คัดออก" });
  await expect(reasons).toBeAttached();
  const section = page.locator("#h-map").locator("xpath=ancestor::section[1]");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole("img", { name: /^แผนที่ความรู้/ })).toBeVisible();
  await section.getByRole("button", { name: "ดูเป็นตาราง" }).click();
  const outline = section.getByRole("list", { name: "โครงร่างแผนที่ความรู้" });
  await expect(outline).toBeVisible();
  await expect(outline.getByRole("button").first()).toBeVisible();
  await section.getByRole("button", { name: "ดูเป็นแผนภาพ" }).click();
  await expect(section.getByRole("img", { name: /^แผนที่ความรู้/ })).toBeVisible();
});

for (const [type, fixture] of Object.entries(typeFixtures)) {
  for (const width of [1440, 390]) {
    test(`axe: ${type} report at ${width}px, light and dark`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openReport(page, fixture);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await noHorizontalScroll(page);
      await noSeriousA11y(page);
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 39, 31)");
      await noSeriousA11y(page);
    });
  }
}

test("axe: landing with the review-type picker at 1440 and 390, light and dark", async ({ page }) => {
  await mockApi(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("combobox", { name: /รูปแบบการทบทวน/ })).toBeVisible();
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await noSeriousA11y(page);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 39, 31)");
    await noSeriousA11y(page);
  }
});

test("landing: scope form sends study types incl. other text, qualitative note, fits 390px", async ({ page }) => {
  let body: { options?: { study_types?: string[] } } = {};
  await mockApi(page, {
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: RID, status: "queued", cached: false }); },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("form", { name: "กำหนดขอบเขตการทบทวน" })).toBeVisible();
  await page.getByLabel(/คำถามหรือวัตถุประสงค์/).fill("ประสบการณ์ของผู้ป่วยเบาหวานต่อการใช้อินซูลิน");
  await page.getByLabel("Cohort", { exact: true }).check();
  await page.getByLabel(/Qualitative/).check();
  await expect(page.getByRole("form", { name: "กำหนดขอบเขตการทบทวน" }).getByText(/สรุปเป็นประเด็นจากบทคัดย่อ/)).toBeVisible();
  await page.getByLabel(/อื่น ๆ — ระบุ/).check();
  await page.getByLabel("ระบุชนิดงานวิจัยอื่น").fill("Delphi study");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "ส่งให้เอเจนต์ทบทวน" }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${RID}$`));
  expect(body.options?.study_types).toEqual(["Cohort", "Qualitative", "Other: Delphi study"]);
});
