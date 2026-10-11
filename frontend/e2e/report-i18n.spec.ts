import { expect, test, type Page } from "@playwright/test";
import { THAI_KEEP_WHOLE } from "../src/lib/text-wrap";
import { emptyReviewFixture, P20_FIXTURES, P20_FIXTURES_EN, slashedThaiReviewFixture } from "../src/test/fixtures";
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

// axe in light and dark at 1440 and 390 for every type and both languages: e2e/report-matrix.spec.ts (Task 9)

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

test("Thai limitations, key findings and methods never break inside a word (1440 and 390, Task 9 fix round 1)", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, P20_FIXTURES.slr, "th");
    const r = await brokenWords(page, "[data-limitation], [data-methods-line], #h-key-findings ~ * p");
    expect(r.lines).toBeGreaterThan(1);
    expect(r.broken).toEqual([]);
  }
});

test("Thai at 390: long slash/dash-joined Thai in the H1, a summary-of-findings cell and the matrix never overflows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, slashedThaiReviewFixture, "th");
  const overflow = await page.evaluate(() => {
    const over = (el: Element | null) => (el ? el.scrollWidth - el.clientWidth : -1);
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h1: over(document.querySelector("h1")),
      sof: over(document.querySelector("[data-sof-row] th")),
      lit: over(document.querySelector("[data-lit-card]")),
      // no Thai word box sticks out past the viewport
      words: [...document.querySelectorAll(".th-w")]
        .filter((w) => w.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map((w) => w.textContent),
    };
  });
  expect(overflow).toEqual({ page: 0, h1: 0, sof: 0, lit: 0, words: [] });
  // the slashes are where the H1 breaks
  expect((await brokenWords(page, "h1")).lines).toBeGreaterThan(2);
  await page.screenshot({ path: shot("th-390-slashed-top") });
  await page.locator("#h-sof").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("th-390-slashed-sof") });
});

test("an English report paints its first frame with the English header (no Thai flash)", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __firstReportFrame?: string };
    const tick = () => {
      if (w.__firstReportFrame === undefined && document.querySelector("h1")) {
        w.__firstReportFrame = document.querySelector("header nav")?.textContent ?? "";
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, P20_FIXTURES_EN.slr, "en");
  const first = await page.evaluate(() => (window as unknown as { __firstReportFrame?: string }).__firstReportFrame);
  expect(first).toContain("Literature review");
  expect(first).not.toMatch(THAI);
});

/** English allowed in a Thai report's chrome: abbreviations and names that the report glosses or that have no Thai form.
 * Task 9 (T7 parked): a string passes only if every Latin word in it is allow-listed, Thai around it or not; before,
 * any string containing one Thai letter passed whole ("ตาราง Summary of findings" would have). */
// The design names "RCT", "Cohort", "Case-control" and "Mendelian randomization" are the Thai labels too (DESIGN_LABEL.th).
const SHARED_PHRASES = ["Medical Reviewer Agent", "Europe PMC", "Mendelian randomization", "Case-control", "GRADE-lite", "95% CI",
  "SR/MA", "SE (ln)", "Forest plot", "PRISMA-ScR", "PRISMA 2020"];
const SHARED_WORDS = new Set(["k", "n", "SE", "CI", "AUC", "HR", "OR", "RR", "MD", "SMD", "RD", "r", "PICO", "PCC", "PICo", "HTML",
  "Markdown", "CSV", "JSON", "PubMed", "OpenAlex", "RCT", "Cohort", "PRISMA", "GRADE",
  // the question framework's letters (PICO, PECO, PCC, SPIDER): "C · ตัวเปรียบเทียบ"
  "P", "I", "C", "O", "E", "S", "D", "R", "PI", "Q"]);
/** A study's label: its code, first author and year are names (data), e.g. "P3 Lindqvist 2021". Only that prefix is
 * exempt; the rest of the string is still checked (fix round 1: "P3 Summary of findings" no longer passes whole). */
const STUDY_LABEL = /^P\d+(?: [\p{Lu}][\p{L}'’-]+(?: et al\.?)?)?(?: \d{4})?/u;

/** The English words of `t` that are not allow-listed (study codes such as P3 are names). */
function unlistedEnglish(t: string): string[] {
  let rest = t.replace(STUDY_LABEL, " ");
  for (const p of SHARED_PHRASES) rest = rest.split(p).join(" ");
  return (rest.match(/[A-Za-z][A-Za-z'’]*(?:-[A-Za-z]+)*/g) ?? []).filter((w) => !SHARED_WORDS.has(w) && !/^P\d*$/.test(w));
}

test("the Thai allow-list flags English inside a Thai string (Task 9)", () => {
  expect(unlistedEnglish("ตาราง Summary of findings")).toEqual(["Summary", "of", "findings"]);
  expect(unlistedEnglish("ค่า HR (95% CI) จาก P3")).toEqual([]);
  expect(unlistedEnglish("Forest plot: อุบัติการณ์")).toEqual([]);
  expect(unlistedEnglish("Cohort 2")).toEqual([]);
  expect(unlistedEnglish("แนวคิด (Concept)")).toEqual(["Concept"]);
  expect(unlistedEnglish("P3 Lindqvist 2021")).toEqual([]);
  expect(unlistedEnglish("P5 Stub 2022SR/MA")).toEqual([]);
  expect(unlistedEnglish("P3 Summary of findings")).toEqual(["of", "findings"]);
});

for (const type of TYPES) {
  test(`${type} in Thai: no English in the chrome beyond glossed abbreviations and names`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, P20_FIXTURES[type], "th");
    const english = await page.evaluate(() => {
      const els = document.querySelectorAll([
        "main h2", "main summary", "main th[scope=col]", "main legend", "main label", "main figcaption", "main caption",
        "main nav[aria-label]", "main [role=region][aria-label]", "main [role=group][aria-label]", "main ul[aria-label]",
        "main ol[aria-label]", "main dl[aria-label]", "main dt", "header nav", "footer h2", "footer nav[aria-label]",
      ].join(","));
      const out: string[] = [];
      for (const el of els) {
        const label = el.getAttribute("aria-label");
        if (label) out.push(label.trim());
        else if (!el.matches("[aria-label]")) out.push((el.textContent ?? "").trim());
      }
      return out.filter(Boolean);
    });
    expect(english.length).toBeGreaterThan(20);
    expect(english.filter((t) => unlistedEnglish(t).length).map((t) => `${t} → ${unlistedEnglish(t).join(" ")}`)).toEqual([]);
  });
}

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
