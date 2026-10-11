import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./mock-api";

// The API and MCP page at /developers: the full-width three-pane docs layout and its responsive fallbacks.
// Screenshots go to MRA_SHOTS_DIR when set, else test-results/screens/developers.
const SHOTS = process.env.MRA_SHOTS_DIR ?? "test-results/screens/developers";

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

const sidebar = (page: Page) => page.locator("nav[aria-label='ในหน้านี้']:visible");
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test("/about moves permanently to /developers, and the site links point there", async ({ page }) => {
  await mockApi(page);
  const res = await page.goto("/about");
  expect(new URL(page.url()).pathname).toBe("/developers");
  expect(res!.request().redirectedFrom()?.url()).toMatch(/\/about$/);
  await expect(page.getByRole("heading", { level: 1, name: "ใช้งานผ่าน API และ MCP" })).toBeVisible();
  for (const nav of ["หลัก", "ท้ายหน้า"]) {
    await expect(page.getByRole("navigation", { name: nav }).getByRole("link", { name: /API และ MCP/ })).toHaveAttribute("href", "/developers");
  }
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1920, 1440, 1024, 768, 390]) {
    test(`/developers at ${width}px (${scheme}): layout, no sideways scroll, axe-clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await mockApi(page);
      await page.goto("/developers");
      await expect(page.getByTestId("live-limits")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await noHorizontalScroll(page);

      const main = (await page.locator("main").boundingBox())!;
      if (width >= 1920) expect(main.width).toBeGreaterThan(1240); // the docs use the wide screen
      const prose = await box(page, "#h-rest");
      const code = await box(page, "section[aria-labelledby=h-rest] pre");
      if (width >= 1024) {
        const toc = (await sidebar(page).boundingBox())!;
        expect(toc.x + toc.width).toBeLessThanOrEqual(prose.x); // the table of contents sits left of the content
        await expect(page.locator("details").filter({ hasText: "ในหน้านี้" })).toBeHidden();
      } else {
        await expect(sidebar(page)).toHaveCount(0);
      }
      if (width >= 1280) expect(code.x).toBeGreaterThan(prose.x + 200); // code beside its prose
      else expect(code.y).toBeGreaterThan(prose.y); // code under its prose

      await noSeriousA11y(page);
      await page.screenshot({ path: `${SHOTS}/developers-${width}-${scheme}.png`, fullPage: true });
    });
  }
}

test("/developers on a phone: the 'ในหน้านี้' disclosure jumps to a heading clear of the sticky header", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockApi(page);
  await page.goto("/developers");
  const details = page.locator("details").filter({ hasText: "ในหน้านี้" });
  await details.locator("summary").click();
  await details.getByRole("link", { name: "MCP สำหรับ AI agent" }).click();
  await expect(page).toHaveURL(/#h-mcp$/);
  await expect(details).not.toHaveAttribute("open", "");
  const header = (await page.locator("body > header").boundingBox())!;
  await expect.poll(async () => (await page.locator("#h-mcp").boundingBox())!.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  await expect(page.locator("#h-mcp")).toBeInViewport();
});

test("/developers: the signature snippet switches language by tab and arrow key", async ({ page }) => {
  await mockApi(page);
  await page.goto("/developers");
  const tabs = page.getByRole("tablist", { name: "ตรวจลายเซ็น" });
  await expect(page.getByRole("tabpanel")).toContainText("import hashlib, hmac");
  await tabs.getByRole("tab", { name: "Python" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Node.js" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("node:crypto");
});
