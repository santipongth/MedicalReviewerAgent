import { describe, expect, it } from "vitest";
import { GLOSS, GLOSSARY, glossText, type GlossEntry, type GlossKey } from "./glossary";
import { DESIGN_LABEL } from "./i18n";
import { REVIEW_TYPE_LABEL } from "./review-type";

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
      "Systematic review (การทบทวนวรรณกรรมอย่างเป็นระบบ — รวบรวมงานวิจัยทุกชิ้นที่ตอบคำถามเดียวกัน ด้วยขั้นตอนที่ตรวจสอบได้)");
    expect(glossText("rct", "en")).toBe("RCT (randomised controlled trial)");
    expect(glossText("grade", "th", { term: "GRADE-lite", suffix: "แบบย่อ" })).toBe(
      "GRADE-lite (ระบบให้ระดับความแข็งแรงของหลักฐาน แบบย่อ)");
  });

  it("uses the scope form's Thai names for the review types (one name per type)", () => {
    for (const [k, t] of [["slr", "slr"], ["metaAnalysis", "meta_analysis"], ["scopingReview", "scoping"],
      ["narrativeReview", "narrative"]] as const) {
      expect(GLOSS[k].name.th, k).toBe(REVIEW_TYPE_LABEL[t].th);
    }
  });

  it("words the review fixes plainly and accurately", () => {
    expect(GLOSS.logScale.name.th).toBe("แกนที่ค่า 0.5 กับ 2 อยู่ห่างจาก 1 เท่ากัน");
    expect(GLOSS.rct.name.th).toBe("การทดลองแบบสุ่มและมีกลุ่มควบคุม");
    expect(GLOSS.rct.plain?.th).toBe("สุ่มแบ่งคนเป็นกลุ่มที่ได้รับสิ่งที่ทดสอบ กับกลุ่มเปรียบเทียบ เช่น ยาหลอกหรือการรักษาเดิม");
    expect(GLOSS.i2.plain?.th).toBe("ยิ่งสูง ผลของแต่ละงานยิ่งต่างกันมากเกินกว่าที่เกิดจากความบังเอิญ");
  });

  it("keeps the plain Thai the brief asked for", () => {
    expect(GLOSS.metaAnalysis.plain?.th).toBe("นำตัวเลขจากหลายงานวิจัยมารวมเป็นผลเดียว");
    expect(GLOSS.ci95.name.th).toBe("ช่วงที่ค่าจริงน่าจะอยู่");
    expect(GLOSS.grade.name.th).toBe("ระบบให้ระดับความแข็งแรงของหลักฐาน");
    expect(GLOSS.crossSectional.name.th).toBe("การสำรวจ ณ จุดเวลาเดียว");
  });
});

// Final review I2: one name per term. The home page (GLOSS) and the report (GLOSSARY, DESIGN_LABEL) both take the
// name from src/lib/term-names.ts; these tests fail if either side words a shared term its own way again.
describe("one name per term on the home page and in the report", () => {
  it("uses the plainest canonical Thai names", () => {
    expect(GLOSS.rct.name.th).toBe("การทดลองแบบสุ่มและมีกลุ่มควบคุม");
    expect(GLOSS.cohort.name.th).toBe("การศึกษาติดตามกลุ่มคน");
    expect(GLOSS.crossSectional.name.th).toBe("การสำรวจ ณ จุดเวลาเดียว");
  });

  it("a named term's report label is the home page's name", () => {
    const named = ["rct", "nonRandomized", "cohort", "caseControl", "crossSectional", "slr", "scopingReview",
      "narrativeReview", "metaAnalysis"] as const;
    for (const k of named) {
      expect(GLOSSARY[k].label.th, k).toBe(GLOSS[k].name.th);
      expect(GLOSSARY[k].label.en, k).toBe(GLOSS[k].name.en);
    }
  });

  it("a term the home page writes as a word (PICO, 95% CI, …) has that word as the report label", () => {
    for (const k of ["pico", "pcc", "riskOfBias", "ci95", "prisma", "logScale"] as const) {
      expect(GLOSSARY[k].label.th, k).toBe(GLOSS[k].term.th);
      expect(GLOSSARY[k].label.en, k).toBe(GLOSS[k].term.en);
    }
  });

  it("the report's design labels are the home page's term or name, and the Thai-named designs share the name", () => {
    const pairs = [["rct", "rct"], ["non_randomized_trial", "nonRandomized"], ["cohort", "cohort"], ["case_control", "caseControl"],
      ["cross_sectional", "crossSectional"], ["qualitative", "qualitative"], ["mixed_methods", "mixedMethods"],
      ["narrative_review", "narrativeReview"]] as const;
    for (const [d, g] of pairs) expect([GLOSS[g].term.th, GLOSS[g].name.th], d).toContain(DESIGN_LABEL.th[d]);
    for (const [d, g] of [["non_randomized_trial", "nonRandomized"], ["cross_sectional", "crossSectional"],
      ["qualitative", "qualitative"], ["mixed_methods", "mixedMethods"], ["narrative_review", "narrativeReview"]] as const) {
      expect(DESIGN_LABEL.th[d], d).toBe(GLOSS[g].name.th);
    }
    expect(DESIGN_LABEL.th.case_series).toBe(GLOSSARY.caseSeries.label.th);
  });

  it("names the parts of PICO and PCC the same way in both places", () => {
    for (const part of ["ผู้ป่วย", "สิ่งที่ให้", "สิ่งเปรียบเทียบ", "ผลลัพธ์"]) {
      expect(GLOSS.pico.name.th).toContain(part);
      expect(GLOSSARY.pico.body.th).toContain(part);
    }
    for (const part of ["Population", "Intervention", "Comparison", "Outcome"]) {
      expect(GLOSS.pico.name.en).toContain(part);
      expect(GLOSSARY.pico.body.en).toContain(part);
    }
    for (const part of ["ใคร", "เรื่องอะไร", "ในบริบทไหน"]) expect(GLOSSARY.pcc.body.th).toContain(part);
  });

  it("GRADE rates the evidence strength the report names", () => {
    expect(GLOSS.grade.name.th).toContain(GLOSSARY.evidenceStrength.label.th);
    expect(GLOSSARY.srma.label.th).toBe(`${GLOSS.slr.name.th}และ${GLOSS.metaAnalysis.name.th}`);
  });
});
