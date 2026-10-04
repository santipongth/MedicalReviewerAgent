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
}

export interface PaperCard {
  study_design: string;
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
  uncertain: boolean;
  unverified?: Unverified[];
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
}

export interface ComparisonCell {
  ref: string;
  finding: string;
  direction: Direction;
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
}

export type EvidenceStrength = "high" | "moderate" | "low" | "very_low";

export interface Synthesis {
  executive_summary: string;
  comparison?: ComparisonRow[];
  consensus?: EvidenceCluster[];
  conflicts?: EvidenceCluster[];
  evidence_strength?: EvidenceStrength;
  evidence_rationale?: string;
  research_gaps?: string[];
  grade_baseline?: EvidenceStrength | null;
}

export interface QuestionText {
  interpretation?: string | null;
  refined_question?: string | null;
  sub_questions?: string[];
  assumptions?: string[];
}

export interface QuestionBlock extends QuestionText {
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
  timings?: Record<string, number | null>;
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
}

export interface ReviewOptions {
  max_papers?: number;
  candidate_limit?: number;
  year_from?: number | null;
  study_types?: string[];
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
