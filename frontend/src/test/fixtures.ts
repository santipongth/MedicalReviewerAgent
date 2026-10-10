// Realistic result shaped exactly like the backend's finalize output (sample data for tests and e2e mocks).
import type { ComparisonCell as Cell, Paper, PaperCard, Review, ReviewMethods, ReviewResult } from "@/lib/types";

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

// --- Plan 20 P0: qualitative / mixed-methods themes, other comparisons, design mismatch -----------------------------
// A narrative review where P1 is qualitative and P2 mixed methods (themes: effect_measure "none", numbers null). Their
// stored directions are deliberately "positive" (as an older or misbehaving extractor might leave them): the UI must
// still show no direction for them anywhere. P3 is a cohort with one question outcome (HR, verified), one other
// comparison and a design outside the ticked types; P4 is a cohort whose outcome has no number and no "none" flag.

const themeQuote = "Participants described fear of injections and stigma as the main barriers to starting insulin.";
const themeCard = (design: "qualitative" | "mixed_methods", theme: string): PaperCard => card({
  study_design: design === "qualitative" ? "Qualitative interview study" : "Mixed-methods study", design_category: design,
  population: "adults with type 2 diabetes", intervention_or_exposure: "insulin initiation", comparator: null,
  outcomes: [{ outcome: theme, result: "Fear of injections and stigma were barriers.", evidence_quote: themeQuote,
    effect_size: null, effect_measure: "none", effect_value: null, ci_lower: null, ci_upper: null, p_value: null,
    direction: "positive" }],
  key_findings: ["Fear of injections", "Stigma"], risk_of_bias: "moderate", overall_direction: "positive",
});
const qualP3 = card({
  sample_size: 1234, sample_size_quote: "We enrolled 1,234 adults with type 2 diabetes in a population-based cohort.",
  outcomes: [
    { outcome: "CRC incidence", result: "Lower risk of colorectal cancer", evidence_quote: q3, effect_size: "HR 0.80 (0.71–0.90)",
      effect_measure: "HR", effect_value: 0.8, ci_lower: 0.71, ci_upper: 0.9, p_value: 0.003, direction: "positive",
      comparison: "metformin vs no metformin", matches_question: true },
    { outcome: "CRC incidence vs insulin", result: "Lower than insulin users", evidence_quote: q1, effect_size: "HR 0.86",
      effect_measure: "HR", effect_value: 0.86, ci_lower: 0.77, ci_upper: 0.96, p_value: null, direction: "positive",
      comparison: "GLP-1RA vs insulin", matches_question: false },
  ],
});
const qualP4 = card({
  outcomes: [{ outcome: "Adherence", result: "Adherence was higher with once-daily dosing.",
    evidence_quote: "Adherence was 82% with once-daily dosing versus 64% with twice-daily dosing.", effect_size: null,
    effect_measure: null, effect_value: null, ci_lower: null, ci_upper: null, p_value: null, direction: "positive" }],
});

