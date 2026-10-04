// Realistic result shaped exactly like the backend's finalize output (sample data for tests and e2e mocks).
import type { Paper, PaperCard, Review, ReviewResult } from "@/lib/types";

const q3 = "Metformin use was associated with a lower risk of colorectal cancer (HR 0.80, 95% CI 0.71–0.90; p = 0.003).";
const q1 = "Users of metformin had a lower incidence of colorectal cancer than users of sulfonylureas (HR 0.86, 95% CI 0.77–0.96).";
const q4 = "Within two years of initiation, metformin users had higher colorectal cancer detection (HR 1.28, 95% CI 1.05–1.56).";

function card(over: Partial<PaperCard>): PaperCard {
  return {
    study_design: "cohort", population: "adults with type 2 diabetes", sample_size: null, sample_size_quote: null,
    intervention_or_exposure: "metformin", comparator: "sulfonylurea", outcomes: [], key_findings: [],
    limitations: ["observational design"], funding_or_conflicts: null, risk_of_bias: "moderate",
    overall_direction: "positive", ...over,
  };
}

const verification = (over: Partial<NonNullable<Paper["verification"]>> = {}) => ({
  numbers_verified: 2, numbers_total: 2, agreement: 1, escalated: false, repaired: false, uncertain: false,
  unverified: [], ...over,
});

const p1card = card({
  sample_size: 48210, sample_size_quote: "The cohort included 48,210 adults with type 2 diabetes.",
  outcomes: [{ outcome: "CRC incidence", result: "Lower incidence vs sulfonylureas", evidence_quote: q1,
    effect_size: "HR 0.86 (0.77–0.96)", effect_measure: "HR", effect_value: 0.86, ci_lower: 0.77, ci_upper: 0.96,
    p_value: null, direction: "positive" }],
});
const p2card = card({
  study_design: "case-control", sample_size: null, risk_of_bias: "high", overall_direction: "positive",
  outcomes: [{ outcome: "CRC incidence", result: "Reduced odds with long-term use", evidence_quote: "a sentence that was not found",
    effect_size: null, effect_measure: "none", effect_value: null, ci_lower: null, ci_upper: null, p_value: null,
    direction: "positive" }],
});
const p3card = card({
  sample_size: 1234, sample_size_quote: "We enrolled 1,234 adults with type 2 diabetes in a population-based cohort.",
  risk_of_bias: "low",
  outcomes: [
    { outcome: "CRC incidence", result: "Lower risk of colorectal cancer", evidence_quote: q3, effect_size: "HR 0.80 (0.71–0.90)",
      effect_measure: "HR", effect_value: 0.8, ci_lower: 0.71, ci_upper: 0.9, p_value: 0.003, direction: "positive" },
    { outcome: "CRC mortality", result: "No difference in mortality", evidence_quote: "Mortality did not differ between groups.",
      effect_size: null, effect_measure: "none", effect_value: null, ci_lower: null, ci_upper: null, p_value: null,
      direction: "null" },
  ],
});
const p4card = card({
  sample_size: 6331, sample_size_quote: "A total of 6,331 new metformin users were followed.", overall_direction: "negative",
  outcomes: [{ outcome: "CRC incidence", result: "Higher detection within two years", evidence_quote: q4,
    effect_size: "HR 1.28 (1.05–1.56)", effect_measure: "HR", effect_value: 1.28, ci_lower: 1.05, ci_upper: 1.56,
    p_value: null, direction: "negative" }],
});

