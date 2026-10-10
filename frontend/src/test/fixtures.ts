// Realistic result shaped exactly like the backend's finalize output (sample data for tests and e2e mocks).
import type { ComparisonCell as Cell, Paper, PaperCard, Review, ReviewResult } from "@/lib/types";

const q3 = "Metformin use was associated with a lower risk of colorectal cancer (HR 0.80, 95% CI 0.71–0.90; p = 0.003).";
const q1 = "Users of metformin had a lower incidence of colorectal cancer than users of sulfonylureas (HR 0.86, 95% CI 0.77–0.96).";
const q4 = "Within two years of initiation, metformin users had higher colorectal cancer detection (HR 1.28, 95% CI 1.05–1.56).";

function card(over: Partial<PaperCard>): PaperCard {
  return {
    study_design: "cohort", design_category: "cohort", population: "adults with type 2 diabetes", sample_size: null, sample_size_quote: null,
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
  study_design: "nested case-control", design_category: "case_control", sample_size: null, risk_of_bias: "high", overall_direction: "positive",
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
  study_design: "meta-analysis of cohort studies", design_category: "sr_ma_observational",
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
      authors: ["Lindqvist J", "Other A"],
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

function stripAppraisal(c: PaperCard): PaperCard {
  return {
    ...c, risk_of_bias: "unclear", overall_direction: "unclear",
    outcomes: c.outcomes.map((o) => ({ ...o, effect_size: null, effect_measure: "none", effect_value: null, ci_lower: null,
      ci_upper: null, p_value: null, direction: "unclear" })),
  };
}

/** A Plan 14a scoping result: PCC question, no grade, no consensus/conflicts, PRISMA exclusion reasons. */
export const scopingReviewFixture: Review = {
  ...reviewFixture,
  result: {
    ...resultFixture,
    review_type: "scoping",
    question: {
      ...resultFixture.question,
      framework: "PCC", concept: "การใช้เมตฟอร์มิน", context: "การดูแลผู้ป่วยนอก",
      key_terms: [{ term: "metformin", synonyms: ["biguanide"], mesh: "Metformin" }],
    },
    synthesis: { ...resultFixture.synthesis!, consensus: [], conflicts: [], evidence_strength: null, evidence_rationale: "" },
    synthesis_en: undefined,
    // A scoping card carries no effect, direction or quality judgement; two of the papers are shaped that way.
    papers: resultFixture.papers!.map((p) => (p.ref === "P1" || p.ref === "P3") ? {
      ...p,
      card: p.card && stripAppraisal(p.card), card_en: p.card_en && stripAppraisal(p.card_en),
    } : p),
    stats: {
      ...resultFixture.stats, non_research: 3,
      excluded_screening: { off_topic: 7, study_design: 2, other: 1 },
      excluded_selection: { narrative_excluded: 0, over_limit: 4 },
    },
  },
};

export const narrativeReviewFixture: Review = {
  ...reviewFixture,
  result: {
    ...resultFixture,
    review_type: "narrative",
    synthesis: { ...resultFixture.synthesis!, evidence_strength: null, evidence_rationale: "" },
    synthesis_en: undefined,
  },
};

/**
 * result.citations as build_citations (backend app/harness/citations.py) shapes it: later papers cite earlier ones, P3
 * has only a Europe PMC reference list, and P5 has no data at all (null coverage: not "cites nothing").
 */
export const citationsFixture: NonNullable<ReviewResult["citations"]> = {
  edges: [{ from: "P1", to: "P2" }, { from: "P3", to: "P1" }, { from: "P3", to: "P2" }, { from: "P4", to: "P1" }],
  cited_by: { P1: 312, P2: 1187, P3: 46, P4: 89, P5: null },
  cited_by_source: { P1: "openalex", P2: "openalex", P3: "europepmc", P4: "openalex", P5: null },
  coverage: { P1: "openalex", P2: "openalex", P3: "europepmc", P4: "openalex", P5: null },
  source_note: "Reference lists and citation counts from OpenAlex; Europe PMC reference lists for papers OpenAlex lacked",
};

/** An explicit Plan 14a systematic review (the plain reviewFixture has no review_type, so it renders as legacy). */
export const slrReviewFixture: Review = {
  ...reviewFixture,
  result: { ...resultFixture, review_type: "slr", citations: citationsFixture },
};

// --- Plan 14b meta-analysis -----------------------------------------------------------------------------------------
// The backend stub (app/graph/nodes/stub_result.py, review_type meta_analysis): seven papers, the observational HR pool
// of P3, P4, P7 computed by meta.py (pasted verbatim), P1/P2 left out as too few RCTs, the SR/MA P5 as a reference row.
// Two edits for the UI: outcome_display is in Thai (the real localize step does this), and P5 carries a verified HR
// for the safety outcome so the reference row shows numbers (the stub's P5 has none).

const metaQuote = (hr: string, lo: string, hi: string) => `HR ${hr} (95% CI ${lo}-${hi})`;

function metaPaper(ref: string, year: number, design: string, category: PaperCard["design_category"], n: number | null,
  rob: PaperCard["risk_of_bias"], direction: PaperCard["overall_direction"], hr: [string, string, string] | null,
  outcome = "Primary outcome"): Paper {
  const c: PaperCard = {
    study_design: design, design_category: category, population: "Adults studied in the context of metformin and colorectal cancer",
    sample_size: n, sample_size_quote: n ? `A total of ${n} participants were enrolled.` : null,
    intervention_or_exposure: "Index intervention", comparator: null,
    outcomes: [{
      outcome, result: `Reported ${direction} association for metformin and colorectal cancer.`,
      evidence_quote: hr ? metaQuote(...hr) : null, effect_size: null, effect_measure: hr ? "HR" : null,
      effect_value: hr ? Number(hr[0]) : null, ci_lower: hr ? Number(hr[1]) : null, ci_upper: hr ? Number(hr[2]) : null,
      p_value: null, direction,
    }],
    key_findings: [`Simulated finding for metformin and colorectal cancer.`], limitations: ["Illustrative stub data; abstract-only reading."],
    funding_or_conflicts: null, risk_of_bias: rob, overall_direction: direction,
  };
  const numbers = hr ? 4 : 0;
  return {
    ref, title: `Simulated study ${ref.slice(1)}: metformin and colorectal cancer`, authors: ["Stub A", "Stub B"], year,
    journal: "Journal of Simulated Evidence", doi: null, pmid: null, pmcid: null, url: null, relevance: 0.85,
    screen_reason: "Relevant to the question", card: c, card_en: c,
    verification: { numbers_verified: numbers, numbers_total: numbers, agreement: null, escalated: false, repaired: false, uncertain: false, unverified: [] },
    error: null,
  };
}

const metaPapers: Paper[] = [
  metaPaper("P1", 2021, "Randomized controlled trial", "rct", 412, "low", "positive", ["0.78", "0.63", "0.96"]),
  metaPaper("P2", 2019, "Randomized controlled trial", "rct", 230, "moderate", "null", ["0.97", "0.74", "1.27"]),
  metaPaper("P3", 2020, "Prospective cohort study", "cohort", 5120, "moderate", "positive", ["0.84", "0.72", "0.98"]),
  metaPaper("P4", 2018, "Retrospective cohort study", "cohort", 1893, "high", "negative", ["1.22", "1.01", "1.47"]),
  metaPaper("P5", 2022, "Systematic review and meta-analysis of RCTs", "sr_ma_rct", null, "low", "mixed", ["0.81", "0.70", "0.94"], "Safety outcome"),
  metaPaper("P6", 2017, "Narrative review", "narrative_review", null, "unclear", "unclear", null),
  metaPaper("P7", 2016, "Population-based cohort study", "cohort", 3410, "moderate", "positive", ["0.88", "0.79", "0.99"]),
];

const metaCell = (ref: string, outcome: string, direction: Cell["direction"], hr: [number, number, number] | null, design: string, pooled = false): Cell => ({
  ref, finding: `${outcome}: ${direction} in simulated study ${ref.slice(1)}.`, direction, effect_measure: hr ? "HR" : null,
  effect_value: hr?.[0] ?? null, ci_lower: hr?.[1] ?? null, ci_upper: hr?.[2] ?? null, design_category: design, pooled,
});
const metaComparison = (primary: string, safety: string) => [
  { outcome: primary, cells: [
    metaCell("P1", primary, "positive", [0.78, 0.63, 0.96], "rct"), metaCell("P2", primary, "null", [0.97, 0.74, 1.27], "rct"),
    metaCell("P3", primary, "positive", [0.84, 0.72, 0.98], "cohort"), metaCell("P4", primary, "negative", [1.22, 1.01, 1.47], "cohort"),
    metaCell("P7", primary, "positive", [0.88, 0.79, 0.99], "cohort"),
  ] },
  { outcome: safety, cells: [
    metaCell("P1", safety, "positive", [0.78, 0.63, 0.96], "rct"), metaCell("P3", safety, "positive", [0.84, 0.72, 0.98], "cohort"),
    metaCell("P5", safety, "mixed", [0.81, 0.7, 0.94], "sr_ma_rct", true),
  ] },
];

/** result.meta_analysis exactly as the stub computes it (meta.py), outcome_display localized. */
export const metaAnalysisFixture: NonNullable<ReviewResult["meta_analysis"]> = {
  version: "meta-1",
  pools: [{
    outcome: "Primary outcome", outcome_display: "ผลลัพธ์หลัก", measure: "HR", scale: "log", design_group: "observational", k: 3,
    studies: [
      { ref: "P3", effect: 0.84, ci_lower: 0.72, ci_upper: 0.98, y: -0.1743533871447778, se: 0.07864975062157178, variance: 0.006185783272835432, weight: 33.17465652084898 },
      { ref: "P4", effect: 1.22, ci_lower: 1.01, ci_upper: 1.47, y: 0.19885085874516517, se: 0.0957446335589523, variance: 0.009167034855338055, weight: 30.264230947749734 },
      { ref: "P7", effect: 0.88, ci_lower: 0.79, ci_upper: 0.99, y: -0.12783337150988489, se: 0.05757044457642293, variance: 0.003314356088726984, weight: 36.5611125314013 },
    ],
    pooled: {
      est: 0.9565733980317777, ci_lower: 0.7841448529486756, ci_upper: 1.1669179009225137,
      y: -0.044397756995939, y_ci_lower: -0.24316151428389007, y_ci_upper: 0.15436600029201206, se: 0.10141194291729393,
    },
    tau2: 0.024814936085923115, i2: 81.15150309882412, q: 10.610925690712394, df: 2, p_het: 0.0049643999471426,
    method: "DerSimonian-Laird random effects", version: "meta-1",
    warnings: ["abstract_only", "ci_assumed_95", "adjustment_unknown", "small_k", "high_heterogeneity"],
  }],
  excluded: [
    { outcome: "Primary outcome", outcome_display: "ผลลัพธ์หลัก", ref: "P1", measure: "HR", design_category: "rct", reason: "too_few_studies", k: 2, design_group: "rct" },
    { outcome: "Primary outcome", outcome_display: "ผลลัพธ์หลัก", ref: "P2", measure: "HR", design_category: "rct", reason: "too_few_studies", k: 2, design_group: "rct" },
    { outcome: "Safety outcome", outcome_display: "ผลด้านความปลอดภัย", ref: "P1", measure: "HR", design_category: "rct", reason: "too_few_studies", k: 1, design_group: "rct" },
    { outcome: "Safety outcome", outcome_display: "ผลด้านความปลอดภัย", ref: "P3", measure: "HR", design_category: "cohort", reason: "too_few_studies", k: 1, design_group: "observational" },
  ],
  reference: [
    { outcome: "Safety outcome", outcome_display: "ผลด้านความปลอดภัย", ref: "P5", design_category: "sr_ma_rct", measure: "HR", effect: 0.81, ci_lower: 0.7, ci_upper: 0.94 },
  ],
  grade: {
    primary_outcome: "Primary outcome", design_group: "observational",
    reasons: [
      "inconsistency: substantial heterogeneity (I2 >= 50%) in the pooled analysis of Primary outcome (observational studies)",
      "imprecision: the pooled 95% CI for Primary outcome (observational studies) includes no effect",
    ],
  },
};

export const metaReviewFixture: Review = {
  ...reviewFixture,
  id: "66666666-7777-8888-9999-000000000000",
  result: {
    ...resultFixture,
    review_type: "meta_analysis",
    summary: "งานวิจัยเชิงสังเกตส่วนใหญ่พบความเสี่ยงต่ำลง [P3, P7] แต่หนึ่งงานพบทิศทางตรงข้าม [P4] ดูค่ารวมในส่วนการวิเคราะห์อภิมาน",
    synthesis: {
      ...resultFixture.synthesis!,
      executive_summary: "งานวิจัยเชิงสังเกตส่วนใหญ่พบความเสี่ยงต่ำลง [P3, P7] แต่หนึ่งงานพบทิศทางตรงข้าม [P4] ดูค่ารวมในส่วนการวิเคราะห์อภิมาน",
      comparison: metaComparison("ผลลัพธ์หลัก", "ผลด้านความปลอดภัย"),
      consensus: [{ statement: "งานวิจัยส่วนใหญ่ชี้ทางเดียวกัน", refs: ["P1", "P3"], explanation: "ตัวอย่าง" }],
      conflicts: [{ statement: "หนึ่งงานเห็นต่าง", refs: ["P4"], explanation: "ตัวอย่าง", likely_reasons: ["กลุ่มประชากรต่างกัน"] }],
      evidence_strength: "very_low", grade_baseline: "very_low",
    },
    synthesis_en: {
      ...resultFixture.synthesis_en!,
      comparison: metaComparison("Primary outcome", "Safety outcome"), evidence_strength: "very_low", grade_baseline: "very_low",
    },
    papers: metaPapers,
    stats: { found: 87, unique: 70, with_abstract: 64, candidates: 60, screened: 60, selected: 7, extracted: 7,
      excluded_screening: { off_topic: 20, population: 5, publication_type: 3 }, non_research: 4,
      excluded_selection: { narrative_excluded: 0, over_limit: 2 } },
    quality: { ...resultFixture.quality, pooled_numbers: { removed: 1, kept_single_study: 0 } },
    errors: [],
    meta_analysis: metaAnalysisFixture,
    // The SR/MA (P5) and the narrative review (P6) cite the primary studies; P6 has no reference data.
    citations: {
      edges: [
        { from: "P5", to: "P1" }, { from: "P5", to: "P2" }, { from: "P1", to: "P7" }, { from: "P3", to: "P4" },
        { from: "P3", to: "P7" },
      ],
      cited_by: { P1: 140, P2: 64, P3: 221, P4: 97, P5: 38, P6: null, P7: 410 },
      cited_by_source: { P1: "openalex", P2: "openalex", P3: "openalex", P4: "europepmc", P5: "openalex", P6: null, P7: "openalex" },
      coverage: { P1: "openalex", P2: "openalex", P3: "openalex", P4: "europepmc", P5: "openalex", P6: null, P7: "openalex" },
      source_note: "Reference lists and citation counts from OpenAlex; Europe PMC reference lists for papers OpenAlex lacked",
    },
  },
};
