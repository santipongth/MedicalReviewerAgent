import { describe, expect, it } from "vitest";
import { slrP20ReviewFixture, scopingP20ReviewFixture } from "@/test/fixtures";
import { harmsGap, hasDosingAdvice, needsDosingNotice, reportsHarms } from "./safety";
import type { Paper, ReviewResult } from "./types";

const slr = slrP20ReviewFixture.result!;

/** The paper with one more outcome on its card(s); a paper without a card (a failed read) is returned as it is. */
function withOutcome(p: Paper, outcome: string): Paper {
  if (!p.card) return p;
  const add = { outcome, result: "reported", direction: "null" as const };
  return { ...p, card: { ...p.card, outcomes: [...p.card.outcomes, add] },
    card_en: p.card_en ? { ...p.card_en, outcomes: [...p.card_en.outcomes, add] } : p.card_en };
}

describe("harmsGap: abstracts often leave harms out", () => {
  it("a prevention question whose studies report no harms outcome shows the gap", () => {
    const gap = harmsGap(slr);
    expect(gap).not.toBeNull();
    expect(gap!.reporting).toBe(0);
    expect(gap!.studies).toBeGreaterThan(0);
  });

  it("counts the studies that report adverse events, English or Thai", () => {
    const papers = slr.papers!.map((p, i) => (i === 0 ? withOutcome(p, "Serious adverse events") : i === 1 ? withOutcome(p, "ผลข้างเคียง") : p));
    expect(harmsGap({ ...slr, papers })!.reporting).toBe(2);
    expect(reportsHarms({ ...slr.papers![0].card!, outcomes: [{ outcome: "Gastrointestinal tolerability", result: "x", direction: "null" }] })).toBe(true);
    expect(reportsHarms({ ...slr.papers![0].card!, outcomes: [{ outcome: "CRC incidence", result: "lower", direction: "positive" }] })).toBe(false);
  });

  it("efficacy composites (MACE and the like) are not harms reporting", () => {
    for (const outcome of ["Major adverse cardiovascular events", "Major adverse kidney events", "Adverse pregnancy outcomes",
      "Diabetic complications", "เหตุการณ์ไม่พึงประสงค์ทางหัวใจ"]) {
      expect(reportsHarms({ ...slr.papers![0].card!, outcomes: [{ outcome, result: "lower", direction: "positive" }] })).toBe(false);
    }
    const papers = slr.papers!.map((p) => withOutcome(p, "Major adverse cardiovascular events"));
    expect(harmsGap({ ...slr, papers })).toMatchObject({ reporting: 0 });
  });

  it("organ toxicity counts as harms", () => {
    for (const outcome of ["Hepatotoxicity", "Nephrotoxicity", "Cardiotoxicity"]) {
      expect(reportsHarms({ ...slr.papers![0].card!, outcomes: [{ outcome, result: "x", direction: "null" }] })).toBe(true);
    }
  });

  it("no notice when every study reports harms", () => {
    const papers = slr.papers!.map((p) => withOutcome(p, "Adverse events"));
    expect(harmsGap({ ...slr, papers })).toBeNull();
  });

  it("no notice for other question types, scoping, a missing question type or no studies", () => {
    expect(harmsGap({ ...slr, question: { ...slr.question, question_type: "prevalence" } })).toBeNull();
    expect(harmsGap({ ...slr, question: undefined })).toBeNull();
    expect(harmsGap({ ...scopingP20ReviewFixture.result!, question: { ...slr.question, question_type: "therapy" } })).toBeNull();
    expect(harmsGap({ ...slr, papers: [] })).toBeNull();
    expect(harmsGap(null)).toBeNull();
  });

  it("further reports and designs outside the ticked types are not counted as studies", () => {
    const papers = slr.papers!.map((p, i) => (i === 0 ? p : { ...p, related_to: "P1" }));
    expect(harmsGap({ ...slr, papers })).toEqual({ reporting: 0, studies: 1 });
  });
});

