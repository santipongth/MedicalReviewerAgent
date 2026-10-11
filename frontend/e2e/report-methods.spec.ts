import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { P20_FIXTURES } from "../src/test/fixtures";
import type { Review } from "../src/lib/types";
import { json, mockApi } from "./mock-api";

// Plan 20 Task 4: the PRISMA 2020 / ScR flow (study selection), the risk-of-bias summary and the Methods section in the
// real app, per review type: visible where the type has them, counts in the display face (never Martian Mono), no
// page-level horizontal scroll at 390px, axe clean with the table twin open, in light and dark at 1440 and 390.
// P20_SHOTS=1 also saves screenshots to ../.superpowers/p20-t4/ for review.

const SHOTS = process.env.P20_SHOTS === "1";
const shot = (name: string) => `../.superpowers/p20-t4/${name}.png`;
type Key = keyof typeof P20_FIXTURES;

async function open(page: Page, review: Review) {
  await mockApi(page, { [`GET /api/v1/reviews/${review.id}`]: (route) => json(route, 200, review) });
  await page.goto(`/r/${review.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const HAS_FLOW: Record<Key, boolean> = { slr: true, meta: true, metaNoPool: true, scoping: true, narrative: false, legacy: true };
const HAS_ROB: Record<Key, boolean> = { slr: true, meta: true, metaNoPool: true, scoping: false, narrative: true, legacy: true };

for (const type of Object.keys(P20_FIXTURES) as Key[]) {
  test(`${type}: flow, risk of bias and methods where the type has them (1440)`, async ({ page }) => {
    await open(page, P20_FIXTURES[type]);
    const flow = page.locator("[data-prisma-flow]");
    if (HAS_FLOW[type]) {
      await expect(flow).toBeVisible();
      await expect(flow).toHaveAttribute("data-prisma-flow", type === "scoping" ? "PRISMA-ScR" : "PRISMA 2020");
      await expect(flow.locator("[data-flow-stage]")).toHaveCount(4);
      // the flow's counts are the display face, never the verified face
      const fonts = await flow.locator("[data-flow-box] .tabular-nums").evaluateAll((els) => els.map((e) => getComputedStyle(e).fontFamily));
      expect(fonts.length).toBeGreaterThan(3);
      for (const f of fonts) expect(f).not.toMatch(/Martian/i);
      // wide layout: the exclusion box sits to the right of its stage box
      const main = (await flow.locator("[data-flow-box=identified]").boundingBox())!;
      const side = (await flow.locator("[data-flow-box=removed_before]").boundingBox())!;
      expect(side.x).toBeGreaterThan(main.x + main.width);
    } else {
      await expect(flow).toHaveCount(0);
    }
    const rob = page.locator("section[aria-labelledby=h-rob]");
    if (HAS_ROB[type]) {
      await expect(rob.getByRole("table")).toBeVisible();
      // the legacy fixture is a full-text-era result: its caveat names the text read, not "the abstract"
      await expect(rob.locator("[data-rob-caveat]")).toContainText(type === "legacy" ? "ประเมินจากข้อความที่อ่าน (บทคัดย่อหรือฉบับเต็ม)" : "ประเมินจากบทคัดย่อโดยโมเดล");
      await rob.getByRole("link", { name: /เกณฑ์ที่ใช้/ }).click();
      await expect(page.locator("#m-rob")).toBeInViewport();
    } else {
      await expect(rob).toHaveCount(0);
    }
    const methods = page.locator("section[aria-labelledby=h-method]");
    await expect(methods.locator("[data-methods-part=m-models]")).toBeVisible();
    if (type !== "legacy") await expect(methods.locator("[data-methods-line=searched_at]")).toBeVisible();
  });
}

test("the flow's table twin opens and lists the same counts", async ({ page }) => {
  await open(page, P20_FIXTURES.slr);
  const flow = page.locator("[data-prisma-flow]");
  await flow.getByText("ดูแผนภาพนี้เป็นตาราง").click();
  const table = flow.getByRole("table", { name: /แผนภาพการคัดเลือกงานวิจัย \(PRISMA 2020\)/ });
  await expect(table).toBeVisible();
  await expect(table.getByRole("rowheader", { name: "ระเบียนที่ค้นพบจากฐานข้อมูล" }).locator("xpath=..")).toContainText("55");
});

test("queries are body text in a ruled block, never monospace", async ({ page }) => {
  await open(page, P20_FIXTURES.slr);
  const q = page.getByRole("list", { name: "คำค้น" });
  await expect(q).toBeVisible();
  const font = await q.locator("li span").last().evaluate((e) => getComputedStyle(e).fontFamily);
  expect(font).not.toMatch(/mono|Martian|Consolas|Menlo/i);
});

for (const type of Object.keys(P20_FIXTURES) as Key[]) {
  test(`${type} at 390: the flow is one column and nothing scrolls the page sideways`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, P20_FIXTURES[type]);
    if (HAS_FLOW[type]) {
      const flow = page.locator("[data-prisma-flow]");
      await flow.scrollIntoViewIfNeeded();
      const main = (await flow.locator("[data-flow-box=identified]").boundingBox())!;
      const side = (await flow.locator("[data-flow-box=removed_before]").boundingBox())!;
      expect(side.y).toBeGreaterThan(main.y + main.height);
      await flow.getByText("ดูแผนภาพนี้เป็นตาราง").click();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    for (const type of ["slr", "scoping", "narrative", "legacy"] as const) {
      test(`${type} at ${width}px, ${scheme}, the flow's table open: axe clean`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: scheme });
        await open(page, P20_FIXTURES[type]);
        if (HAS_FLOW[type]) await page.locator("[data-prisma-flow]").getByText("ดูแผนภาพนี้เป็นตาราง").click();
        const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      });
    }
  }
}

if (SHOTS) {
  for (const width of [1440, 390]) {
    for (const scheme of ["light", "dark"] as const) {
      for (const type of ["slr", "meta", "scoping", "legacy"] as const) {
        test(`screenshots: ${type} ${width} ${scheme}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 1000 });
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
          await open(page, P20_FIXTURES[type]);
          for (const [name, sel] of [["flow", "section[aria-labelledby=h-selection]"], ["rob", "section[aria-labelledby=h-rob]"],
            ["methods", "section[aria-labelledby=h-method]"]] as const) {
            const el = page.locator(sel);
            // sticky header, nav and table of contents would cover the element in an element screenshot
            if (await el.count()) await el.screenshot({ path: shot(`${type}_${name}_${width}_${scheme}`),
              style: "header, nav, [class*=sticky] { position: static !important; }" });
          }
        });
      }
    }
  }
}
