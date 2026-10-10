// Mirror of the backend result built by app/graph/nodes/synthesis.py::make_finalize. Every field is optional on read
// because older results (and the stub graph) carry fewer fields; components must render whatever is present.

export type Direction = "positive" | "negative" | "null" | "mixed" | "unclear";
export type RiskOfBias = "low" | "moderate" | "high" | "unclear";
export type ReviewStatus = "queued" | "running" | "done" | "error" | "rejected" | "cancelled";

export interface OutcomeResult {
  outcome: string;
  result: string;
  evidence_quote?: string | null;
  effect_size?: string | null;
  effect_measure?: string | null;
  effect_value?: number | null;
  ci_lower?: number | null;
  ci_upper?: number | null;
  p_value?: number | null;
  direction: Direction;
  /** Plan 19: the two groups this estimate compares, e.g. "metformin vs sulfonylureas" (absent on older results). */
  comparison?: string | null;
  /** Plan 19: false = an "other comparison", not the question's intervention vs comparator; absent counts as true. */
  matches_question?: boolean;
}

export type DesignCategory =
  | "rct" | "non_randomized_trial" | "cohort" | "case_control" | "cross_sectional" | "case_series"
  | "mendelian_randomization" | "sr_ma_rct" | "sr_ma_observational" | "sr_ma_mixed" | "narrative_review" | "qualitative" | "mixed_methods" | "other";

export interface PaperCard {
  study_design: string;
  design_category?: DesignCategory | null; // absent on results stored before 2026-10-05
  population: string;
  sample_size?: number | null;
  sample_size_quote?: string | null;
  intervention_or_exposure: string;
  comparator?: string | null;
  outcomes: OutcomeResult[];
  key_findings: string[];
  limitations: string[];
  funding_or_conflicts?: string | null;
  risk_of_bias: RiskOfBias;
  overall_direction: Direction;
}

export interface Unverified {
  field: "effect" | "sample_size";
  outcome: string | null;
}

export interface Verification {
  numbers_verified: number;
  numbers_total: number;
  agreement: number | null;
  escalated: boolean;
  repaired: boolean;
  uncertain: boolean; // only: two models disagreed
  unverified?: Unverified[];
  design_mismatch?: boolean; // Plan 19: kept although its design is outside the ticked study types (relaxed)
}

export interface Paper {
  ref: string;
  title: string;
  authors?: string[];
  year?: number | null;
  journal?: string | null;
  doi?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  url?: string | null;
  relevance?: number | null;
  screen_reason?: string | null;
  // Legacy (results stored before abstract-only reading, 2026-10-05); new results read abstracts only.
  fulltext_source?: string | null;
  fulltext_url?: string | null;
  card?: PaperCard | null;
  card_en?: PaperCard | null;
  verification?: Verification | null;
  error?: string | null;
  /** Plan 20 Task 10 (engine): a further report of a trial already analysed: the primary report's ref. Absent before it. */
  related_to?: string | null;
  /**
   * English, from the engine: "same trial (EMPEROR-Preserved)", "same trial (NCT03057951)", "near-identical title, same
   * first author, same sample size" or "… same registry number" (shown through `relatedReasonText`).
   */
  related_reason?: string | null;
  /** On the primary report: the refs of the other reports of the same trial ([] on every other paper). */
  related_reports?: string[];
  /**
   * Plan 20 Task 6: read as a design outside the ticked study types (one of `excluded_selection.study_design_corrected`):
   * listed with its card, not evidence. Absent before it.
   */
  design_excluded?: boolean;
}

export interface ComparisonCell {
  ref: string;
  finding: string;
  direction: Direction;
  design_category?: string | null;
  pooled?: boolean;
  effect_measure?: string | null;
  effect_value?: number | null;
  ci_lower?: number | null;
  ci_upper?: number | null;
}

export interface ComparisonRow {
  outcome: string;
  cells: ComparisonCell[];
}

export interface EvidenceCluster {
  statement: string;
  refs: string[];
  explanation: string;
  likely_reasons?: string[];
  /**
   * Plan 20 Task 11: systematic reviews and primary studies point different ways (a conflict, or a consensus that
   * significant reviews contradict). Never lowers the grade. Absent before it: the engine's fixed statement wording
   * still tells (see `isReviewDiscordant`).
   */
  review_discordant?: boolean;
}

export type EvidenceStrength = "high" | "moderate" | "low" | "very_low";

export interface Synthesis {
  executive_summary: string;
  comparison?: ComparisonRow[];
  consensus?: EvidenceCluster[];
  conflicts?: EvidenceCluster[];
  evidence_strength?: EvidenceStrength | null; // null: not graded (narrative, scoping)
  evidence_rationale?: string;
  research_gaps?: string[];
  grade_baseline?: EvidenceStrength | null;
  /** Plan 20: 1–2 sentence direct answer (numberless; GRADE wording for graded types). "" or absent in older results. */
  answer?: string;
  /** Plan 20: at most 5 numberless findings; render numbers from the cards in `refs` or the matching pool. */
  key_findings?: KeyFinding[];
}

