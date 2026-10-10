import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { Review } from "../src/lib/types";
import { emptyAnswerP20ReviewFixture, engineP20ReviewFixture } from "../src/test/fixtures";
import { json, mockApi } from "./mock-api";

// Plan 20 Task 11: the merged engine fields in the real app: per-finding certainty, a related report of the same trial
// (paper list and source rail), a review-discordant conflict set apart from an ordinary one, and an empty answer.
// 1440 and 390, light and dark, axe clean, no page-level horizontal scroll. P20_SHOTS=1 also saves screenshots to
// ../.superpowers/p20-t11/.

const SHOTS = process.env.P20_SHOTS === "1";
const shot = (name: string) => `../.superpowers/p20-t11/${name}.png`;

async function open(page: Page, review: Review) {
  await mockApi(page, { [`GET /api/v1/reviews/${review.id}`]: (route) => json(route, 200, review) });
  await page.goto(`/r/${review.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const section = (page: Page, id: string) => page.locator(`section[aria-labelledby=${id}]`);

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    const tag = `${width}_${scheme}`;

    test(`engine fields at ${width}px, ${scheme}: per-finding certainty, related report, discordant conflict; axe clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, engineP20ReviewFixture);

      // per-finding certainty: ⊕ marks and the level word on every key finding
      const findings = section(page, "h-key-findings").locator("[data-key-finding]");
      await expect(findings).toHaveCount(2);
      for (const f of await findings.all()) {
        await expect(f.locator("[data-finding-certainty]")).toContainText("ต่ำ");
        await expect(f.locator("[data-finding-certainty] [data-certainty=low] svg")).toBeVisible();
      }
      // the fixed lead clause is plain prose in the reading face, never the quote face
      const lead = findings.first().locator("[data-prose]");
      await expect(lead).toHaveText(/^หลักฐานที่มีความเชื่อมั่นต่ำชี้ว่า: /);
      expect(await lead.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/Source Serif/i);
      // the SoF table drops the review-level label: every row carries the finding's own value
      await expect(section(page, "h-sof").locator("[data-review-level]")).toHaveCount(0);
      if (SHOTS) {
        await section(page, "h-answer").screenshot({ path: shot(`bottomline_${tag}`) });
        await section(page, "h-key-findings").screenshot({ path: shot(`keyfindings_${tag}`) });
        await section(page, "h-sof").screenshot({ path: shot(`sof_${tag}`) });
      }

      // review-discordant conflict: labelled, a different card from the ordinary conflict, and the grade note
      const claims = section(page, "h-claims");
      const discordant = claims.locator("[data-review-discordant]");
      await expect(discordant).toHaveCount(1);
      await expect(discordant).toContainText("การทบทวนอย่างเป็นระบบกับการศึกษาปฐมภูมิให้ผลต่างกัน");
      const ordinary = claims.locator("[data-conflict]:not([data-review-discordant])");
      const bg = (l: typeof ordinary) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(await bg(discordant)).not.toBe(await bg(ordinary));
      await expect(claims.locator("[data-discordant-note]")).toContainText("ไม่ลดระดับความแข็งแรงของหลักฐาน");
      if (SHOTS) await claims.screenshot({ path: shot(`claims_${tag}`) });

      // the title block counts studies, the related report aside
      await expect(page.locator("[data-related-count]")).toContainText("รายงานเพิ่มเติมของการทดลองเดียวกันอีก 1 ฉบับ");
      // the related report in the paper list, and in the rail with a way back to its primary
      const papers = section(page, "h-papers");
      const p6 = papers.getByRole("button", { name: /^P6 / });
      await expect(p6).toContainText("รายงานเพิ่มเติมของ [P1] (การทดลองเดียวกัน)");
      await expect(p6).toContainText("การทดลองเดียวกัน (NCT01234567)");
      await expect(papers.getByRole("button", { name: /^P1 / })).toContainText("รายงานเพิ่มเติมของการทดลองนี้: P6");
      if (SHOTS) await papers.screenshot({ path: shot(`papers_${tag}`) });
      await p6.click();
      const rail = page.getByRole("complementary", { name: /ต้นฉบับ/ });
      const note = rail.locator("[data-related-to=P1]");
      await expect(note).toContainText("รายงานเพิ่มเติมของ [P1] (การทดลองเดียวกัน)");
      if (SHOTS) await rail.screenshot({ path: shot(`rail_${tag}`) });
      await note.getByRole("button", { name: "เปิด P1" }).click();
      await expect(rail).toContainText("ต้นฉบับ · P1");
      await expect(rail.locator("[data-related-reports]")).toContainText("P6");
      if (width < 1024) await rail.getByRole("button", { name: "ปิด", exact: true }).click();

      expect(await noPageScroll(page)).toBeLessThanOrEqual(0);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    });

    test(`empty answer at ${width}px, ${scheme}: the summary leads, certainty and key findings follow; axe clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, emptyAnswerP20ReviewFixture);
      const answer = section(page, "h-answer");
      await expect(answer.locator("[data-prose]")).toHaveCount(1);
      await expect(answer.locator("[data-prose]")).toHaveText(/^งานวิจัยส่วนใหญ่พบความเสี่ยงต่ำลง/);
      await expect(answer.locator("[data-certainty=low]")).toBeVisible();
      const empty = await answer.locator("p").evaluateAll((ps) => ps.filter((p) => !p.textContent?.trim()).length);
      expect(empty).toBe(0);
      await expect(section(page, "h-key-findings").locator("[data-key-finding]")).toHaveCount(2);
      // with no direct answer the summary already led: no Discussion section repeats it
      await expect(page.locator("#h-discussion")).toHaveCount(0);
      if (SHOTS) await answer.screenshot({ path: shot(`emptyanswer_${tag}`) });
      expect(await noPageScroll(page)).toBeLessThanOrEqual(0);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    });
  }
}

test("English: the related-report and discordant labels follow the report language", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, engineP20ReviewFixture);
  await page.getByRole("button", { name: "English" }).click();
  await expect(section(page, "h-papers").getByRole("button", { name: /^P6 / })).toContainText("Related report of [P1] (same trial)");
  await expect(section(page, "h-claims").locator("[data-review-discordant]")).toContainText("Systematic reviews and primary studies disagree");
  await expect(section(page, "h-key-findings").locator("[data-prose]").first())
    .toHaveText("Low-certainty evidence suggests: Metformin lowers colorectal cancer incidence in most observational studies.");
  if (SHOTS) {
    await section(page, "h-claims").screenshot({ path: shot("claims_en_1440_light") });
    await section(page, "h-key-findings").screenshot({ path: shot("keyfindings_en_1440_light") });
  }
});