describe("dosing advice: a notice, never a rewrite", () => {
  it.each([
    "Adults should take 500 mg twice daily.",
    "Take 1 g of paracetamol every 6 hours.",
    "Give 10 mg/kg to children with fever.",
    "Do not take more than 4 g a day.",
    "Patients should receive 1,000 IU of vitamin D.",
    "The recommended dose is 5 mg once daily.",
    "ควรรับประทาน 500 มก. วันละ 2 ครั้ง",
    "แนะนำให้กินครั้งละ 1 เม็ด",
    "ผู้ป่วยควรรับประทาน 500 มิลลิกรัม วันละ 2 ครั้ง ควรศึกษาเพิ่มเติม",
    "Adults should take 500 mg daily and future trials should confirm this",
    "Consider 500 mg metformin twice daily.",
    "Start with 2.5 mg and titrate to 10 mg.",
    "Use 2 puffs as needed.",
    "Patients should be started on 10 mg daily.",
    "A dose of 1 g every 6 hours is recommended.",
    "It is recommended to take 1000 IU of vitamin D daily.",
  ])("flags advice: %s", (text) => {
    expect(hasDosingAdvice(text)).toBe(true);
  });

  it.each([
    "Metformin 500 mg twice daily was associated with a lower risk (HR 0.80).",
    "Participants who take 100 mg aspirin daily had fewer events.",
    "Patients were randomized to take 20 mg or placebo.",
    "The use of 500 mg metformin did not change mortality.",
    "Dexamethasone 0.15 mg/kg was given before surgery.",
    "Higher doses (over 2 g) were not studied; take these results with caution.",
    "ผู้ที่ได้รับเมตฟอร์มิน 500 มก. วันละ 2 ครั้งมีความเสี่ยงต่ำลง",
    "ควรตีความผลอย่างระมัดระวัง เพราะงานส่วนใหญ่เป็นงานเชิงสังเกต",
    "Participants were given 500 mg",
    "Patients took 20 mg",
    "Patients were asked to take 2 tablets",
    "Investigators administered 0.5 mg/kg",
    "Those who did not take 100 mg aspirin had more events.",
    "The trials should use 500 mg doses in future work.",
    "ควรศึกษาเพิ่มเติมในขนาดยา 10 มก.",
    "งานวิจัยในอนาคตควรเปรียบเทียบขนาด 5 มก. กับ 10 มก.",
    "",
  ])("leaves study conditions alone: %s", (text) => {
    expect(hasDosingAdvice(text)).toBe(false);
  });

  it("checks the answer, the summary and the key findings in both languages", () => {
    expect(needsDosingNotice(slr)).toBe(false);
    const advice: ReviewResult = { ...slr, synthesis_en: { ...slr.synthesis_en!, key_findings: [
      { outcome: "x", statement: "Adults should take 500 mg twice daily.", refs: ["P1"], k: 1 }] } };
    expect(needsDosingNotice(advice)).toBe(true);
    expect(needsDosingNotice({ summary: "ควรรับประทาน 500 มก. วันละ 2 ครั้ง" })).toBe(true);
    expect(needsDosingNotice(null)).toBe(false);
  });
});

describe("Plan 31 D19: the dosing scan reads every model-written text", () => {
  const ADVICE = "Adults should take 500 mg twice daily.";
  const base = { ...slr, summary: "", synthesis: { ...slr.synthesis!, answer: "", executive_summary: "", key_findings: [],
    consensus: [], conflicts: [], evidence_rationale: "", research_gaps: [] } };
  const cluster = { statement: "s", refs: ["P1"], explanation: "e" };
  const cases: [string, (t: string) => Partial<NonNullable<ReviewResult["synthesis"]>>][] = [
    ["consensus statement", (t) => ({ consensus: [{ ...cluster, statement: t }] })],
    ["conflict explanation", (t) => ({ conflicts: [{ ...cluster, explanation: t }] })],
    ["conflict likely reason", (t) => ({ conflicts: [{ ...cluster, likely_reasons: [t] }] })],
    ["evidence rationale", (t) => ({ evidence_rationale: t })],
    ["research gap", (t) => ({ research_gaps: [t] })],
  ];
  for (const [name, make] of cases) {
    for (const key of ["synthesis", "synthesis_en"] as const) {
      it(`${name} in ${key}`, () => {
        const withText = (t: string): ReviewResult => ({ ...base, [key]: { ...base.synthesis, ...make(t) } });
        expect(needsDosingNotice(withText(ADVICE))).toBe(true);
        expect(needsDosingNotice(withText("More trials are needed."))).toBe(false);
      });
    }
  }
});