/** Plan 20: `outcome` is a comparison row name when it is about a row (localized like the row in `synthesis`). */
export interface KeyFinding {
  /** a comparison row name when it is about a row (localized like the row in `synthesis`) */
  outcome: string;
  /**
   * no numbers, no [Pn]. At low / very low certainty a strong causal claim is led by a fixed clause that is part of the
   * statement ("Low-certainty evidence suggests: …", "Very low-certainty evidence: …"), localized with it.
   */
  statement: string;
  refs: string[];
  k: number; // refs.length
  /**
   * Set in code, never by the model (Plan 20 Task 10): the review's final evidence_strength for graded types, null for
   * narrative and scoping reviews (not graded). Absent in results stored before it: the review-level grade, labelled.
   */
  certainty?: EvidenceStrength | null;
}

/** Plan 20: result.methods (absent in results stored before Plan 20). Models are "provider:model" strings. */
export interface ReviewMethods {
  searched_at: string | null; // ISO 8601 UTC
  sources: Record<string, number> | null; // records per source before deduplication (can sum to more than found)
  eligibility: {
    year_from: number | null;
    study_types: string[];
    inclusion_criteria: string[];
    exclusion_criteria: string[];
  };
  limits: { candidate_limit: number; max_papers: number; min_abstract_chars: number };
  screening: {
    model: string | null;
    second_model: string | null;
    second_vote: "two_models" | "same_model" | "off";
    borderline: [number, number];
    relevance_floor: number;
  };
  extraction: {
    model: string | null;
    second_model: string | null;
    verify_quotes: boolean;
    quote_match_threshold: number;
    text: "abstract";
  };
  synthesis: { model: string | null; pooling: string | null; grading: string | null };
}

export interface QuestionText {
  interpretation?: string | null;
  refined_question?: string | null;
  sub_questions?: string[];
  assumptions?: string[];
}

export type ReviewType = "narrative" | "slr" | "scoping" | "meta_analysis";

export interface KeyTerm {
  term: string;
  synonyms: string[];
  mesh: string | null;
}

export type ExclusionReason =
  | "off_topic" | "population" | "intervention_exposure" | "outcome" | "study_design" | "publication_type" | "other";

export interface QuestionBlock extends QuestionText {
  framework?: "PICO" | "PCC" | null;
  concept?: string | null;
  context?: string | null;
  key_terms?: KeyTerm[];
  original_topic?: string;
  english_topic?: string | null;
  refined?: boolean;
  english?: QuestionText | null;
  pico?: {
    population?: string;
    intervention_or_exposure?: string;
    comparator?: string;
    outcomes?: string[];
    study_designs?: string[];
    timeframe?: string | null;
  } | null;
  question_type?: string | null;
  ambiguities?: string[];
}

export interface Quality {
  numbers_verified?: number;
  numbers_total?: number;
  verification_rate?: number | null;
  papers_uncertain?: number;
  agreement_mean?: number | null;
  extraction_escalations?: number;
  fulltext_timeouts?: number; // legacy
  screen_disagreements?: number;
  citation_fixes?: number;
  /** meta_analysis: sentences the post-check removed for restating a pooled number (when the backend reports it). */
  pooled_numbers?: { removed: number; kept_single_study: number };
  /** Plan 19 grounded-prose check (only the keys the report reads; absent in older results). */
  prose_check?: {
    /**
     * How the evidence rationale was reconciled with the GRADE-lite factors in code: "replaced" (by the factors),
     * "appended" (a missing downgrade added), "trimmed" (Plan 20 Task 10: sentences that claimed more than the data show
     * were removed) or null (kept as written).
     */
    rationale_fixed?: "replaced" | "appended" | "trimmed" | null;
    answer_removed?: number;
    key_findings_removed?: number;
    key_findings_certainty_lead?: number;
  };
  timings?: Record<string, number | null>;
}

// --- Plan 14b: pooled analysis (meta_analysis reviews) and the citation network --------------------------------------

export type PoolMeasure = "HR" | "OR" | "RR" | "RD" | "MD" | "SMD";

/** One study in a pool. effect/ci_* are as reported (natural scale); y/se/variance are on the analysis scale (ln for
 * HR/OR/RR); weight is the random-effects weight in percent (the pool's weights sum to 100). */
export interface PoolStudy {
  ref: string;
  effect: number;
  ci_lower: number;
  ci_upper: number;
  y: number;
  se: number;
  variance: number;
  weight: number;
}

export interface Pool {
  outcome: string; // English matrix row
  outcome_display?: string | null; // the row name in the review language
  measure: PoolMeasure;
  scale: "log" | "raw";
  design_group: "rct" | "observational";
  k: number;
  studies: PoolStudy[];
  /** est and ci bounds on the display scale (exp() applied for log); y, y_ci bounds and se on the analysis scale. */
  pooled: { est: number; ci_lower: number; ci_upper: number; y: number; y_ci_lower: number; y_ci_upper: number; se: number };
  tau2: number; // analysis scale
  i2: number; // percent 0-100
  q: number;
  df: number;
  p_het: number;
  method: string;
  version: string;
  warnings: string[]; // codes, see META_CODE_LABEL
}

