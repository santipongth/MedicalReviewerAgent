import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { reportLayout, reviewTypeOf, SECTION_ANCHOR } from "../src/lib/review-type";
import {
  dtaReviewFixture, emptyReviewFixture, englishReview, P20_FIXTURES, qualitativeReviewFixture,
} from "../src/test/fixtures";
import type { Review } from "../src/lib/types";
import { json, mockApi } from "./mock-api";

// Plan 20 Task 9: the full report matrix. Every review type × TH/EN × 1440/390 × light/dark: the page renders, axe is
// clean, the page never scrolls sideways, and the table of contents (the "in this report" nav at 390) lists exactly the
// sections SECTIONS_BY_TYPE puts on the page, in its order. Light runs save a full-page screenshot, dark runs a sample,
// to MRA_SHOTS_DIR (e.g. ../.superpowers/p20-final) when set, else test-results/screens/p20-final.
const SHOTS = process.env.MRA_SHOTS_DIR ?? "test-results/screens/p20-final";
mkdirSync(SHOTS, { recursive: true });

const TH: Record<string, Review> = {
  ...P20_FIXTURES,
  qualitative: qualitativeReviewFixture,
  dta: dtaReviewFixture,
  zeroIncluded: { ...emptyReviewFixture, id: "00000000-0000-4000-8000-0000000000f0" },
};
const DARK_SAMPLES = new Set(["slr", "meta", "scoping", "zeroIncluded"]);

async function open(page: Page, review: Review, lang: "th" | "en") {
  await mockApi(page, { [`GET /api/v1/reviews/${review.id}`]: (route) => json(route, 200, review) });
  await page.goto(`/r/${review.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
}

for (const [name, th] of Object.entries(TH)) {
  for (const lang of ["th", "en"] as const) {
    const review = lang === "th" ? th : englishReview(th);
    const type = reviewTypeOf(review.result);
    for (const width of [1440, 390]) {
      for (const scheme of ["light", "dark"] as const) {
        test(`${name} ${lang} ${width} ${scheme}: renders, axe clean, no sideways scroll, contents follow SECTIONS_BY_TYPE`, async ({ page }) => {
          await page.setViewportSize({ width, height: 1000 });
          await page.emulateMedia({ colorScheme: scheme });
          await open(page, review, lang);
          const hasPapers = (review.result?.papers?.length ?? 0) > 0;
          // the contents: the left table of contents from 1280px, else the top "in this report" nav
          const navName = lang === "th" ? (width >= 1280 && hasPapers ? "สารบัญ" : "ในรายงานนี้") : (width >= 1280 && hasPapers ? "Contents" : "In this report");
          const nav = page.getByRole("navigation", { name: navName, exact: true });
          await expect(nav).toBeVisible();
          const hrefs = (await nav.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!))).map((h) => h.slice(1));
          const anchors = reportLayout(type).flatMap(({ id }) => (id === "title" ? [] : [SECTION_ANCHOR[id]]));
          const onPage = await page.evaluate((ids) => ids.filter((id) => document.getElementById(id)), anchors);
          expect(hrefs.filter((h) => h !== "h-next")).toEqual(onPage);
          expect(hasPapers || hrefs.includes("h-next")).toBe(true);
          // each linked heading is on the page, in the same order
          const tops = await page.evaluate((ids) => ids.map((id) => document.getElementById(id)!.getBoundingClientRect().top + scrollY), onPage);
          expect([...tops].sort((a, b) => a - b)).toEqual(tops);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
          const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
          expect(axe.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
          if (scheme === "light" || DARK_SAMPLES.has(name)) {
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({ path: `${SHOTS}/${name}-${lang}-${width}-${scheme}.png`, fullPage: true });
          }
        });
      }
    }
  }
}
