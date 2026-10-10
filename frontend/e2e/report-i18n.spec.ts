import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { THAI_KEEP_WHOLE } from "../src/lib/text-wrap";
import { emptyReviewFixture, P20_FIXTURES, P20_FIXTURES_EN } from "../src/test/fixtures";
import type { Review } from "../src/lib/types";
import { json, mockApi } from "./mock-api";

// Plan 20 Task 7: the report chrome follows the report language (TH report all Thai, EN report all English, the site
// header and footer included), `lang` attributes, Thai line breaking (never inside a word), the reading size, and the
// zero-included layout. Screenshots go to MRA_SHOTS_DIR (e.g. ../.superpowers/p20-t7) when set, else
// test-results/screens/p20-t7.
const SHOTS = process.env.MRA_SHOTS_DIR ?? "test-results/screens/p20-t7";
const shot = (name: string) => `${SHOTS}/${name}.png`;

const TYPES = ["slr", "meta", "metaNoPool", "scoping", "narrative", "legacy"] as const;
const THAI = /[฀-๿]/;

async function open(page: Page, review: Review, lang: "th" | "en") {
  await mockApi(page, { [`GET /api/v1/reviews/${review.id}`]: (route) => json(route, 200, review) });
  await page.goto(`/r/${review.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
}

/** Thai runs in the page chrome and the report: all text (closed disclosures and screen-reader text included) and every
 * accessible-name attribute. */
async function thaiOnPage(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const roots = [document.querySelector("header"), document.querySelector("main"), document.querySelector("footer")];
    const out: string[] = [];
    for (const root of roots) {
      if (!root) continue;
      out.push(root.textContent ?? "");
      for (const el of root.querySelectorAll("[aria-label],[title],[placeholder]")) {
        for (const a of ["aria-label", "title", "placeholder"]) {
          const v = el.getAttribute(a);
          if (v) out.push(v);
        }
      }
    }
    return out.flatMap((t) => t.match(/.{0,30}[฀-๿]+.{0,30}/g) ?? []);
  });
}

for (const type of TYPES) {
  test(`${type} in English: the report, the header and the footer are all English, lang="en"`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, P20_FIXTURES_EN[type], "en");
    await expect(page.locator("[data-report]")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("navigation", { name: "Contents" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(page.locator("footer")).toContainText("Not medical advice");
    expect(await thaiOnPage(page)).toEqual([]);
  });

  test(`${type} in Thai: the chrome is Thai, lang="th"`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, P20_FIXTURES[type], "th");
    await expect(page.locator("[data-report]")).toHaveAttribute("lang", "th");
    // section headings, disclosures, navigation and scroll-region names are chrome: every one reads Thai
    const chrome = await page.evaluate(() => [
      ...[...document.querySelectorAll("main h2, main summary")].map((e) => e.textContent ?? ""),
      ...[...document.querySelectorAll("main nav[aria-label], main [role=region][aria-label], header nav[aria-label], footer nav[aria-label]")]
        .map((e) => e.getAttribute("aria-label") ?? ""),
      ...[...document.querySelectorAll("main nav[aria-label='ในรายงานนี้'] a, main nav[aria-label='สารบัญ'] a")].map((e) => e.textContent ?? ""),
    ].map((t) => t.trim()).filter(Boolean));
    expect(chrome.length).toBeGreaterThan(10);
    expect(chrome.filter((t) => !THAI.test(t))).toEqual([]);
  });
}

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    for (const type of TYPES) {
      test(`${type} in English at ${width}px, ${scheme}: axe clean`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: scheme });
        await open(page, P20_FIXTURES_EN[type], "en");
        const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      });
    }
  }
}

/** Thai words (Intl.Segmenter, plus the report words kept whole) whose glyphs sit on more than one line. */
async function brokenWords(page: Page, selector: string): Promise<{ broken: string[]; lines: number }> {
  return page.evaluate(([sel, keep]) => {
    const seg = new Intl.Segmenter("th", { granularity: "word" });
    const broken: string[] = [];
    let lines = 0;
    for (const el of document.querySelectorAll(sel as string)) {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
      lines = Math.max(lines, Math.round(el.getBoundingClientRect().height / lh));
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const text = n.data;
        const words: [number, string][] = [...seg.segment(text)].map((s) => [s.index, s.segment]);
        for (const w of keep as string[]) for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + 1)) words.push([i, w]);
        for (const [i, w] of words) {
          if (w.length < 2 || !/[฀-๿]/.test(w)) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + w.length);
          const tops = [...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top));
          const distinct = tops.filter((t, k) => tops.findIndex((u) => Math.abs(u - t) < 4) === k);
          if (distinct.length > 1) broken.push(w);
        }
      }
    }
    return { broken, lines };
  }, [selector, THAI_KEEP_WHOLE] as const);
}

test("Thai at 390: the H1 and the selection-flow boxes never break inside a word", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, P20_FIXTURES.slr, "th");
  const h1 = await brokenWords(page, "h1");
  expect(h1.lines).toBeGreaterThan(1); // the question wraps, so the check means something
  expect(h1.broken).toEqual([]);
  const flow = await brokenWords(page, "[data-flow-box], [data-flow-stage] > p");
  expect(flow.broken).toEqual([]);
  // headings, the summary-of-findings cells and the literature-matrix cards too
  expect((await brokenWords(page, "main h2, main h3, [data-sof-row] th, [data-lit-card] dd")).broken).toEqual([]);
  await page.locator("[data-prisma-flow]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("th-390-flow") });
});

test("reading size: Thai 17px / 1.75, English the body size (16px / 1.7)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const size = () => page.locator("[data-limitation]").first().evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).lineHeight]);
  await open(page, P20_FIXTURES.slr, "th");
  expect(await size()).toEqual(["17px", `${17 * 1.75}px`]);
  await open(page, P20_FIXTURES_EN.slr, "en");
  expect(await size()).toEqual(["16px", `${16 * 1.7}px`]);
});

test("a Thai report switched to English: the page, the header and the footer switch with it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, P20_FIXTURES.slr, "th");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.locator("footer")).toContainText("Not medical advice");
  await expect(page.getByRole("heading", { level: 2, name: "Bottom line" })).toBeVisible();
});

test("zero included: the flow comes before 'Try this', with a short section list", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, { ...emptyReviewFixture, id: "00000000-0000-4000-8000-0000000000e7" }, "th");
    const tops = await page.evaluate(() => ["h-answer", "h-selection", "h-next", "h-method"]
      .map((id) => document.getElementById(id)!.getBoundingClientRect().top));
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    const nav = page.getByRole("navigation", { name: "ในรายงานนี้" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "ลองแบบนี้" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: shot(`th-empty-${width}`), fullPage: true });
  }
});

test("screenshots: Thai and English reports at 1440 and 390 (top and sections)", async ({ page }) => {
  for (const [lang, review] of [["th", P20_FIXTURES.slr], ["en", P20_FIXTURES_EN.slr], ["en-meta", P20_FIXTURES_EN.meta]] as const) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, review, lang.startsWith("en") ? "en" : "th");
      await page.screenshot({ path: shot(`${lang}-${width}-top`) });
      for (const id of ["h-sof", "h-selection", "h-limitations", "h-method"]) {
        const h = page.locator(`#${id}`);
        if (!(await h.count())) continue;
        await h.scrollIntoViewIfNeeded();
        await page.evaluate((hid) => window.scrollBy(0, document.getElementById(hid)!.getBoundingClientRect().top - 80), id);
        await page.screenshot({ path: shot(`${lang}-${width}-${id.slice(2)}`) });
      }
    }
  }
});
