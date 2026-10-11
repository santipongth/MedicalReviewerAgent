import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { directionTally } from "../src/lib/charts-data";
import { vancouver } from "../src/lib/citation";
import { buildStandaloneHtml } from "../src/lib/standalone-html";
import type { Review } from "../src/lib/types";
import { engineP20ReviewFixture } from "../src/test/fixtures";
import { json, mockApi } from "./mock-api";

// Plan 20 Task 6: the references (Vancouver, identifier links, copy citation, a related report under its primary, a
// paper not used as evidence), the excluded-at-screening disclosure, how to cite the report and the downloads, in the
// real app at 1440 and 390, light and dark: axe clean and no page-level horizontal scroll. P20_SHOTS=1 also saves
// screenshots to ../.superpowers/p20-t6/.

const SHOTS = process.env.P20_SHOTS === "1";
const shot = (name: string) => `../.superpowers/p20-t6/${name}.png`;

/** The engine fixture (P6 a further report of P1) with P2 left out of the evidence for its design. */
const review: Review = {
  ...engineP20ReviewFixture,
  result: {
    ...engineP20ReviewFixture.result!,
    papers: engineP20ReviewFixture.result!.papers!.map((p) => (p.ref === "P2" ? { ...p, design_excluded: true } : p)),
  },
};

async function open(page: Page, r: Review = review) {
  await mockApi(page, { [`GET /api/v1/reviews/${r.id}`]: (route) => json(route, 200, r) });
  await page.goto(`/r/${r.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const refs = (page: Page) => page.locator("section[aria-labelledby=h-papers]");
const entry = (page: Page, ref: string) => page.locator(`#ref-${ref}`);

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    const tag = `${width}_${scheme}`;

    test(`references, excluded records and how to cite at ${width}px, ${scheme}: axe clean, no sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);

      const list = refs(page);
      await expect(list.getByRole("heading", { level: 2, name: "เอกสารอ้างอิง" })).toBeVisible();
      // P-number order; the further report P6 is under P1, labelled, not a numbered study of its own
      await expect(list.locator("ol > li[data-reference]")).toHaveCount(5);
      await expect(entry(page, "P1").locator("#ref-P6 [data-related-label]")).toHaveText("รายงานเพิ่มเติม");
      const p1 = review.result!.papers!.find((p) => p.ref === "P1")!;
      await expect(entry(page, "P1").locator(":scope > div > [data-citation]")).toHaveText(vancouver(p1));
      await expect(entry(page, "P1").getByRole("link", { name: /^DOI 10\.1000\/p1/ })).toHaveAttribute("href", "https://doi.org/10.1000/p1");
      await expect(entry(page, "P2").locator("[data-reference-note=design_excluded]")).toBeVisible();

      // not evidence (final review I1): P2 is left out of the bottom-line tally and the risk-of-bias counts, with a note
      const all = review.result!.papers!;
      const expected = directionTally(all.filter((p) => p.ref !== "P2" && !p.related_to));
      const withP2 = directionTally(all.map((p) => ({ ...p, design_excluded: false })));
      expect(Object.values(withP2).reduce((a, b) => a + b, 0)).toBe(Object.values(expected).reduce((a, b) => a + b, 0) + 1);
      for (const [d, n] of Object.entries(expected)) {
        const item = page.locator(`[data-direction-tally] > li[data-direction="${d}"]`);
        if (n > 0) await expect(item.locator("span.tabular-nums")).toHaveText(String(n));
        else await expect(item).toHaveCount(0);
      }
      await expect(page.locator("[data-rob-not-evidence]")).toHaveText("ไม่นับ 1 งานที่อ่านแล้วพบว่ารูปแบบการศึกษาไม่ตรงชนิดที่เลือก (ไม่ใช้เป็นหลักฐาน)");

      // the excluded-at-screening disclosure: closed, then the reason counts
      const excluded = list.locator("details[data-excluded-screening]");
      // (the summary also holds the aria-hidden chevron glyphs, Task 9)
      await expect(excluded.locator("summary")).toHaveText(/บทความที่คัดออกในขั้นคัดกรอง \(14\)$/);
      await expect(excluded.getByRole("table")).toBeHidden();
      await excluded.locator("summary").click();
      await expect(excluded.getByRole("table", { name: "เหตุผลที่คัดออกในขั้นคัดกรอง" })).toBeVisible();

      // how to cite: the finished date and the review's own URL, never the viewing time
      const cite = page.locator("[data-how-to-cite]");
      await expect(cite).toContainText("สร้างเมื่อ 2026-10-05");
      await expect(cite).toContainText(`/r/${review.id}.`);
      const downloads = page.getByRole("list", { name: "ดาวน์โหลดรีวิว" });
      await expect(downloads.getByRole("listitem")).toHaveCount(4);

      expect(await noPageScroll(page)).toBeLessThanOrEqual(0);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      if (SHOTS) {
        await list.screenshot({ path: shot(`references_${tag}`) });
        await page.locator("section[aria-labelledby=h-downloads]").screenshot({ path: shot(`cite_downloads_${tag}`) });
      }
    });
  }
}

test("copy citation puts the reference on the clipboard and says so", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const p3 = entry(page, "P3");
  await p3.getByRole("button", { name: "คัดลอกการอ้างอิง P3" }).click();
  await expect(p3.getByRole("status")).toHaveText("คัดลอกแล้ว");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(vancouver(review.result!.papers!.find((p) => p.ref === "P3")!));
  // the report's own citation
  await page.getByRole("button", { name: "คัดลอกการอ้างอิงรายงานนี้" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.locator("[data-how-to-cite]").textContent());
});

for (const width of [1440, 390]) {
  test(`a study opens in the source rail and the rail links back to its reference (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await entry(page, "P3").getByRole("button", { name: /^P3 / }).click();
    const rail = page.getByRole("complementary", { name: "ต้นฉบับ" });
    await expect(rail).toContainText("Metformin use and colorectal cancer risk");
    await rail.getByRole("link", { name: "ดูในเอกสารอ้างอิง (P3)" }).click();
    await expect(page).toHaveURL(/#ref-P3$/);
    await expect(entry(page, "P3")).toBeInViewport();
    // focus lands on the reference itself (on a phone the drawer closes first)
    await expect(entry(page, "P3")).toBeFocused();
    if (width === 390) await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("the offline file cites the report without a URL and has no downloads", async ({ page }) => {
  const js = readFileSync("standalone-dist/report.js", "utf8");
  const css = readFileSync("standalone-dist/report.css", "utf8");
  await page.route("**/*", (route) => route.abort());
  await page.setContent(buildStandaloneHtml(review, { js, css }), { waitUntil: "load" });
  const section = page.locator("section[aria-labelledby=h-downloads]");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText("วิธีอ้างอิงรายงานนี้");
  await expect(section.locator("[data-how-to-cite]")).toContainText(`รหัสรีวิว ${review.id}.`);
  await expect(section.locator("[data-how-to-cite]")).not.toContainText("http");
  await expect(page.getByRole("list", { name: "ดาวน์โหลดรีวิว" })).toHaveCount(0);
  await expect(page.locator("#ref-P1 > div > [data-citation]")).toBeVisible();
});