export const qualitativeReviewFixture: Review = {
  ...reviewFixture,
  id: "77777777-8888-9999-aaaa-bbbbbbbbbbbb",
  result: {
    ...resultFixture,
    review_type: "narrative",
    summary: "ผู้ป่วยกลัวการฉีดยาและการตีตรา [P1, P2] งานเชิงปริมาณพบความเสี่ยงต่ำลง 20% [P3]",
    synthesis: {
      ...resultFixture.synthesis!,
      executive_summary: "ผู้ป่วยกลัวการฉีดยาและการตีตรา [P1, P2] งานเชิงปริมาณพบความเสี่ยงต่ำลง 20% [P3]",
      comparison: [
        { outcome: "ความกลัวการฉีดยา", cells: [
          { ref: "P1", finding: "กลัวเข็มและการตีตรา", direction: "positive", design_category: "qualitative" },
          { ref: "P2", finding: "กลัวเข็ม", direction: "positive", design_category: "mixed_methods" },
        ] },
        { outcome: "อุบัติการณ์มะเร็งลำไส้ใหญ่", cells: [
          { ref: "P3", finding: "ความเสี่ยงต่ำลง", direction: "positive", effect_measure: "HR", effect_value: 0.8, ci_lower: 0.71, ci_upper: 0.9 },
        ] },
      ],
      consensus: [{ statement: "ความกลัวการฉีดยาพบซ้ำ", refs: ["P1", "P2"], explanation: "สองการศึกษารายงานประเด็นเดียวกัน [P1, P2]" }],
      conflicts: [],
      evidence_strength: null, evidence_rationale: "",
    },
    synthesis_en: undefined,
    papers: [
      { ref: "P1", title: "Barriers to insulin initiation: a qualitative interview study", year: 2022, relevance: 90,
        card: themeCard("qualitative", "Fear of injections"), card_en: themeCard("qualitative", "Fear of injections"),
        verification: verification({ numbers_verified: 0, numbers_total: 0 }) },
      { ref: "P2", title: "Insulin initiation in primary care: a mixed-methods study", year: 2021, relevance: 85,
        card: themeCard("mixed_methods", "Fear of injections"), card_en: themeCard("mixed_methods", "Fear of injections"),
        verification: verification({ numbers_verified: 0, numbers_total: 0 }) },
      { ref: "P3", title: "Metformin use and colorectal cancer risk among adults with type 2 diabetes", year: 2021, relevance: 93,
        card: qualP3, card_en: qualP3, verification: verification({ design_mismatch: true }) },
      { ref: "P4", title: "Once-daily dosing and adherence in type 2 diabetes", year: 2019, relevance: 70,
        card: qualP4, card_en: qualP4, verification: verification({ numbers_verified: 0, numbers_total: 0 }) },
    ],
    citations: null,
  },
};

