import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { buildStandaloneHtml } from "../src/lib/standalone-html";
import { metaP20ReviewFixture, P20_FIXTURES, P20_FIXTURES_EN, resultFixture, slrP20ReviewFixture } from "../src/test/fixtures";
import type { Review } from "../src/lib/types";
import { json, mockApi } from "./mock-api";
import { blankPagesInside, overlappingText, pdfTextRuns } from "./pdf-layout";

// Plan 20 Task 8: the report prints as a report-grade PDF (controls hidden, every disclosure open, clamps removed,
// tables whole, the verified tape as an underline plus ✓, light theme), ends with the verified-numbers appendix, and the
// offline file opens with no network at all. PDFs and screenshots go to MRA_SHOTS_DIR (e.g. ../.superpowers/p20-t8)
// when set, else test-results/screens/p20-t8.
const SHOTS = process.env.MRA_SHOTS_DIR ?? "test-results/screens/p20-t8";
mkdirSync(SHOTS, { recursive: true });
const out = (name: string) => `${SHOTS}/${name}`;

const PRINT = { format: "A4" as const, preferCSSPageSize: true };

/** 32 records: the literature matrix has three pages on screen, one table of every row on paper. */
const manySlr: Review = {
  ...slrP20ReviewFixture,
  id: "20200000-0000-4000-8000-000000000081",
  result: {
    ...slrP20ReviewFixture.result!,
    papers: [
      ...slrP20ReviewFixture.result!.papers!,
      ...Array.from({ length: 27 }, (_, i) => ({ ...resultFixture.papers![2], ref: `P${i + 6}`, title: `Cohort study ${i + 6}` })),
    ],
  },
};

const CASES: [string, Review, "th" | "en"][] = [
  ["slr-th", manySlr, "th"],
  ["slr-en", P20_FIXTURES_EN.slr, "en"],
  ["meta-th", metaP20ReviewFixture, "th"],
  ["meta-en", P20_FIXTURES_EN.meta, "en"],
];