export interface PoolExcluded {
  outcome: string;
  outcome_display?: string | null;
  ref: string;
  measure: string | null;
  design_category: string | null;
  reason: string; // code, see META_CODE_LABEL
  duplicate_of?: string;
  k?: number;
  design_group?: string;
}

export interface PoolReference {
  outcome: string;
  outcome_display?: string | null;
  ref: string;
  design_category: string | null;
  measure: string | null;
  effect: number | null;
  ci_lower: number | null;
  ci_upper: number | null;
}

/** result.meta_analysis: null for other types (and when pooling failed); absent in results stored before Plan 14b. */
export interface MetaAnalysis {
  version: string;
  pools: Pool[];
  excluded: PoolExcluded[];
  reference: PoolReference[];
  grade?: { primary_outcome: string | null; design_group?: string | null; reasons: string[] } | null;
}

/** result.citations: edges between papers of this review (citing -> cited) and per-paper coverage. */
export interface Citations {
  edges: { from: string; to: string }[];
  cited_by: Record<string, number | null>;
  cited_by_source?: Record<string, "openalex" | "europepmc" | null>;
  coverage: Record<string, "openalex" | "europepmc" | null>;
  source_note: string;
  /** The lookup timed out and only the data gathered so far is shown. Absent in results stored before it existed. */
  partial?: boolean;
}

export interface Stats {
  found?: number;
  unique?: number;
  with_abstract?: number;
  candidates?: number;
  screened?: number;
  selected?: number;
  with_fulltext?: number; // legacy
  extracted?: number;
  non_research?: number;
  year_excluded?: number; // Plan 19: before the year filter's cut-off
  no_abstract?: number; // Plan 19: no usable abstract (abstract-only review)
  excluded_screening?: Partial<Record<ExclusionReason, number>>;
  excluded_selection?: {
    narrative_excluded: number; over_limit: number; low_relevance?: number;
    study_design_relaxed?: number; // design mismatches kept because fewer than 3 papers matched the ticked types
    study_design_corrected?: number; // Plan 19: read as a design outside the ticked types; listed, not evidence
    off_focus?: number; // Plan 20 Task 10: themes reviews only, included papers that never name the question's focus
  };
  /** Plan 20 Task 10: analysed papers that are further reports of a trial already analysed (not counted again). */
  related_reports?: number;
}

export interface ExternalNote {
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  preview: string;
}

export interface ReviewResult {
  topic?: string;
  english_topic?: string | null;
  language?: "th" | "en";
  review_type?: ReviewType; // absent in results stored before Plan 14a
  question?: QuestionBlock;
  summary?: string;
  synthesis?: Synthesis;
  synthesis_en?: Synthesis;
  papers?: Paper[];
  queries?: string[];
  stats?: Stats;
  quality?: Quality;
  errors?: string[];
  prompt_version?: string;
  llm_preset?: string;
  models?: Record<string, string>;
  external_context?: ExternalNote[];
  meta_analysis?: MetaAnalysis | null; // Plan 14b
  citations?: Citations | null; // Plan 14b
  methods?: ReviewMethods; // Plan 20
}

export interface ServiceStatus {
  accepting: boolean;
  reason: "queue_full" | "daily_reviews" | "daily_budget" | null;
  retry_after: number | null;
  queue_depth: number;
  running: number;
  reviews_today: number | null;
  turnstile_site_key: string | null;
  limits: {
    review_rate_limit: string;
    api_key_rate_limit: string;
    paper_search_rate_limit: string;
    max_papers: { min: number; max: number; default: number };
    candidate_limit: { min: number; max: number; default: number };
    max_queued_reviews: number;
    review_types?: string[];
    sse_max_per_ip?: number;
  };
}

export interface ReviewSummary {
  id: string;
  topic: string;
  language: "th" | "en";
  status: ReviewStatus;
  created_at: string;
  finished_at: string | null;
  verification_rate?: number | null;
}

export interface Review extends ReviewSummary {
  options: Record<string, unknown>;
  progress: Record<string, unknown> | null;
  result: ReviewResult | null;
  error: string | null;
  cost_usd: number;
  started_at: string | null;
  queue_position?: number | null;
}

export interface ReviewOptions {
  max_papers?: number;
  candidate_limit?: number;
  year_from?: number | null;
  study_types?: string[];
  review_type?: ReviewType;
}

export interface CreateReviewBody {
  topic: string;
  language: "th" | "en";
  options?: ReviewOptions;
}

export interface ReviewCreated {
  review_id: string;
  status: ReviewStatus;
  cached: boolean;
  callback_scheduled?: boolean;
}

export interface ReviewEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}
