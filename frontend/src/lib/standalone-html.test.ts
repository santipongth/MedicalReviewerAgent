import { describe, expect, it } from "vitest";
import { buildStandaloneHtml } from "./standalone-html";
import { reviewFixture, slrP20ReviewFixture } from "@/test/fixtures";

const ASSETS = { js: "console.log('app');", css: "body{color:red}" };

describe("buildStandaloneHtml", () => {
  it("embeds the review, the styles and the app in one document", () => {
    const html = buildStandaloneHtml(reviewFixture, ASSETS, new Date("2026-10-05T10:00:00Z"));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("body{color:red}");
    expect(html).toContain("console.log('app');");
    expect(html).toContain("window.__MRA_REVIEW__=");
    expect(html).toContain("<title>เมตฟอร์มินกับมะเร็งลำไส้ใหญ่ · Medical Reviewer Agent</title>");
    expect(html).toContain("ไม่ใช่คำแนะนำทางการแพทย์"); // the disclaimer travels with the file
  });

  it("the offline header follows the report language (Plan 20 Task 7)", () => {
    const en = { ...reviewFixture, language: "en" as const, result: { ...reviewFixture.result!, language: "en" as const } };
    const html = buildStandaloneHtml(en, ASSETS, new Date("2026-10-05T10:00:00Z"));
    expect(html).toContain('<html lang="en">');
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(header).toContain("Offline report · downloaded 5 October 2026 10:00 UTC");
    expect(header).toContain("not medical advice");
    expect(header).not.toMatch(/[฀-๿]/);
    const th = buildStandaloneHtml(reviewFixture, ASSETS, new Date("2026-10-05T10:00:00Z")).match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(th).toContain("รายงานแบบออฟไลน์ · ดาวน์โหลดเมื่อ 5 ตุลาคม 2569 (ค.ศ. 2026) 10:00 UTC");
  });

  it("asks the network for nothing: no web fonts, stylesheets or scripts from elsewhere (Plan 20 Task 8)", () => {
    const html = buildStandaloneHtml(reviewFixture, ASSETS);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toMatch(/@import/);
  });

  it("carries a metadata line in the report language: id, type, search date, generated date, language, prompt version", () => {
    const review = { ...slrP20ReviewFixture, result: { ...slrP20ReviewFixture.result!, prompt_version: "2026-10-10.7" } };
    const header = buildStandaloneHtml(review, ASSETS, new Date("2026-10-11T08:30:00Z")).match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    const meta = header.match(/<dl[^>]*data-offline-meta[\s\S]*?<\/dl>/)?.[0] ?? "";
    for (const text of ["รหัสรีวิว", review.id, "การทบทวนวรรณกรรมอย่างเป็นระบบ", "ค้นเมื่อ", "5 ตุลาคม 2569 (ค.ศ. 2026)",
      "สร้างไฟล์เมื่อ", "11 ตุลาคม 2569 (ค.ศ. 2026) 08:30 UTC", "ภาษาของรายงาน", "ภาษาไทย", "เวอร์ชันพรอมต์", "2026-10-10.7"]) {
      expect(meta).toContain(text);
    }
    const en = { ...review, language: "en" as const, result: { ...review.result, language: "en" as const } };
    const enHeader = buildStandaloneHtml(en, ASSETS, new Date("2026-10-11T08:30:00Z")).match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(enHeader).toContain("Prompt version");
    expect(enHeader).not.toMatch(/[฀-๿]/);
  });

  it("has a slot for the theme toggle (hidden in print) and applies the remembered theme before the first paint", () => {
    const html = buildStandaloneHtml(reviewFixture, ASSETS);
    expect(html).toMatch(/<div id="mra-theme" class="[^"]*print:hidden[^"]*"><\/div>/);
    const head = html.slice(0, html.indexOf("</head>"));
    // a browser that blocks storage for files (or a private window) still opens the report
    expect(head).toMatch(/try\{var t=localStorage\.getItem\("theme"\);if\(t==="dark"\|\|t==="light"\)document\.documentElement\.setAttribute\("data-theme",t\)\}catch\(e\)\{\}/);
  });

  it("cannot be broken out of by data or code that contains </script>", () => {
    const evil = { ...reviewFixture, topic: "</script><script>alert(1)</script>" };
    const html = buildStandaloneHtml(evil, { js: "var s='</script>';", css: "" }, new Date());
    expect(html).not.toContain("<script>alert(1)");
    expect(html.match(/<\/script>/g)?.length).toBe(3); // only our own three script blocks close (theme, data, app)
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain("<title>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; · Medical Reviewer Agent</title>");
  });
});