/** A meta-analysis whose pooling produced nothing (pools: []): "could not pool" everywhere, no computed banner. */
export const metaNoPoolReviewFixture: Review = {
  ...reviewFixture,
  id: "88888888-9999-aaaa-bbbb-cccccccccccc",
  result: {
    ...resultFixture,
    review_type: "meta_analysis",
    meta_analysis: {
      version: "meta-1", pools: [],
      excluded: [
        { outcome: "CRC incidence", outcome_display: "อุบัติการณ์มะเร็งลำไส้ใหญ่", ref: "P1", measure: "HR", design_category: "cohort", reason: "too_few_studies", k: 2, design_group: "observational" },
        { outcome: "CRC incidence", outcome_display: "อุบัติการณ์มะเร็งลำไส้ใหญ่", ref: "P3", measure: "HR", design_category: "cohort", reason: "too_few_studies", k: 2, design_group: "observational" },
      ],
      reference: [
        { outcome: "CRC incidence", outcome_display: "อุบัติการณ์มะเร็งลำไส้ใหญ่", ref: "P4", design_category: "sr_ma_observational", measure: "HR", effect: 1.28, ci_lower: 1.05, ci_upper: 1.56 },
      ],
      grade: null,
    },
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

// --- Plan 20: answer-first report (answer, key findings, methods) --------------------------------------------------
// Each type gets an `answer` and numberless `key_findings` (k = refs, as the backend sets it) plus `result.methods`.

const DEEPSEEK = "openrouter:deepseek/deepseek-v4-pro";

function methodsFixture(over: Partial<ReviewMethods> = {}): ReviewMethods {
  return {
    searched_at: "2026-10-05T03:00:30Z",
    sources: { pubmed: 30, "europe pmc": 12, "europe pmc (rct search)": 4, openalex: 9 },
    eligibility: { year_from: null, study_types: [], inclusion_criteria: ["Adults with type 2 diabetes"], exclusion_criteria: ["Editorials"] },
    limits: { candidate_limit: 60, max_papers: 30, min_abstract_chars: 150 },
    // second_model is null unless the vote is two_models (docs/api.md "Methods")
    screening: { model: DEEPSEEK, second_model: null, second_vote: "same_model", borderline: [35, 70], relevance_floor: 35 },
    extraction: { model: DEEPSEEK, second_model: DEEPSEEK, verify_quotes: true, quote_match_threshold: 90, text: "abstract" },
    synthesis: { model: DEEPSEEK, pooling: null, grading: "GRADE-lite" },
    ...over,
  };
}

const enRows = (rows: { outcome: string; cells: Cell[] }[], names: string[]) => rows.map((r, i) => ({ ...r, outcome: names[i] }));

/** SLR: incidence (P1–P4, a range of two verified HRs; P2 blanked; P4 an SR/MA) and mortality (P3, no number). */
export const slrP20ReviewFixture: Review = {
  ...slrReviewFixture,
  id: "20200000-0000-4000-8000-000000000001",
  result: {
    ...slrReviewFixture.result!,
    synthesis: {
      ...resultFixture.synthesis!,
      answer: "เมตฟอร์มินอาจลดอุบัติการณ์มะเร็งลำไส้ใหญ่ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2 แต่หลักฐานมีความเชื่อมั่นต่ำ",
      key_findings: [
        { outcome: "อุบัติการณ์มะเร็งลำไส้ใหญ่", statement: "งานเชิงสังเกตส่วนใหญ่พบอุบัติการณ์ต่ำลงในผู้ใช้เมตฟอร์มิน แต่มีงานหนึ่งพบทิศทางตรงข้าม", refs: ["P1", "P2", "P3", "P4"], k: 4 },
        { outcome: "การเสียชีวิตจากมะเร็งลำไส้ใหญ่", statement: "งานเดียวที่รายงานพบว่าอัตราตายไม่ต่างกัน", refs: ["P3"], k: 1 },
      ],
    },
    synthesis_en: {
      ...resultFixture.synthesis_en!,
      comparison: enRows(resultFixture.synthesis!.comparison!, ["CRC incidence", "CRC mortality"]),
      answer: "Metformin may reduce colorectal cancer incidence in adults with type 2 diabetes, but the certainty of the evidence is low.",
      key_findings: [
        { outcome: "CRC incidence", statement: "Most observational studies found lower incidence among metformin users; one found the opposite.", refs: ["P1", "P2", "P3", "P4"], k: 4 },
        { outcome: "CRC mortality", statement: "The one study that reported it found no difference in mortality.", refs: ["P3"], k: 1 },
      ],
    },
    // contract-complete Plan 19 stats: unique = year_excluded + non_research + no_abstract + with_abstract
    stats: { ...resultFixture.stats, found: 55, unique: 41, year_excluded: 2, non_research: 1, no_abstract: 3, with_abstract: 35,
      candidates: 20, screened: 20, selected: 5,
      excluded_screening: { off_topic: 8, population: 3, outcome: 2, publication_type: 1 },
      excluded_selection: { narrative_excluded: 0, over_limit: 0, low_relevance: 1, study_design_relaxed: 0, study_design_corrected: 0 } },
    methods: methodsFixture(),
  },
};

/** Meta-analysis: the primary outcome pooled (computed), the safety outcome a range of two verified HRs. */
export const metaP20ReviewFixture: Review = {
  ...metaReviewFixture,
  id: "20200000-0000-4000-8000-000000000002",
  result: {
    ...metaReviewFixture.result!,
    synthesis: {
      ...metaReviewFixture.result!.synthesis!,
      answer: "งานวิจัยเชิงสังเกตอาจไม่พบผลต่อผลลัพธ์หลักเมื่อรวมผลกัน ความเชื่อมั่นของหลักฐานต่ำมาก",
      key_findings: [
        { outcome: "ผลลัพธ์หลัก", statement: "ค่ารวมของงานเชิงสังเกตไม่ชัดว่ามีผล และงานให้ผลต่างกันมาก", refs: ["P1", "P2", "P3", "P4", "P7"], k: 5 },
        { outcome: "ผลด้านความปลอดภัย", statement: "งานที่รายงานไม่พบสัญญาณด้านความปลอดภัย", refs: ["P1", "P3", "P5"], k: 3 },
      ],
    },
    synthesis_en: {
      ...metaReviewFixture.result!.synthesis_en!,
      answer: "Pooled observational studies may show no effect on the primary outcome; the evidence is very uncertain.",
      key_findings: [
        { outcome: "Primary outcome", statement: "The observational pooled estimate is unclear and the studies differ a lot.", refs: ["P1", "P2", "P3", "P4", "P7"], k: 5 },
        { outcome: "Safety outcome", statement: "The studies that reported it found no safety signal.", refs: ["P1", "P3", "P5"], k: 3 },
      ],
    },
    methods: methodsFixture({
      sources: { pubmed: 41, "europe pmc": 30, "semantic scholar": 22, arxiv: 3 },
      screening: { model: DEEPSEEK, second_model: "openrouter:qwen/qwen3-max", second_vote: "two_models", borderline: [35, 70], relevance_floor: 35 },
      extraction: { model: DEEPSEEK, second_model: "openrouter:qwen/qwen3-max", verify_quotes: true, quote_match_threshold: 90, text: "abstract" },
      synthesis: { model: DEEPSEEK, pooling: "DerSimonian-Laird random effects", grading: "GRADE-lite" },
    }),
  },
};

/** Meta-analysis that pooled nothing: the answer leads with "could not pool". */
export const metaNoPoolP20ReviewFixture: Review = {
  ...metaNoPoolReviewFixture,
  id: "20200000-0000-4000-8000-000000000003",
  result: {
    ...metaNoPoolReviewFixture.result!,
    synthesis: {
      ...metaNoPoolReviewFixture.result!.synthesis!,
      answer: "รวมผลไม่ได้: ไม่มีผลลัพธ์ใดมีงานวิจัยหลักพอที่จะรวมผล งานแต่ละชิ้นส่วนใหญ่ชี้ว่าความเสี่ยงอาจต่ำลง ความเชื่อมั่นต่ำ",
      key_findings: [
        { outcome: "อุบัติการณ์มะเร็งลำไส้ใหญ่", statement: "งานหลักสองงานพบความเสี่ยงต่ำลง ส่วนงานทบทวนหนึ่งงานพบทิศทางตรงข้าม", refs: ["P1", "P3", "P4"], k: 3 },
      ],
    },
    methods: methodsFixture({ synthesis: { model: DEEPSEEK, pooling: "DerSimonian-Laird random effects", grading: "GRADE-lite" } }),
  },
};

/** Scoping: a mapping answer, no grade, sources not recorded (falls back to the queries). */
export const scopingP20ReviewFixture: Review = {
  ...scopingReviewFixture,
  id: "20200000-0000-4000-8000-000000000004",
  result: {
    ...scopingReviewFixture.result!,
    synthesis: {
      ...scopingReviewFixture.result!.synthesis!,
      answer: "งานวิจัยเรื่องเมตฟอร์มินกับมะเร็งลำไส้ใหญ่ส่วนใหญ่เป็นงานเชิงสังเกตในผู้ใหญ่ที่เป็นเบาหวาน",
      key_findings: [
        { outcome: "อุบัติการณ์มะเร็งลำไส้ใหญ่", statement: "งานส่วนใหญ่ศึกษาอุบัติการณ์ด้วยรูปแบบ cohort", refs: ["P1", "P2", "P3", "P4"], k: 4 },
      ],
    },
    methods: methodsFixture({ sources: null, screening: { model: DEEPSEEK, second_model: null, second_vote: "off", borderline: [35, 70], relevance_floor: 35 },
      extraction: { model: DEEPSEEK, second_model: null, verify_quotes: true, quote_match_threshold: 90, text: "abstract" },
      synthesis: { model: DEEPSEEK, pooling: null, grading: null } }),
  },
};

/** Narrative with qualitative themes: a theme finding ("found in 2 studies") and a one-study finding with its HR. */
export const narrativeP20ReviewFixture: Review = {
  ...qualitativeReviewFixture,
  id: "20200000-0000-4000-8000-000000000005",
  result: {
    ...qualitativeReviewFixture.result!,
    synthesis: {
      ...qualitativeReviewFixture.result!.synthesis!,
      answer: "ผู้ป่วยกลัวการฉีดยาและการตีตรา ซึ่งเป็นอุปสรรคต่อการเริ่มอินซูลิน",
      key_findings: [
        { outcome: "ความกลัวการฉีดยา", statement: "งานเชิงคุณภาพและแบบผสมผสานพบความกลัวเข็มและการตีตราซ้ำกัน", refs: ["P1", "P2"], k: 2 },
        { outcome: "อุบัติการณ์มะเร็งลำไส้ใหญ่", statement: "งานเชิงปริมาณงานเดียวพบความเสี่ยงต่ำลง", refs: ["P3"], k: 1 },
      ],
    },
    // The English rows name the outcomes as the cards do, so P3's verified HR matches "CRC incidence" exactly.
    synthesis_en: {
      ...qualitativeReviewFixture.result!.synthesis!,
      executive_summary: "Patients fear injections and stigma [P1, P2]; one quantitative study found a lower risk [P3].",
      comparison: enRows(qualitativeReviewFixture.result!.synthesis!.comparison!, ["Fear of injections", "CRC incidence"]),
      consensus: [], conflicts: [],
      answer: "Patients fear injections and stigma, which hold back starting insulin.",
      key_findings: [
        { outcome: "Fear of injections", statement: "Qualitative and mixed-methods studies both found fear of needles and stigma.", refs: ["P1", "P2"], k: 2 },
        { outcome: "CRC incidence", statement: "One quantitative study found a lower risk.", refs: ["P3"], k: 1 },
      ],
    },
    methods: methodsFixture({ synthesis: { model: DEEPSEEK, pooling: null, grading: null } }),
  },
};

// --- Plan 20 Task 5: a diagnostic-accuracy SLR (sensitivity / specificity / AUC as each paper reported them) -------------

function dtaPaper(ref: string, year: number, author: string, n: number | null, sens: [number, number, number] | null,
  spec: [number, number, number] | null, auc: [number, number, number] | null, percent: boolean, extra: Partial<Paper> = {}): Paper {
  const f = (v: number) => (percent ? v.toFixed(1) : v.toFixed(2));
  const u = percent ? "%" : "";
  const parts = [
    sens && `sensitivity was ${f(sens[0])}${u} (95% CI ${f(sens[1])}-${f(sens[2])})`,
    spec && `specificity was ${f(spec[0])}${u} (95% CI ${f(spec[1])}-${f(spec[2])})`,
    auc && `the AUC was ${auc[0].toFixed(2)} (95% CI ${auc[1].toFixed(2)}-${auc[2].toFixed(2)})`,
  ].filter(Boolean);
  const quote = `For AI-assisted reading, ${parts.join(", ")}.`;
  const o = (outcome: string, v: [number, number, number] | null): PaperCard["outcomes"] => v ? [{
    outcome, result: `${outcome} of AI-assisted reading`, evidence_quote: quote, effect_size: null, effect_measure: "other",
    effect_value: v[0], ci_lower: v[1], ci_upper: v[2], p_value: null, direction: "positive",
  }] : [];
  const c = card({
    study_design: "diagnostic accuracy study", design_category: "cross_sectional", population: "adults with suspected hip fracture",
    sample_size: n, sample_size_quote: n ? `We included ${n.toLocaleString("en-US")} radiographs.` : null,
    intervention_or_exposure: "AI-assisted radiograph reading", comparator: "radiologists alone",
    outcomes: [...o("Sensitivity", sens), ...o("Specificity", spec), ...o("AUC", auc)], risk_of_bias: "moderate",
  });
  return { ref, title: `AI-assisted detection of hip fractures: study ${ref.slice(1)}`, authors: [author], year, relevance: 90,
    card: c, card_en: c, verification: verification(), ...extra };
}

const dtaPapers: Paper[] = [
  dtaPaper("P1", 2023, "Chen L", 512, [97.4, 94.0, 98.9], [86.5, 82.1, 90.1], [0.93, 0.9, 0.96], true),
  dtaPaper("P2", 2022, "Okafor N", 1204, [0.79, 0.71, 0.88], [0.87, 0.82, 0.91], null, false),
  dtaPaper("P3", 2024, "Sato K", 388, [0.91, 0.86, 0.95], [0.78, 0.72, 0.83], [0.89, 0.85, 0.93], false,
    { verification: verification({ numbers_verified: 2, numbers_total: 3, unverified: [{ field: "effect", outcome: "Specificity" }] }) }),
  dtaPaper("P4", 2021, "Müller F", 2310, [88.0, 84.2, 91.1], [92.3, 90.0, 94.2], null, true),
];
const dtaRow = (outcome: string, refs: string[]): { outcome: string; cells: Cell[] } => ({
  outcome, cells: refs.map((ref) => ({ ref, finding: `${outcome} of AI-assisted reading`, direction: "positive" as const })),
});

/** SLR of a diagnostic-accuracy question: sensitivity and specificity panels plus the DTA table (P3's specificity blanked). */
export const dtaReviewFixture: Review = {
  ...slrP20ReviewFixture,
  id: "20200000-0000-4000-8000-000000000006",
  topic: "AI กับการวินิจฉัยกระดูกสะโพกหัก",
  result: {
    ...slrP20ReviewFixture.result!,
    topic: "AI กับการวินิจฉัยกระดูกสะโพกหัก",
    question: { ...resultFixture.question!, refined_question: "AI ช่วยเพิ่มความแม่นยำในการวินิจฉัยกระดูกสะโพกหักจากภาพรังสีหรือไม่",
      pico: { population: "adults with suspected hip fracture", intervention_or_exposure: "AI-assisted reading", comparator: "radiologists alone",
        outcomes: ["sensitivity", "specificity"], study_designs: ["diagnostic accuracy"], timeframe: null } },
    synthesis: {
      ...slrP20ReviewFixture.result!.synthesis!,
      answer: "AI ช่วยให้ความไวในการวินิจฉัยกระดูกสะโพกหักสูง ความเชื่อมั่นปานกลาง",
      comparison: [dtaRow("ความไว", ["P1", "P2", "P3", "P4"]), dtaRow("ความจำเพาะ", ["P1", "P2", "P3", "P4"])],
      key_findings: [{ outcome: "ความไว", statement: "งานทั้งสี่รายงานความไวสูงเมื่อใช้ AI ช่วยอ่าน", refs: ["P1", "P2", "P3", "P4"], k: 4 }],
      consensus: [], conflicts: [],
    },
    synthesis_en: {
      ...slrP20ReviewFixture.result!.synthesis_en!,
      comparison: [dtaRow("Sensitivity", ["P1", "P2", "P3", "P4"]), dtaRow("Specificity", ["P1", "P2", "P3", "P4"])],
      key_findings: [{ outcome: "Sensitivity", statement: "All four studies reported high sensitivity with AI assistance.", refs: ["P1", "P2", "P3", "P4"], k: 4 }],
    },
    papers: dtaPapers,
    citations: null,
  },
};

// --- Plan 20 Task 11: the merged engine fields (docs/api.md) ------------------------------------------------------------
// P6 is a further report of P1's cohort (shared registry number): listed, never a comparison cell, consensus, conflict or
// key-finding ref, and not a second study anywhere. Per-finding certainty (code-set, the review's grade), a key finding
// led by the engine's fixed certainty clause, a review-discordant conflict next to an ordinary one, and a trimmed
// rationale.

const p6card = card({
  study_design: "cohort (10-year follow-up of a national diabetes cohort)", sample_size: 12004,
  sample_size_quote: "Of these, 12,004 adults were followed for ten years.", risk_of_bias: "moderate",
  outcomes: [{ outcome: "CRC incidence", result: "Lower incidence at ten years", evidence_quote: "Incidence remained lower among metformin users at ten years.",
    effect_size: null, effect_measure: "none", effect_value: null, ci_lower: null, ci_upper: null, p_value: null, direction: "positive" }],
});

const relatedReport: Paper = {
  ref: "P6", title: "Metformin and colorectal cancer: ten-year follow-up of a national diabetes cohort", year: 2023,
  journal: "Diabetes Care", doi: "10.1000/p6", relevance: 84, card: { ...p6card, population: "ผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2" },
  card_en: p6card, verification: verification({ numbers_verified: 1, numbers_total: 1 }),
  related_to: "P1", related_reason: "same trial (NCT01234567)", related_reports: [],
};

const DISCORDANT_TH = "อุบัติการณ์มะเร็งลำไส้ใหญ่: ผลของการทบทวนวรรณกรรมอย่างเป็นระบบและการศึกษาปฐมภูมิไม่สอดคล้องกัน";
const DISCORDANT_EN = "CRC incidence: systematic reviews and primary studies disagree";

/** SLR (Thai) with every Plan 20 Task 10 engine field the report shows. */
export const engineP20ReviewFixture: Review = {
  ...slrP20ReviewFixture,
  id: "20200000-0000-4000-8000-000000000011",
  result: {
    ...slrP20ReviewFixture.result!,
    papers: [
      ...slrP20ReviewFixture.result!.papers!.map((p) => ({
        ...p, related_to: null, related_reason: null, related_reports: p.ref === "P1" ? ["P6"] : [],
      })),
      relatedReport,
    ],
    synthesis: {
      ...slrP20ReviewFixture.result!.synthesis!,
      key_findings: [
        { outcome: "อุบัติการณ์มะเร็งลำไส้ใหญ่", statement: "หลักฐานที่มีความเชื่อมั่นต่ำชี้ว่า: เมตฟอร์มินลดอุบัติการณ์มะเร็งลำไส้ใหญ่ในงานเชิงสังเกตส่วนใหญ่",
          refs: ["P1", "P2", "P3", "P4"], k: 4, certainty: "low" },
        { outcome: "การเสียชีวิตจากมะเร็งลำไส้ใหญ่", statement: "งานเดียวที่รายงานพบว่าอัตราตายไม่ต่างกัน", refs: ["P3"], k: 1, certainty: "low" },
      ],
      conflicts: [
        { ...resultFixture.synthesis!.conflicts![0], review_discordant: false },
        { statement: DISCORDANT_TH, refs: ["P1", "P3", "P4"], review_discordant: true,
          explanation: "การทบทวนวรรณกรรมอย่างเป็นระบบ [P4] รายงานผลไปในทิศทางที่ต่างจากการศึกษาปฐมภูมิ [P1, P3]",
          likely_reasons: ["การทบทวนอาจรวมงานที่การค้นครั้งนี้ไม่พบ"] },
      ],
    },
    synthesis_en: {
      ...slrP20ReviewFixture.result!.synthesis_en!,
      key_findings: [
        { outcome: "CRC incidence", statement: "Low-certainty evidence suggests: Metformin lowers colorectal cancer incidence in most observational studies.",
          refs: ["P1", "P2", "P3", "P4"], k: 4, certainty: "low" },
        { outcome: "CRC mortality", statement: "The one study that reported it found no difference in mortality.", refs: ["P3"], k: 1, certainty: "low" },
      ],
      conflicts: [
        { statement: "CRC incidence: studies disagree", refs: ["P1", "P3", "P4"], review_discordant: false,
          explanation: "[P4] had shorter follow-up and may reflect detection bias.", likely_reasons: ["Short follow-up"] },
        { statement: DISCORDANT_EN, refs: ["P1", "P3", "P4"], review_discordant: true,
          explanation: "Systematic reviews [P4] report a different direction from the primary studies [P1, P3].",
          likely_reasons: ["The review may include studies this search did not find"] },
      ],
    },
    stats: { ...slrP20ReviewFixture.result!.stats!, selected: 6, extracted: 5, related_reports: 1 },
    quality: { ...slrP20ReviewFixture.result!.quality, prose_check: { rationale_fixed: "trimmed" } },
  },
};

/** The engine's empty answer (api.md: e.g. an ungraded review whose every answer sentence carried a number). */
export const emptyAnswerP20ReviewFixture: Review = {
  ...engineP20ReviewFixture,
  id: "20200000-0000-4000-8000-000000000012",
  result: {
    ...engineP20ReviewFixture.result!,
    synthesis: { ...engineP20ReviewFixture.result!.synthesis!, answer: "" },
    synthesis_en: { ...engineP20ReviewFixture.result!.synthesis_en!, answer: "" },
  },
};

/** Every Plan 20 fixture, for e2e mocks and per-type screenshots. */
export const P20_FIXTURES: Record<"slr" | "meta" | "metaNoPool" | "scoping" | "narrative" | "legacy", Review> = {
  slr: slrP20ReviewFixture, meta: metaP20ReviewFixture, metaNoPool: metaNoPoolP20ReviewFixture, scoping: scopingP20ReviewFixture,
  narrative: narrativeP20ReviewFixture, legacy: legacyReviewFixture,
};

// --- Plan 20 Task 7 fix round 1: long Thai runs joined by slashes and dashes (no space anywhere) ---------------------

const SLASHED = "การใช้ยาเมตฟอร์มินร่วมกับการปรับพฤติกรรม/ยาซัลโฟนิลยูเรีย/ยาหลอก–การรักษามาตรฐานในผู้ป่วยเบาหวานชนิดที่สอง";

/** An SLR whose question, summary-of-findings outcome and literature-matrix cells are long slash/dash-joined Thai. */
export const slashedThaiReviewFixture: Review = {
  ...slrP20ReviewFixture,
  id: "20200000-0000-4000-8000-000000000071",
  result: {
    ...slrP20ReviewFixture.result!,
    question: { ...slrP20ReviewFixture.result!.question!, refined_question: `${SLASHED}ลดอุบัติการณ์มะเร็งลำไส้ใหญ่หรือไม่` },
    synthesis: {
      ...slrP20ReviewFixture.result!.synthesis!,
      key_findings: slrP20ReviewFixture.result!.synthesis!.key_findings!.map((k, i) => (i === 0 ? { ...k, outcome: `อุบัติการณ์/${SLASHED}` } : k)),
    },
    papers: slrP20ReviewFixture.result!.papers!.map((p) => (p.card ? { ...p, card: { ...p.card, population: SLASHED, intervention_or_exposure: SLASHED } } : p)),
  },
};

// --- Plan 20 Task 7: the same reviews written in English (result.language "en") ------------------------------------------

const THAI = /[฀-๿]/;

/**
 * The review as an English report: the English synthesis, cards and question (as the engine writes an English review),
 * and every Thai data string that remains swapped for an English stand-in, the same Thai text always for the same
 * stand-in (outcome names keep matching across the matrix, key findings and pools). The chrome must then be all English.
 */
export function englishReview(review: Review): Review {
  const names = new Map<string, string>();
  const swap = (s: string) => {
    if (!THAI.test(s)) return s;
    if (!names.has(s)) names.set(s, `Outcome text ${names.size + 1}`);
    return names.get(s)!;
  };
  const deep = <T,>(v: T): T => (typeof v === "string" ? swap(v) : Array.isArray(v) ? v.map(deep)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v) as T;
  const r = review.result!;
  const en = r.synthesis_en;
  const synthesis = en ? { ...r.synthesis!, ...en, comparison: en.comparison?.length ? en.comparison : r.synthesis?.comparison ?? [] } : r.synthesis;
  const q = r.question;
  return deep({
    ...review,
    id: `e${review.id.slice(1)}`,
    topic: r.english_topic ?? "metformin and colorectal cancer",
    language: "en",
    result: {
      ...r, language: "en", topic: r.english_topic ?? r.topic, synthesis, synthesis_en: undefined,
      summary: en?.executive_summary ?? r.summary,
      question: q && { ...q, ...(q.english ?? {}), original_topic: q.english_topic ?? q.original_topic, english: undefined },
      papers: r.papers?.map((p) => ({ ...p, card: p.card_en ?? p.card })),
    },
  });
}

/** The P20 fixtures as English reports (Task 7: chrome language, `lang` attributes). */
export const P20_FIXTURES_EN = Object.fromEntries(
  Object.entries(P20_FIXTURES).map(([k, v]) => [k, englishReview(v)]),
) as Record<keyof typeof P20_FIXTURES, Review>;
