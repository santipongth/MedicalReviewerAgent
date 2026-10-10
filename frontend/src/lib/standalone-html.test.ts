import { describe, expect, it } from "vitest";
import { buildStandaloneHtml } from "./standalone-html";
import { reviewFixture } from "@/test/fixtures";

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
    expect(header).toContain("Offline report · downloaded 2026-10-05 10:00 UTC");
    expect(header).toContain("not medical advice");
    expect(header).not.toMatch(/[฀-๿]/);
    const th = buildStandaloneHtml(reviewFixture, ASSETS, new Date("2026-10-05T10:00:00Z")).match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(th).toContain("รายงานแบบออฟไลน์ · ดาวน์โหลดเมื่อ 2026-10-05 10:00 UTC");
  });

  it("never waits for web fonts before showing the report (offline or on a flaky network)", () => {
    const html = buildStandaloneHtml(reviewFixture, ASSETS);
    const link = html.match(/<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/)?.[0] ?? "";
    expect(link).toContain('media="print"');
    expect(link).toContain("onload=");
  });

  it("cannot be broken out of by data or code that contains </script>", () => {
    const evil = { ...reviewFixture, topic: "</script><script>alert(1)</script>" };
    const html = buildStandaloneHtml(evil, { js: "var s='</script>';", css: "" }, new Date());
    expect(html).not.toContain("<script>alert(1)");
    expect(html.match(/<\/script>/g)?.length).toBe(2); // only our own two script blocks close
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain("<title>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; · Medical Reviewer Agent</title>");
  });
});