async function open(page: Page, review: Review) {
  await mockApi(page, { [`GET /api/v1/reviews/${review.id}`]: (route) => json(route, 200, review) });
  await page.goto(`/r/${review.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** What the print stylesheet does, read from the page in print media. */
async function printState(page: Page) {
  return page.evaluate(() => {
    const report = document.querySelector("[data-report]")!;
    const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== "none" && (el as HTMLElement).offsetParent !== null;
    const after = (sel: string) => {
      const el = report.querySelector(sel);
      return el ? getComputedStyle(el, "::after").content : null;
    };
    const tape = report.querySelector(".num-verified");
    return {
      nav: [...report.querySelectorAll("nav")].some((n) => shown(n) && !n.closest("[data-lit-pager]")),
      toggles: [...report.querySelectorAll("figure button[aria-pressed]")].some(shown),
      copy: [...report.querySelectorAll("button")].some((b) => shown(b) && /คัดลอก|Copy/.test(b.textContent ?? "")),
      rail: shown(report.querySelector("aside[data-source-rail]")),
      railExists: !!report.querySelector("aside[data-source-rail]"),
      notice: shown(report.querySelector("aside[data-notice]")), // Plan 26: the fixed notices print
      filters: [...report.querySelectorAll("button[aria-expanded]")].some((b) => shown(b) && /^(กรอง|Filter)/.test(b.textContent ?? "")),
      print: [...report.querySelectorAll("button")].some((b) => shown(b) && /^(พิมพ์|Print)$/.test(b.textContent ?? "")),
      scrollHints: [...report.querySelectorAll("[data-scroll-hint]")].some(shown),
      masks: [...report.querySelectorAll(".edge-fade")].map((e) => getComputedStyle(e).maskImage).filter((m) => m !== "none"),
      clamps: [...report.querySelectorAll(".line-clamp-2, .line-clamp-3")].map((e) => getComputedStyle(e).webkitLineClamp).filter((v) => v !== "none"),
      closed: [...report.querySelectorAll("details")].filter((d) => !d.open).length,
      tapeAfter: after(".num-verified"),
      tapeDecoration: tape ? getComputedStyle(tape).textDecorationLine : null,
      tapeFace: tape ? getComputedStyle(tape).fontFamily : null,
      hole: (() => { const h = report.querySelector(".hole[data-print-label]"); return h ? getComputedStyle(h, "::before").content : null; })(),
      computedTag: [...report.querySelectorAll(".computed-tag")].some(shown),
      body: getComputedStyle(document.body).backgroundColor,
      theme: document.documentElement.getAttribute("data-theme"),
      siteHeader: shown(document.querySelector("body > header")),
    };
  });
}

for (const [name, review, lang] of CASES) {
  test(`print ${name}: controls hidden, disclosures open, clamps removed, the tape an underline with ✓; PDF saved`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, review);
    const report = page.locator("[data-report]");
    await expect(report.locator("details:not([open])").first()).toBeAttached();

    await page.emulateMedia({ media: "print" });
    // the browser fires beforeprint when it prints; emulating the media alone does not
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    const s = await printState(page);
    expect(s).toMatchObject({
      nav: false, toggles: false, copy: false, rail: false, filters: false, print: false, scrollHints: false, siteHeader: false,
      masks: [], clamps: [], closed: 0, tapeDecoration: "underline", theme: "light", body: "rgb(255, 255, 255)",
    });
    // a missing rail must not pass as "hidden", and the notices stay on paper (Plan 26 final fix B6)
    expect(s.railExists).toBe(true);
    expect(s.notice).toBe(true);
    expect(s.tapeAfter).toBe('"✓"');
    expect(s.tapeFace).toMatch(/Martian Mono/);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Martian Mono" && f.status === "loaded"))).toBe(true);
    if (s.hole !== null) expect(s.hole).toBe(lang === "th" ? '"[ไม่ได้ตรวจ]"' : '"[unverified]"');
    if (name.startsWith("meta")) expect(s.computedTag).toBe(true); // ComputedNumber keeps its own marking
    await expect(page.locator("[data-print-key]")).toBeVisible(); // the key to the printed marks, on paper only
    // the literature matrix prints one table of every row, never cards or a page of 15
    const lit = page.getByRole("table", { name: lang === "th" ? "ตารางสรุปงานวิจัย" : "Study summary table" });
    await expect(lit.getByRole("rowheader")).toHaveCount(review.result!.papers!.length);
    // the appendix is open and lists the source sentences
    const appendix = page.locator("section[data-appendix]");
    await expect(appendix.getByRole("table").first()).toBeVisible();
    const quote = review.result!.papers!.find((p) => p.card?.outcomes.some((o) => o.effect_value != null))!.card!.outcomes
      .find((o) => o.effect_value != null)!.evidence_quote!;
    await expect(appendix).toContainText(quote);
    await expect(appendix.locator("mark").first()).toBeVisible(); // the number marked in its sentence
    // print-media screenshots at about the width of the A4 text block (182mm ≈ 688px)
    await page.setViewportSize({ width: 720, height: 1020 });
    await page.screenshot({ path: out(`${name}-print-top.png`) });
    await page.locator("section[aria-labelledby=h-sof], section[aria-labelledby=h-characteristics]").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: out(`${name}-print-tables.png`) });
    await page.getByRole("table", { name: lang === "th" ? "ตารางสรุปงานวิจัย" : "Study summary table" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: out(`${name}-print-lit.png`) });
    await appendix.scrollIntoViewIfNeeded();
    await page.screenshot({ path: out(`${name}-print-appendix.png`) });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.emulateMedia({ media: null }); // "screen" would also make page.pdf() print the screen media
    await expect(report.locator("details:not([open])").first()).toBeAttached();

    // a real print: page.pdf() fires beforeprint / afterprint itself
    const pdf = await page.pdf({ ...PRINT, path: out(`${name}.pdf`) });
    expect(pdf.byteLength).toBeGreaterThan(20_000);
    expect(await report.getAttribute("data-printing")).toBeNull(); // back on screen afterwards
    // read back from the paper (fix round 1): no two blocks drawn over each other, no stray empty page
    const pages = pdfTextRuns(out(`${name}.pdf`));
    expect(overlappingText(pages)).toEqual([]);
    expect(blankPagesInside(pages)).toEqual([]);
  });

  // A quick in-browser smoke check only (Task 9): print emulation has no pages, so this DOM rect check passed on the
  // Task 8 build whose PDF had blocks drawn over each other. The authoritative overlap check is the PDF read-back
  // (pdfTextRuns + overlappingText) in the tests around it; keep this one as an early, cheap signal.
  test(`print ${name} at A4 width: the blocks of every section and every figure follow each other, none overlaps`, async ({ page }) => {
    await page.setViewportSize({ width: 688, height: 1000 }); // the A4 text block (182mm)
    await open(page, review);
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    const overlaps = await page.evaluate(() => {
      const found: string[] = [];
      const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : ""}`;
      const parents = new Set<Element>([document.querySelector("main")!, ...document.querySelectorAll("[data-report], [data-report] section, [data-report] figure, [data-report] figure > *")]);
      for (const parent of parents) {
        const kids = [...parent.children].filter((k) => {
          const r = k.getBoundingClientRect();
          return getComputedStyle(k).display !== "none" && r.height > 0 && getComputedStyle(k).position !== "absolute";
        });
        for (let i = 1; i < kids.length; i++) {
          const a = kids[i - 1].getBoundingClientRect();
          const b = kids[i].getBoundingClientRect();
          // stacked blocks: each starts at or below the end of the one before (side by side would share no columns)
          const sideBySide = b.left >= a.right - 1 || b.right <= a.left + 1;
          if (!sideBySide && b.top < a.bottom - 1) found.push(`${name(parent)}: ${name(kids[i - 1])} × ${name(kids[i])}`);
        }
      }
      return found;
    });
    expect(overlaps).toEqual([]);
  });
}