export const resultFixture: ReviewResult = {
  topic: "เมตฟอร์มินกับมะเร็งลำไส้ใหญ่",
  english_topic: "metformin and colorectal cancer",
  language: "th",
  question: {
    original_topic: "เมตฟอร์มินกับมะเร็งลำไส้ใหญ่", english_topic: "metformin and colorectal cancer", refined: true,
    interpretation: "คุณอยากรู้ว่าเมตฟอร์มินลดความเสี่ยงมะเร็งลำไส้ใหญ่หรือไม่",
    refined_question: "ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2 เมตฟอร์มินลดอุบัติการณ์มะเร็งลำไส้ใหญ่หรือไม่",
    sub_questions: ["ผลขึ้นกับระยะเวลาการใช้ยาหรือไม่"], assumptions: ["เฉพาะผู้ใหญ่"],
    english: { refined_question: "In adults with type 2 diabetes, does metformin reduce colorectal cancer incidence?",
      interpretation: "Whether metformin lowers colorectal cancer risk.", sub_questions: ["Does duration matter?"],
      assumptions: ["Adults only"] },
    pico: { population: "adults with type 2 diabetes", intervention_or_exposure: "metformin",
      comparator: "no metformin", outcomes: ["CRC incidence"], study_designs: ["cohort", "RCT"], timeframe: null },
    question_type: "prevention", ambiguities: ["Cancer site"],
  },
  summary: "งานวิจัยส่วนใหญ่พบความเสี่ยงต่ำลงในผู้ใช้เมตฟอร์มิน [P1, P3] แต่การศึกษาหนึ่งพบทิศทางตรงข้าม [P4]",
  synthesis: {
    executive_summary: "งานวิจัยส่วนใหญ่พบความเสี่ยงต่ำลงในผู้ใช้เมตฟอร์มิน [P1, P3] แต่การศึกษาหนึ่งพบทิศทางตรงข้าม [P4]",
    comparison: [
      { outcome: "อุบัติการณ์มะเร็งลำไส้ใหญ่", cells: [
        { ref: "P1", finding: "อุบัติการณ์ต่ำกว่ากลุ่มซัลโฟนิลยูเรีย", direction: "positive", effect_measure: "HR", effect_value: 0.86, ci_lower: 0.77, ci_upper: 0.96 },
        { ref: "P2", finding: "โอกาสลดลงเมื่อใช้ยานาน", direction: "positive" },
        { ref: "P3", finding: "ความเสี่ยงต่ำลง", direction: "positive", effect_measure: "HR", effect_value: 0.8, ci_lower: 0.71, ci_upper: 0.9 },
        { ref: "P4", finding: "ตรวจพบมากขึ้นในสองปีแรก", direction: "negative", effect_measure: "HR", effect_value: 1.28, ci_lower: 1.05, ci_upper: 1.56 },
      ] },
      { outcome: "การเสียชีวิตจากมะเร็งลำไส้ใหญ่", cells: [{ ref: "P3", finding: "อัตราตายไม่ต่างกัน", direction: "null" }] },
    ],
    consensus: [{ statement: "อุบัติการณ์: ผลสนับสนุนสมมติฐาน", refs: ["P1", "P3"], explanation: "สองการศึกษาให้ทิศทางเดียวกัน", likely_reasons: [] }],
    conflicts: [{ statement: "อุบัติการณ์: งานวิจัยเห็นต่างกัน", refs: ["P1", "P3", "P4"],
      explanation: "[P4] ติดตามสั้นกว่าและอาจมีอคติจากการตรวจคัดกรองเพิ่มหลังเริ่มยา", likely_reasons: ["ระยะติดตามสั้น", "detection bias"] }],
    evidence_strength: "low", evidence_rationale: "การศึกษาเชิงสังเกตส่วนใหญ่และผลขัดแย้งกัน",
    research_gaps: ["ต้องการ RCT ระยะยาว"], grade_baseline: "very_low",
  },
  synthesis_en: {
    executive_summary: "Most studies found a lower risk among metformin users [P1, P3], but one found the opposite [P4].",
    comparison: [], consensus: [], conflicts: [], evidence_strength: "low", evidence_rationale: "Mostly observational.",
    research_gaps: ["Long-term RCTs"], grade_baseline: "very_low",
  },
  papers: [
    { ref: "P1", title: "Metformin and incident colorectal cancer in a national diabetes cohort", year: 2019,
      journal: "Diabetes Care", doi: "10.1000/p1", pmcid: "PMC100001", relevance: 95,
      card: { ...p1card, population: "ผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2" }, card_en: p1card, verification: verification() },
    { ref: "P2", title: "Biguanide exposure and colorectal neoplasia: a nested case–control study", year: 2017,
      journal: "Gut", doi: "10.1000/p2", relevance: 88, card: p2card, card_en: p2card,
      verification: verification({ numbers_verified: 0, numbers_total: 1, unverified: [{ field: "effect", outcome: "CRC incidence" }] }) },
    { ref: "P3", title: "Metformin use and colorectal cancer risk among adults with type 2 diabetes", year: 2021,
      journal: "BMJ Open", doi: "10.1000/p3", pmid: "3000003", pmcid: "PMC300003", relevance: 93,
      card: p3card, card_en: p3card, verification: verification() },
    { ref: "P4", title: "Short-term metformin initiation and gastrointestinal cancer detection", year: 2020,
      journal: "Cancer Epidemiology", doi: "10.1000/p4", relevance: 81, card: p4card,
      card_en: p4card, verification: verification({ agreement: 0.5, uncertain: true }) },
    { ref: "P5", title: "Antidiabetic drugs and adenoma: cross-sectional analysis", year: 2018, relevance: 70,
      card: null, card_en: null, verification: null,
      error: "extraction failed: LLMOutputError" },
  ],
  queries: ["metformin colorectal cancer", "metformin CRC cohort"],
  stats: { found: 41, unique: 26, with_abstract: 22, candidates: 20, screened: 20, selected: 5, extracted: 4 },
  quality: { numbers_verified: 6, numbers_total: 7, verification_rate: 0.857, papers_uncertain: 1,
    timings: { total: 58.4, read_max: 21.2 } },
  errors: ["extraction failed for P5: LLMOutputError"],
  llm_preset: "budget",
  models: { extractor: "openrouter:deepseek/deepseek-v4-pro" },
  external_context: [],
};

