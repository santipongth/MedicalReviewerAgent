import { describe, expect, it } from "vitest";
import { legacyReviewFixture, metaP20ReviewFixture, reviewFixture, slrP20ReviewFixture } from "@/test/fixtures";
import { offlineLine, offlineMeta } from "./offline-meta";

const AT = new Date("2026-10-11T08:30:00Z");

describe("offlineMeta (Plan 20 Task 8: the offline file's metadata line)", () => {
  it("names the review id, type, search date, generated date, report language and prompt version, in Thai", () => {
    const review = { ...slrP20ReviewFixture, result: { ...slrP20ReviewFixture.result!, prompt_version: "2026-10-10.7" } };
    const meta = offlineMeta(review, AT);
    expect(meta.lang).toBe("th");
    expect(meta.items.map((i) => [i.key, i.label, i.value])).toEqual([
      ["id", "รหัสรีวิว", review.id],
      ["type", "ประเภท", "การทบทวนวรรณกรรมอย่างเป็นระบบ"],
      ["searched", "ค้นเมื่อ", "5 ตุลาคม 2569 (ค.ศ. 2026)"],
      // the same date format as the search date (fix round 1), then the time in UTC
      ["generated", "สร้างไฟล์เมื่อ", "11 ตุลาคม 2569 (ค.ศ. 2026) 08:30 UTC"],
      ["language", "ภาษาของรายงาน", "ภาษาไทย"],
      ["prompt", "เวอร์ชันพรอมต์", "2026-10-10.7"],
    ]);
  });

  it("is all English for an English report", () => {
    const en = { ...metaP20ReviewFixture, language: "en" as const,
      result: { ...metaP20ReviewFixture.result!, language: "en" as const, prompt_version: "2026-10-10.7" } };
    const meta = offlineMeta(en, AT);
    expect(meta.lang).toBe("en");
    expect(meta.items.map((i) => `${i.label}: ${i.value}`)).toEqual([
      `Review ID: ${en.id}`, "Review type: Meta-analysis", "Searched: 5 October 2026", "Generated: 11 October 2026 08:30 UTC",
      "Report language: English", "Prompt version: 2026-10-10.7",
    ]);
    expect(JSON.stringify(meta)).not.toMatch(/[฀-๿]/);
  });

  it("names the labels in the language the reader switched to; the report's own language stays its name", () => {
    const meta = offlineMeta(slrP20ReviewFixture, AT, "en");
    expect(meta.lang).toBe("en");
    expect(meta.items.find((i) => i.key === "language")).toMatchObject({ label: "Report language", value: "ภาษาไทย" });
    expect(meta.items.find((i) => i.key === "type")?.value).toBe("Systematic review");
    expect(offlineLine(slrP20ReviewFixture, AT, "en")).toBe(
      "Offline report · downloaded 11 October 2026 08:30 UTC · automated rapid literature review, not medical advice");
    expect(offlineLine(slrP20ReviewFixture, AT)).toBe(
      "รายงานแบบออฟไลน์ · ดาวน์โหลดเมื่อ 11 ตุลาคม 2569 (ค.ศ. 2026) 08:30 UTC · การทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติ ไม่ใช่คำแนะนำทางการแพทย์");
  });

  it("falls back to the created date when the search date was not recorded, and says what is unknown", () => {
    const meta = offlineMeta(reviewFixture, AT); // no methods, no prompt_version, no review_type
    const byKey = Object.fromEntries(meta.items.map((i) => [i.key, i]));
    expect(byKey.searched).toBeUndefined();
    expect(byKey.created).toMatchObject({ label: "สร้างรีวิวเมื่อ", value: "5 ตุลาคม 2569 (ค.ศ. 2026)" });
    expect(byKey.prompt.value).toBe("ไม่ทราบ");
    expect(byKey.type.value).toBe("รูปแบบเดิม (ก่อนมีประเภทรีวิว)");
    expect(offlineMeta(legacyReviewFixture, AT).items.find((i) => i.key === "type")?.value).toBe("รูปแบบเดิม (ก่อนมีประเภทรีวิว)");
  });
});
