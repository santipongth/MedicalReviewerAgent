import { expect, test, type Page } from "@playwright/test";
import { emptyReviewFixture, P20_FIXTURES, P20_FIXTURES_EN, slrP20ReviewFixture } from "../src/test/fixtures";
import type { Review } from "../src/lib/types";
import { json, mockApi } from "./mock-api";

// Plan 20 Task 9: the parked items closed in the real browser: the summary of findings stays a table to assistive tech
// as stacked cards (T3 N1), its clamped "what it means" line opens by keyboard (T3 N2), the selection flow draws one
// connector per stage with no gap (T4 N1, zero included too), and a number never breaks inside Thai text (T7).

async function open(page: Page, review: Review) {
  await mockApi(page, { [`GET /api/v1/reviews/${review.id}`]: (route) => json(route, 200, review) });
  await page.goto(`/r/${review.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const LONG = "งานเชิงสังเกตส่วนใหญ่พบว่าผู้ที่ใช้เมตฟอร์มินมีอุบัติการณ์มะเร็งลำไส้ใหญ่ต่ำกว่าผู้ที่ไม่ได้ใช้ "
  + "แต่ขนาดของผลต่างกันมากระหว่างการศึกษา การปรับตัวแปรกวนไม่ครบ และระยะติดตามสั้นในบางการศึกษา "
  + "จึงยังสรุปไม่ได้ว่าเป็นผลของยาเอง ควรมีการทดลองแบบสุ่มที่ติดตามนานพอ";

/** The SLR fixture with a long first key finding (the summary of findings' "what it means" line). */
const longStatement: Review = {
  ...slrP20ReviewFixture,
  id: "20200000-0000-4000-8000-000000000091",
  result: {
    ...slrP20ReviewFixture.result!,
    synthesis: {
      ...slrP20ReviewFixture.result!.synthesis!,
      key_findings: slrP20ReviewFixture.result!.synthesis!.key_findings!.map((k, i) => (i === 0 ? { ...k, statement: LONG } : k)),
    },
  },
};

for (const [lang, review] of [["th", P20_FIXTURES.slr], ["en", P20_FIXTURES_EN.slr]] as const) {
  test(`summary of findings at 390 (${lang}): stacked cards keep table, row header and cell roles`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, review);
    const table = page.getByRole("table", { name: lang === "th" ? /ตารางสรุปผลการศึกษาตามผลลัพธ์/ : /Summary of findings by outcome/ });
    await expect(table).toBeAttached();
    expect(await table.evaluate((t) => getComputedStyle(t).display)).toBe("block"); // the card layout is on
    const groups = await table.locator("tbody[data-sof-row]").count();
    expect(groups).toBeGreaterThan(1);
    await expect(table.getByRole("rowheader")).toHaveCount(groups);
    await expect(table.getByRole("columnheader")).toHaveCount(4);
    await expect(table.getByRole("row")).toHaveCount(1 + groups * 2);
    await expect(table.getByRole("cell")).toHaveCount(groups * 4);
  });
}

test("the clamped 'what it means' line opens and closes by keyboard (390, Thai)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, longStatement);
  const line = page.locator("[data-sof-statement]").first();
  const more = line.getByRole("button", { name: "อ่านต่อ" });
  await expect(more).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  const text = line.locator("[data-clamp]");
  expect(await text.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
  await more.focus();
  await page.keyboard.press("Enter");
  const less = line.getByRole("button", { name: "ย่อลง" });
  await expect(less).toHaveAttribute("aria-expanded", "true");
  await expect(less).toBeFocused();
  expect(await text.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  expect(await text.innerText()).toContain("ติดตามนานพอ");
  await page.keyboard.press("Space");
  await expect(line.getByRole("button", { name: "อ่านต่อ" })).toHaveAttribute("aria-expanded", "false");
  // a short statement gets no button
  await open(page, P20_FIXTURES.slr);
  await expect(page.locator("[data-sof-statement] button")).toHaveCount(0);
});

for (const [name, review] of [["slr", P20_FIXTURES.slr], ["zero included", { ...emptyReviewFixture, id: "00000000-0000-4000-8000-0000000000e9" }]] as const) {
  test(`selection flow at 1440 (${name}): one connector per stage, the line runs into its arrow with no gap`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, review);
    const stages = await page.evaluate(() => [...document.querySelectorAll("[data-flow-stage]")].map((st) => {
      const shown = (el: Element) => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
      const lines = [...st.querySelectorAll("[data-flow-connector]")].filter(shown).map((e) => e.getBoundingClientRect());
      const arrows = [...st.querySelectorAll("[data-flow-arrow]")].filter(shown).map((e) => e.getBoundingClientRect());
      const main = st.querySelector("[data-flow-box]")!.getBoundingClientRect();
      return { lines: lines.map((r) => ({ top: r.top, bottom: r.bottom, x: r.left + r.width / 2 })),
        arrows: arrows.map((r) => ({ top: r.top, bottom: r.bottom, x: r.left + r.width / 2 })), mainX: main.left + main.width / 2, mainBottom: main.bottom };
    }));
    expect(stages).toHaveLength(4);
    stages.forEach((st, i) => {
      const last = i === stages.length - 1;
      expect(st.arrows, `stage ${i} arrows`).toHaveLength(last ? 0 : 1);
      expect(st.lines.length, `stage ${i} lines`).toBeLessThanOrEqual(last ? 0 : 1);
      if (last) return;
      const a = st.arrows[0];
      expect(Math.abs(a.x - st.mainX), `stage ${i} arrow centred under the box`).toBeLessThan(1.5);
      // the connector (when the side box is taller) starts at the box and ends where the arrow begins
      const top = st.lines.length ? st.lines[0] : null;
      if (top) {
        expect(Math.abs(top.x - st.mainX)).toBeLessThan(1.5);
        expect(Math.abs(top.top - st.mainBottom)).toBeLessThan(1.5);
        expect(Math.abs(a.top - top.bottom), `stage ${i} line meets arrow`).toBeLessThan(1.5);
      } else {
        expect(Math.abs(a.top - st.mainBottom), `stage ${i} arrow meets box`).toBeLessThan(1.5);
      }
    });
  });
}

test("Thai at 390: no number or Latin run breaks across lines", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const review of [P20_FIXTURES.slr, P20_FIXTURES.meta]) {
    await open(page, review);
    const broken = await page.evaluate(() => [...document.querySelectorAll(".th-n")].filter((el) => {
      const tops = [...el.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top));
      return new Set(tops).size > 1;
    }).map((el) => el.textContent));
    expect(await page.locator(".th-n").count()).toBeGreaterThan(5);
    expect(broken).toEqual([]);
  }
});

test("literature matrix at 1440 (English): no column header breaks inside a word", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const review of [P20_FIXTURES_EN.slr, P20_FIXTURES_EN.scoping]) {
    await open(page, review);
    const broken = await page.locator("[data-lit-framework] table").first().evaluate((t) => {
      const out: string[] = [];
      for (const th of t.querySelectorAll("thead th")) {
        const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
          for (const m of n.data.matchAll(/[A-Za-z]{2,}/g)) {
            const r = document.createRange();
            r.setStart(n, m.index);
            r.setEnd(n, m.index + m[0].length);
            const tops = new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
            if (tops.size > 1) out.push(m[0]);
          }
        }
      }
      return out;
    });
    expect(broken).toEqual([]);
  }
});
