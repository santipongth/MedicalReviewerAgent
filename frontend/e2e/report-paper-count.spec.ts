import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { englishReview, resultN50, resultShortfall, slrP20ReviewFixture } from "../src/test/fixtures";
import type { Review } from "../src/lib/types";
import { json, mockApi } from "./mock-api";

// Plan 21 Task 5: the report states the requested (N), screened (S) and analysed (A) counts in Methods and PRISMA, and a
// shortfall once (prose in Methods, figures in the PRISMA note, one line in Limitations); counts are display-face
// figures, never Martian Mono; axe clean. P21_SHOTS=1 saves the Methods and PRISMA screenshots to ../.superpowers/p21-t5/.

const SHOTS = process.env.P21_SHOTS === "1";
const shot = (name: string) => `${process.env.MRA_SHOTS_DIR ?? "../.superpowers/p21-t5"}/${name}.png`;

async function open(page: Page, review: Review) {
  await mockApi(page, { [`GET /api/v1/reviews/${review.id}`]: (route) => json(route, 200, review) });
  await page.goto(`/r/${review.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const CASES = {
  n50: { th: resultN50, en: englishReview(resultN50) },
  shortfall: { th: resultShortfall, en: englishReview(resultShortfall) },
} as const;

const METHODS_LINE = {
  n50: {
    th: "ผู้ใช้กำหนดให้วิเคราะห์ 50 ฉบับ คัดกรอง 120 ฉบับที่มีบทคัดย่อ วิเคราะห์ 50 ฉบับตามอันดับความเกี่ยวข้อง",
    en: "The user asked for 50 records; 120 records with abstracts were screened and 50 were analysed, in order of relevance",
  },
  shortfall: {
    th: "ผู้ใช้กำหนดให้วิเคราะห์ 50 ฉบับ คัดกรอง 120 ฉบับที่มีบทคัดย่อ วิเคราะห์ 22 ฉบับตามอันดับความเกี่ยวข้อง ผ่านเกณฑ์เพียง 22 ฉบับ จึงวิเคราะห์น้อยกว่าที่กำหนด (ไม่เติมงานที่ไม่ผ่านเกณฑ์)",
    en: "The user asked for 50 records; 120 records with abstracts were screened and 22 were analysed, in order of relevance. Only 22 met the criteria, so fewer than requested were analysed (none were added to make up the number)",
  },
} as const;

const NOTE = { n50: { th: "ขอ 50 ฉบับ", en: "50 requested" }, shortfall: { th: "ผ่านเกณฑ์ 22 จากที่ขอ 50", en: "22 eligible of 50 requested" } } as const;

for (const key of ["n50", "shortfall"] as const) {
  for (const lang of ["th", "en"] as const) {
    test(`${key} (${lang}): Methods, PRISMA and Limitations state N, S and A; the shortfall is said once`, async ({ page }) => {
      await open(page, CASES[key][lang]);
      const methods = page.locator("section[aria-labelledby=h-method]");
      await expect(methods.locator("[data-methods-line=max]")).toHaveText(METHODS_LINE[key][lang]);
      const flow = page.locator("[data-prisma-flow]");
      const note = flow.locator("[data-flow-box=included] [data-count-note]");
      await expect(note).toHaveText(NOTE[key][lang]);
      await expect(flow.locator("[data-flow-line=over_limit]")).toContainText(lang === "th" ? "ผ่านเกณฑ์แต่เกินจำนวนที่กำหนด (50 ฉบับ)" : "Eligible but beyond the requested 50");
      // counts: the display face with tabular figures, never the verified-number face
      for (const el of [note, methods.locator("[data-methods-line=max]")]) {
        const faces = await el.locator(".tabular-nums").evaluateAll((els) => els.map((e) => [getComputedStyle(e).fontFamily, getComputedStyle(e).fontVariantNumeric]));
        expect(faces.length).toBeGreaterThan(0);
        for (const [family, numeric] of faces) {
          expect(family).not.toMatch(/Martian/i);
          expect(numeric).toContain("tabular-nums");
        }
      }
      const short = page.locator("[data-limitation=shortfall]");
      if (key === "shortfall") {
        await expect(short).toHaveText(lang === "th" ? "วิเคราะห์น้อยกว่าที่ขอ: ผ่านเกณฑ์ 22 จาก 50 ฉบับ (ดูวิธีการ)" : "Fewer than requested were analysed: 22 eligible of 50 (see Methods)");
        // the honest sentence appears once on the page
        await expect(page.getByText(lang === "th" ? /ไม่เติมงานที่ไม่ผ่านเกณฑ์/ : /none were added to make up the number/)).toHaveCount(1);
      } else {
        await expect(short).toHaveCount(0);
      }
    });
  }
}

test("a result from before Plan 21 keeps the old Methods line, PRISMA label and no count note", async ({ page }) => {
  await open(page, slrP20ReviewFixture);
  await expect(page.locator("[data-methods-line=max]")).toHaveText("วิเคราะห์สูงสุด 30 ฉบับตามอันดับความเกี่ยวข้อง");
  await expect(page.locator("[data-flow-line=over_limit]")).toContainText("เกินจำนวนที่วิเคราะห์ (สูงสุด 30)");
  await expect(page.locator("[data-count-note]")).toHaveCount(0);
  await expect(page.locator("[data-limitation=shortfall]")).toHaveCount(0);
});

// M5 (Task 6): the longer English note in the included box at 390px too
for (const [width, lang] of [[1440, "th"], [390, "th"], [390, "en"]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`shortfall (${lang}) at ${width}px, ${scheme}, the flow's table open: axe clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, CASES.shortfall[lang]);
      await page.locator("[data-prisma-flow]").getByText(lang === "th" ? "ดูแผนภาพนี้เป็นตาราง" : "Show the flow as a table").click();
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}

if (SHOTS) {
  for (const key of ["n50", "shortfall"] as const) {
    for (const lang of ["th", "en"] as const) {
      test(`screenshots: ${key} ${lang}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
        await open(page, CASES[key][lang]);
        for (const [name, sel] of [["prisma", "section[aria-labelledby=h-selection]"], ["methods", "section[aria-labelledby=h-method]"],
          ["limitations", "section[aria-labelledby=h-limitations]"]] as const) {
          // sticky header, nav and table of contents would cover the element in an element screenshot
          await page.locator(sel).screenshot({ path: shot(`${key}_${lang}_${name}`),
            style: "header, nav, [class*=sticky] { position: static !important; }" });
        }
      });
    }
  }
}
