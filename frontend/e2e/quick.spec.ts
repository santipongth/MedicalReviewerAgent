import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { quickReviewFixture } from "../src/test/fixtures";
import { json, mockApi } from "./mock-api";

// Plan 27: the quick answer ("ถามเร็ว") in the real app: the home form starts as a quick answer and sends its mode,
// the answer page shows the numbered references with their links, and "ทำรีวิวฉบับเต็ม" opens the form as a full
// review with the same question. Axe clean and no sideways scroll at 1440 and 390, light and dark.
const QID = quickReviewFixture.id;
const form = (page: Page) => page.getByRole("form", { name: "กำหนดขอบเขตการทบทวน" });

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
}

test("home: a quick question is the default, sends mode quick and opens its answer; the upgrade goes back as a full review", async ({ page }) => {
  let body: { options?: Record<string, unknown> } | null = null;
  await mockApi(page, {
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: QID, status: "queued", cached: false }); },
    [`GET /api/v1/reviews/${QID}`]: (route) => json(route, 200, quickReviewFixture),
  });
  await page.goto("/");
  await expect(form(page).getByRole("radio", { name: /ถามเร็ว/ })).toBeChecked();
  await expect(form(page).getByRole("combobox", { name: /รูปแบบการทบทวน/ })).toHaveCount(0);
  await page.getByLabel(/คำถามหรือวัตถุประสงค์/).fill("metformin colorectal cancer");
  await page.getByRole("button", { name: "ส่งให้เอเจนต์ทบทวน" }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${QID}$`));
  expect(body!.options).toEqual({ mode: "quick" });

  const answer = page.locator("[data-quick-answer]");
  await expect(answer.getByRole("heading", { level: 1 })).toContainText("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2");
  await expect(answer.locator("[data-quick-text]")).toContainText("[1✓, 2]");
  const refs = answer.getByRole("list", { name: "เอกสารอ้างอิง" }).getByRole("listitem");
  await expect(refs).toHaveCount(3);
  await expect(refs.first().getByRole("link", { name: /PubMed 3000003/ })).toHaveAttribute("href", "https://pubmed.ncbi.nlm.nih.gov/3000003/");
  await answer.getByRole("link", { name: "อ้างอิง 3" }).click();
  await expect(page).toHaveURL(/#qref-3$/);

  await answer.getByRole("link", { name: "ทำรีวิวฉบับเต็ม" }).click();
  await expect(page).toHaveURL(/\/\?q=.*mode=full.*#request$/);
  await expect(form(page).getByRole("radio", { name: /รีวิวฉบับเต็ม/ })).toBeChecked();
  await expect(page.getByLabel(/คำถามหรือวัตถุประสงค์/)).toHaveValue(quickReviewFixture.topic);
  await expect(form(page).getByRole("combobox", { name: /รูปแบบการทบทวน/ })).toBeVisible();
  await expect(form(page).getByLabel(/Cohort/)).toBeChecked();
});

for (const [width, height, scheme] of [[1440, 1000, "light"], [390, 844, "light"], [1440, 1000, "dark"], [390, 844, "dark"]] as const) {
  test(`quick answer page at ${width}px (${scheme}): no sideways scroll, axe-clean`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await mockApi(page, { [`GET /api/v1/reviews/${QID}`]: (route) => json(route, 200, quickReviewFixture) });
    await page.goto(`/r/${QID}`);
    await expect(page.locator("[data-quick-answer]")).toBeVisible();
    await expect(page.locator('[data-notice="guide"]')).toBeVisible();
    // the answer and how sure it is: side by side on a wide screen, the certainty under the answer on a phone
    const answer = (await page.locator('section[aria-labelledby="quick-answer-h"]').boundingBox())!;
    const certainty = (await page.locator("[data-quick-certainty]").boundingBox())!;
    if (width >= 1024) {
      expect(certainty.x).toBeGreaterThanOrEqual(answer.x + answer.width - 1);
      expect(Math.abs(certainty.y - answer.y)).toBeLessThan(80);
    } else {
      expect(certainty.y).toBeGreaterThanOrEqual(answer.y + answer.height - 1);
    }
    await noHorizontalScroll(page);
    await noSeriousA11y(page);
  });

  test(`home form in quick mode at ${width}px (${scheme}): no sideways scroll, axe-clean`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await mockApi(page);
    await page.goto("/");
    await expect(form(page).locator("[data-mode-choice]")).toBeVisible();
    await noHorizontalScroll(page);
    await noSeriousA11y(page);
  });
}