// fix round 1: every review type, in both languages, reads back from paper with no block drawn over another and no
// blank page (the layout bugs the review found showed up only in some page geometries)
for (const lang of ["th", "en"] as const) {
  for (const type of ["slr", "meta", "metaNoPool", "scoping", "narrative", "legacy"] as const) {
    test(`paper layout ${type} ${lang}: no overlapping text, no blank page inside`, async ({ page }) => {
      const review = (lang === "th" ? P20_FIXTURES : P20_FIXTURES_EN)[type];
      await page.setViewportSize({ width: 1440, height: 1000 });
      await open(page, review);
      const file = out(`layout-${type}-${lang}.pdf`);
      await page.pdf({ ...PRINT, path: file });
      const pages = pdfTextRuns(file);
      expect(overlappingText(pages)).toEqual([]);
      expect(blankPagesInside(pages)).toEqual([]);
    });
  }
}

test("print in the dark screen theme: the paper is light, and the dark theme comes back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
  await open(page, metaP20ReviewFixture);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ media: "print" });
  // CSS alone (no beforeprint): the light tokens win over data-theme="dark"
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim())).toBe("#10241e");
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  // the charts are redrawn from the light tokens at the print width
  const forest = page.locator("section[aria-labelledby=h-meta] [data-echart] svg").first();
  await expect(forest).toHaveAttribute("width", "660");
  const fills = await forest.evaluate((svg) => [...svg.querySelectorAll("text")].map((t) => t.getAttribute("fill")));
  expect(fills).toContain("#10241e"); // the light ink
  expect(fills).not.toContain("#ddeae2"); // never the dark theme's ink on paper
  await page.locator("section[aria-labelledby=h-meta] figure").first().screenshot({ path: out("meta-dark-print-forest.png") });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: null }); // "screen" would also make page.pdf() print the screen media
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.pdf({ ...PRINT, path: out("meta-th-dark-screen.pdf") });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(overlappingText(pdfTextRuns(out("meta-th-dark-screen.pdf")))).toEqual([]);
});

test("print: a chart scales down to a narrower page as a vector, never clipped (fix round 1)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, metaP20ReviewFixture);
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.setViewportSize({ width: 480, height: 1000 }); // a text block much narrower than the 660px drawing
  const sizes = await page.locator("[data-report] [data-echart]").evaluateAll((charts) => charts.map((c) => {
    const svg = c.querySelector("svg")!;
    const box = svg.getBoundingClientRect();
    const [, , w, h] = (svg.getAttribute("viewBox") ?? "0 0 0 0").split(" ").map(Number);
    return { container: c.getBoundingClientRect().width, svg: box.width, ratio: box.height / box.width, drawn: h / w,
      clipped: box.right > c.getBoundingClientRect().right + 1 || getComputedStyle(c).overflow === "hidden" && box.height > c.getBoundingClientRect().height + 1 };
  }));
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) {
    expect(s.svg).toBeLessThanOrEqual(s.container + 1);
    expect(s.svg).toBeLessThan(660); // scaled down
    expect(Math.abs(s.ratio - s.drawn)).toBeLessThan(0.02); // in proportion: a vector scale, not a crop
    expect(s.clipped).toBe(false);
  }
});

test("print at phone width: the summary of findings and the literature matrix print as tables", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, manySlr);
  await expect(page.locator("[data-lit-cards]")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(page.locator("[data-lit-cards]")).toHaveCount(0);
  const sof = page.locator("section[aria-labelledby=h-sof] table");
  expect(await sof.evaluate((t) => getComputedStyle(t).display)).toBe("table");
  expect(await sof.locator("thead").evaluate((t) => getComputedStyle(t).display)).toBe("table-header-group");
  await page.pdf({ ...PRINT, path: out("slr-th-phone.pdf") });
  const pages = pdfTextRuns(out("slr-th-phone.pdf"));
  expect(overlappingText(pages)).toEqual([]);
  expect(blankPagesInside(pages)).toEqual([]);
});

