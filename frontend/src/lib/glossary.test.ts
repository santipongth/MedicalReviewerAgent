import { describe, expect, it } from "vitest";
import { GLOSS, GLOSSARY, glossText, type GlossEntry, type GlossKey } from "./glossary";

describe("glossary", () => {
  it("every key has non-empty th and en label and body", () => {
    for (const [k, v] of Object.entries(GLOSSARY)) {
      for (const f of [v.label, v.body]) {
        expect(f.th.trim(), k).not.toBe("");
        expect(f.en.trim(), k).not.toBe("");
      }
    }
  });
});

describe("inline glosses (home page)", () => {
  it("every gloss has a term and a short meaning in both languages", () => {
    const entries: [string, GlossEntry][] = Object.entries(GLOSS);
    for (const [k, v] of entries) {
      for (const f of [v.term, v.name, ...(v.plain ? [v.plain] : [])]) {
        expect(f.th.trim(), k).not.toBe("");
        expect(f.en.trim(), k).not.toBe("");
      }
      // the meaning never just repeats the term, and has no brackets of its own (it is shown inside brackets)
      expect(v.name.th, k).not.toBe(v.term.th);
      for (const s of [v.name.th, v.plain?.th ?? ""]) expect(s, k).not.toMatch(/[()]/);
    }
  });

  it("covers the terms the home page uses", () => {
    const needed: GlossKey[] = [
      "slr", "metaAnalysis", "scopingReview", "narrativeReview",
      "rct", "nonRandomized", "cohort", "caseControl", "crossSectional", "qualitative", "mixedMethods",
      "pico", "pcc", "prisma", "grade", "ratios", "ci95", "i2", "abstract", "api", "mcp",
    ];
    for (const k of needed) expect(GLOSS[k], k).toBeDefined();
  });

  it("formats 'term (meaning)' and, in full, 'term (meaning — plain words)'", () => {
    expect(glossText("pico")).toBe("PICO (กรอบตั้งคำถาม: ผู้ป่วย · สิ่งที่ให้ · สิ่งเปรียบเทียบ · ผลลัพธ์)");
    expect(glossText("slr", "th", { full: true })).toBe(
      "Systematic review (การทบทวนอย่างเป็นระบบ — รวบรวมงานวิจัยทุกชิ้นที่ตอบคำถามเดียวกัน ด้วยขั้นตอนที่ตรวจสอบได้)");
    expect(glossText("rct", "en")).toBe("RCT (randomised controlled trial)");
  });

  it("keeps the plain Thai the brief asked for", () => {
    expect(GLOSS.metaAnalysis.plain?.th).toBe("นำตัวเลขจากหลายงานวิจัยมารวมเป็นผลเดียว");
    expect(GLOSS.ci95.name.th).toBe("ช่วงที่ค่าจริงน่าจะอยู่");
    expect(GLOSS.grade.name.th).toBe("ระบบให้ระดับความน่าเชื่อถือของหลักฐาน");
    expect(GLOSS.crossSectional.plain?.th).toBe("สำรวจ ณ จุดเวลาเดียว");
  });
});