export const reviewFixture: Review = {
  id: "11111111-2222-3333-4444-555555555555", topic: "เมตฟอร์มินกับมะเร็งลำไส้ใหญ่", language: "th", status: "done",
  created_at: "2026-10-05T03:00:00Z", finished_at: "2026-10-05T03:01:00Z", options: {}, progress: null,
  result: resultFixture, error: null, cost_usd: 0.12, started_at: "2026-10-05T03:00:01Z", verification_rate: 0.857,
};

export const emptyReviewFixture: Review = {
  ...reviewFixture,
  result: {
    language: "th", summary: "ไม่พบงานวิจัยที่ตรงกับหัวข้อนี้เพียงพอสำหรับการสรุปเปรียบเทียบ",
    synthesis: { executive_summary: "ไม่พบงานวิจัยที่ตรงกับหัวข้อนี้เพียงพอสำหรับการสรุปเปรียบเทียบ", comparison: [],
      consensus: [], conflicts: [], evidence_strength: "very_low", evidence_rationale: "", research_gaps: [] },
    papers: [], stats: { found: 0, unique: 0, with_abstract: 0, candidates: 0, screened: 0, selected: 0, extracted: 0 },
  },
};

/** A result stored before abstract-only reading (full-text era): must still render. */
export const legacyReviewFixture: Review = {
  ...reviewFixture,
  result: {
    ...resultFixture,
    papers: resultFixture.papers!.map((p, i) => ({
      ...p, fulltext_source: ["europepmc", "abstract", "crawl_html", "crawl_pdf", "title_only"][i],
      fulltext_url: p.ref === "P3" ? "https://example.org/p3" : null,
    })),
    stats: { found: 41, unique: 26, candidates: 20, screened: 20, selected: 5, with_fulltext: 3, extracted: 4 },
  },
};