/** The downloaded file, opened with every request refused. */
async function openOffline(page: Page, review: Review) {
  const js = readFileSync("standalone-dist/report.js", "utf8");
  const css = readFileSync("standalone-dist/report.css", "utf8");
  const html = buildStandaloneHtml(review, { js, css }, new Date("2026-10-11T08:30:00Z"));
  writeFileSync(out(`offline-${review.id.slice(-2)}.html`), html);
  const requests: string[] = [];
  await page.route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(html, { waitUntil: "load" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return requests;
}

// Task 9: the offline file for slr and meta in both languages
for (const [name, review, lang] of [["slr-th", slrP20ReviewFixture, "th"], ["slr-en", P20_FIXTURES_EN.slr, "en"],
  ["meta-th", metaP20ReviewFixture, "th"], ["meta-en", P20_FIXTURES_EN.meta, "en"]] as const) {
  test(`offline ${name}: renders fully with no network, metadata line, theme toggle, embedded verified face, axe clean`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const withPrompt = { ...review, result: { ...review.result!, prompt_version: "2026-10-10.7" } };
    const requests = await openOffline(page, withPrompt);
    const meta = page.locator("[data-offline-meta]");
    await expect(meta).toContainText(withPrompt.id);
    await expect(meta).toContainText("2026-10-10.7");
    await expect(meta).toContainText(lang === "th" ? "11 ตุลาคม 2569 (ค.ศ. 2026) 08:30 UTC" : "11 October 2026 08:30 UTC");
    if (lang === "en") await expect(page.locator("[data-offline-header]")).not.toContainText(/[฀-๿]/);
    await expect(page.locator("section[data-appendix]")).toBeVisible();
    // Martian Mono is embedded: the face itself is loaded (a check() alone passes when no face matches at all)
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Martian Mono" && f.status === "loaded"))).toBe(true);
    // the theme toggle switches and survives storage that throws (a file opened with storage blocked)
    const toggle = page.locator("#mra-theme button");
    await expect(toggle).toHaveAccessibleName(lang === "th" ? "ใช้ธีมมืด" : "Use the dark theme");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: out(`offline-${name}-dark.png`) });
    for (const theme of ["dark", "light"] as const) {
      if (theme === "light") await toggle.click();
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(axe.violations.map((v) => `${theme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    }
    await page.screenshot({ path: out(`offline-${name}-light.png`) });
    // prints with the same stylesheet: the toggle is not on paper
    await page.emulateMedia({ media: "print" });
    await expect(toggle).toBeHidden();
    await page.emulateMedia({ media: null }); // "screen" would also make page.pdf() print the screen media
    await page.pdf({ ...PRINT, path: out(`offline-${name}.pdf`) });
    const pages = pdfTextRuns(out(`offline-${name}.pdf`));
    expect(overlappingText(pages)).toEqual([]);
    expect(blankPagesInside(pages)).toEqual([]);
    expect(requests).toEqual([]); // nothing was even attempted
  });
}

test("offline: the header line and metadata follow a switch to English", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOffline(page, { ...slrP20ReviewFixture, result: { ...slrP20ReviewFixture.result!, prompt_version: "2026-10-10.7" } });
  const header = page.locator("[data-offline-header]");
  await expect(header).toContainText("รายงานแบบออฟไลน์");
  await page.getByRole("button", { name: "English" }).click();
  await expect(header.locator("[data-offline-line]")).toHaveText(/^Offline report · downloaded 11 October 2026 08:30 UTC/);
  await expect(header.locator("[data-offline-meta]")).toContainText("Prompt version:");
  await expect(header.locator("[data-offline-meta]")).toHaveAttribute("aria-label", "Report file details");
  await expect(header.locator("#mra-theme button")).toHaveAccessibleName("Use the dark theme");
});

test("offline: the remembered theme applies before the first paint", async ({ page }) => {
  await page.goto("about:blank");
  const js = readFileSync("standalone-dist/report.js", "utf8");
  const css = readFileSync("standalone-dist/report.css", "utf8");
  const html = buildStandaloneHtml(slrP20ReviewFixture, { js, css });
  // a served copy of the file, so it has an origin with storage
  await page.route("http://offline.test/report.html", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.route(/^(?!http:\/\/offline\.test\/report\.html$).*/, (route) => route.abort());
  await page.goto("http://offline.test/report.html");
  await page.locator("#mra-theme button").click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#mra-theme button")).toHaveAccessibleName("ใช้ธีมสว่าง");
});
