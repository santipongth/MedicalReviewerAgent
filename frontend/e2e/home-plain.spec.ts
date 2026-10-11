import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./mock-api";

// Plan 20 Task 12: the home page explains itself in plain Thai, glosses its jargon, and the scope form spans the page.
// Screenshots go to MRA_SHOTS_DIR (e.g. ../.superpowers/p20-t12) when set, else test-results/screens/p20-t12.
const SHOTS = process.env.MRA_SHOTS_DIR ?? "test-results/screens/p20-t12";
const shot = (name: string) => `${SHOTS}/${name}.png`;

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

const form = (page: Page) => page.getByRole("form", { name: "กำหนดขอบเขตการทบทวน" });

test("home: plain-language intro and glossed terms, axe-clean in light and dark at 1440 and 390", async ({ page }) => {
  await mockApi(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ระบบนี้คืออะไร" })).toBeVisible();
    await expect(page.getByTestId("what-it-is")).toContainText("บทคัดย่อ (ย่อหน้าสรุปสั้น ๆ");
    const intro = page.getByRole("region", { name: "รู้จักระบบนี้ใน 1 นาที" });
    await expect(intro.getByRole("list", { name: "ระบบทำอะไรให้บ้าง" }).getByRole("listitem")).toHaveCount(5);
    await expect(intro.getByTestId("intro-limits")).toContainText("อ่านเฉพาะบทคัดย่อ");
    // glossed terms, shown as text (no hover needed)
    await expect(form(page)).toContainText("PICO (กรอบตั้งคำถาม");
    await expect(form(page).getByRole("checkbox", { name: "การทดลองแบบสุ่มและมีกลุ่มควบคุม RCT" })).toBeVisible();
    await expect(page.getByRole("region", { name: "รีวิวได้ 4 แบบ รายงานมีอะไรบ้าง" })).toContainText("PRISMA (มาตรฐานการรายงาน");
    // the glossary disclosure opens by keyboard
    const summary = intro.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(intro.getByRole("term").filter({ hasText: "95% CI" })).toBeVisible();
    await noHorizontalScroll(page);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await noSeriousA11y(page);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 39, 31)");
    await noSeriousA11y(page);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  }
});

test("home: the scope form spans the content width, two columns from 1024, even tiles, one column on a phone", async ({ page }) => {
  await mockApi(page);
  for (const width of [1440, 1024, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const box = (await form(page).boundingBox())!;
    const main = (await page.locator("main").boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(main.width - 32 - 1); // the full content width inside the 16px gutters
    const step1 = (await page.getByLabel(/คำถามหรือวัตถุประสงค์/).boundingBox())!;
    const step3 = (await form(page).getByRole("group", { name: /หลักฐานและเกณฑ์คัดเลือก/ }).boundingBox())!;
    if (width >= 1024) expect(step3.x).toBeGreaterThan(step1.x + step1.width); // step 3 beside steps 1 and 2
    else expect(step3.y).toBeGreaterThan(step1.y + step1.height); // stacked
    const tiles = form(page).getByRole("group", { name: /หลักฐานและเกณฑ์คัดเลือก/ }).locator("label");
    const heights = await tiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(heights).toHaveLength(8);
    // where the tiles form a two-column grid (640–1023px) every tile has the same height; in the one-column list
    // (phone, and beside steps 1–2 from 1024px) each tile keeps its own height, so the column stays short
    if (width >= 640 && width < 1024) expect(new Set(heights).size).toBe(1);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    await form(page).getByText("ตัวเลือกเพิ่มเติม").click();
    await expect(form(page).getByLabel(/จำนวนงานวิจัยที่ต้องการวิเคราะห์/)).toBeVisible();
    if (width >= 1024) { // language, paper count and year sit in one aligned row
      const tops = await Promise.all([
        form(page).getByText("ภาษาของรายงาน"), form(page).getByText("จำนวนงานวิจัยที่ต้องการวิเคราะห์"),
        form(page).getByText("ตั้งแต่ปี (ไม่บังคับ)"),
      ].map(async (l) => Math.round((await l.boundingBox())!.y)));
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(4);
    }
    await noHorizontalScroll(page);
    // one full-page capture clipped to the form, so the sticky site header is not stitched over it
    await page.evaluate(() => window.scrollTo(0, 0));
    const f = (await form(page).boundingBox())!;
    const scrollY = await page.evaluate(() => window.scrollY);
    await page.screenshot({ path: shot(`form-${width}`), fullPage: true,
      clip: { x: f.x - 8, y: f.y + scrollY - 8, width: f.width + 16, height: f.height + 16 } });
  }
});

test("home: disclosure chevrons turn when open, and only switch (no rotation) under reduced motion", async ({ page }) => {
  await mockApi(page);
  for (const motion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto("/");
    for (const summary of [form(page).locator("summary"), page.getByRole("region", { name: "รู้จักระบบนี้ใน 1 นาที" }).locator("summary")]) {
      const visible = summary.locator("[data-chevron] > :visible");
      const read = () => visible.evaluate((e) => {
        const s = getComputedStyle(e);
        return { text: e.textContent, turned: s.transform !== "none" || (s.rotate !== "none" && s.rotate !== "0deg") };
      });
      await expect(visible).toHaveCount(1);
      const closed = await read();
      expect(closed.turned).toBe(false);
      await summary.click();
      await expect(visible).toHaveCount(1);
      const open = await read();
      if (motion === "reduce") {
        expect(open.turned).toBe(false); // never rotates: the glyph itself switches
        expect(open.text).not.toBe(closed.text);
      } else {
        expect(open.turned).toBe(true); // a quarter turn
      }
    }
  }
});

test("home: at 1440 the form's two columns end close together (no empty band under step 2)", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const left = (await form(page).getByRole("combobox", { name: /รูปแบบการทบทวน/ }).locator("xpath=..").boundingBox())!; // step 2 picker
  const right = (await form(page).getByRole("group", { name: /หลักฐานและเกณฑ์คัดเลือก/ }).boundingBox())!;
  expect(Math.abs(left.y + left.height - (right.y + right.height))).toBeLessThanOrEqual(48);
  // ...without blowing the question box up into a wall
  const question = (await page.getByLabel(/คำถามหรือวัตถุประสงค์/).boundingBox())!;
  expect(question.height).toBeLessThanOrEqual(400);
});

test("home: full-page screenshots for review (1440 and 390 light, 1440 dark)", async ({ page }) => {
  await mockApi(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: /เมตฟอร์มินกับมะเร็งลำไส้ใหญ่/ })).toBeVisible();
  await page.screenshot({ path: shot("home-1440-light"), fullPage: true });
  await page.screenshot({ path: shot("home-1440-top") }); // the hero as a first-time reader sees it
  await page.getByRole("region", { name: "รู้จักระบบนี้ใน 1 นาที" }).screenshot({ path: shot("intro-1440") });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 39, 31)");
  await page.evaluate(() => window.scrollTo(0, 0)); // a scrolled page stitches the sticky header into a full-page shot
  await page.screenshot({ path: shot("home-1440-dark"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: /เมตฟอร์มินกับมะเร็งลำไส้ใหญ่/ })).toBeVisible();
  await page.screenshot({ path: shot("home-390-light"), fullPage: true });
  await noHorizontalScroll(page);
});
