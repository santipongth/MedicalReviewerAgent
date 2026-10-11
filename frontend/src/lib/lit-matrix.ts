// Literature review matrix rows (Plan 14a). Text comes from the reader's language card, every number from the English
// card (the one the verifier checked). Nothing here formats or computes a paper number: it only hands out the helpers'
// output or a marker saying the value is blank, blanked by the verifier, or not reported.
import { designKey, designLabel, isNonQuantitative } from "./charts-data";
import { asReported, ciLabel, effectLabel, isBlankedEffect, isBlankedSampleSize } from "./evidence";
import type { Lang } from "./i18n";
import { showsDirection, showsRiskOfBias, type ReviewTypeOrLegacy } from "./review-type";
import { surnameOf } from "./author";
import { citedByCell, type CitedByCell } from "./citation-network";
import type { Citations, Direction, OutcomeResult, Paper, QuestionBlock, RiskOfBias } from "./types";

export type NumberCell =
  | { kind: "value"; text: string }
  | { kind: "blanked" }
  | { kind: "none" };

export interface LitOutcome {
  name: string;
  effect: { label: string; ci: string | null } | { blanked: true } | null;
  /** Plan 19: not the question's intervention vs comparator; shown, never counted as evidence. */
  otherComparison: boolean;
  comparison: string | null;
  /** The reader explicitly said the abstract states no number (`effect_measure: "none"`); else "not extracted". */
  reportsNone: boolean;
}

/** The row's direction: none when every outcome is another comparison; when only some are, the matching outcomes'
 * shared direction (the card-level overall_direction may describe the other comparisons). */
function evidenceDirection(outcomes: OutcomeResult[], overall: Direction): Direction | null {
  if (!outcomes.length) return overall;
  const matching = outcomes.filter((o) => o.matches_question !== false);
  if (!matching.length) return null;
  if (matching.length === outcomes.length) return overall;
  const dirs = new Set(matching.map((o) => o.direction));
  return dirs.size === 1 ? matching[0].direction : overall;
}

export interface LitRow {
  ref: string;
  title: string;
  byline: string;
  year: number | null;
  failed: boolean;
  design: { label: string; pooled: boolean } | null;
  population: string;
  exposure: string;
  comparator: string;
  outcomes: LitOutcome[];
  findings: string;
  direction: Direction | null;
  uncertain: boolean;
  /** Plan 19: kept although its design is outside the ticked study types. */
  designMismatch: boolean;
  /** Qualitative / mixed-methods: themes, no numbers and no direction. */
  theme: boolean;
  risk: RiskOfBias | null;
  n: NumberCell;
  limitations: string;
  /** Cited-by count from OpenAlex / Europe PMC (a count, not a paper number); absent when the review has no citations. */
  citedBy?: CitedByCell;
  /** Plan 20 Task 11: a further report of this primary report's trial (one study, not another row of evidence). */
  relatedTo?: string;
}

/**
 * Compact columns (Plan 20 Task 5): the sample size sits with the population, the comparator with the intervention;
 * key findings and limitations stay in the source rail and the CSV.
 */
export type LitColumn = "ref" | "design" | "population" | "exposure" | "outcomes" | "direction" | "risk";

/**
 * Column wording for the question's framework: PICO, PCC (scoping), PICo (qualitative: Population, phenomenon of
 * Interest, Context) and SPIDER-like (qualitative with mixed methods: Sample, Phenomenon of Interest, Design, Evaluation).
 */
export type LitFramework = "pico" | "pcc" | "pico_qual" | "spider";

const join = (xs: string[] | undefined) => (xs ?? []).filter(Boolean).join("; ");

export function litRows(papers: Paper[], lang: Lang, citations: Citations | null = null): LitRow[] {
  return papers.map((p) => {
    const card = lang === "en" ? p.card_en ?? p.card : p.card;
    const en = p.card_en ?? p.card;
    const byline = [surnameOf(p.authors?.[0]), p.year].filter(Boolean).join(" ");
    const base = {
      ref: p.ref, title: p.title, byline, year: p.year ?? null, uncertain: !!p.verification?.uncertain,
      designMismatch: !!p.verification?.design_mismatch, theme: isNonQuantitative(p.card_en ?? p.card),
      ...(citations ? { citedBy: citedByCell(citations, p.ref) } : {}),
      ...(p.related_to ? { relatedTo: p.related_to } : {}),
    };
    if (!card || !en) {
      return { ...base, failed: true, design: null, population: "", exposure: "", comparator: "", outcomes: [], findings: "",
        direction: null, risk: null, n: { kind: "none" }, limitations: "" };
    }
    const key = designKey(card);
    const outcomes: LitOutcome[] = card.outcomes.map((o, i) => {
      const eo = en.outcomes[i] ?? en.outcomes.find((x) => x.outcome === o.outcome);
      let effect: LitOutcome["effect"] = null;
      if (isNonQuantitative(en)) effect = null; // a theme never shows a number, even one that slipped through
      else if (eo && isBlankedEffect(p, eo.outcome)) effect = { blanked: true };
      else if (eo && eo.effect_value != null) effect = { label: effectLabel(eo), ci: ciLabel(eo) };
      const other = (eo?.matches_question ?? o.matches_question) === false;
      return {
        name: o.outcome, effect, otherComparison: other, comparison: other ? o.comparison ?? eo?.comparison ?? null : null,
        reportsNone: (eo ?? o).effect_measure === "none",
      };
    });
    const sample = en.sample_size ?? card.sample_size;
    const n: NumberCell = isBlankedSampleSize(p) ? { kind: "blanked" }
      : sample != null ? { kind: "value", text: asReported(sample, en.sample_size_quote ?? card.sample_size_quote) }
      : { kind: "none" };
    return {
      ...base, failed: false,
      design: { label: designLabel(key, lang), pooled: key.startsWith("sr_ma_") },
      population: card.population, exposure: card.intervention_or_exposure, comparator: card.comparator?.trim() ?? "",
      outcomes, findings: join(card.key_findings), direction: isNonQuantitative(card) ? null : evidenceDirection(en.outcomes, card.overall_direction), risk: card.risk_of_bias, n,
      limitations: join(card.limitations),
    };
  });
}

/**
 * Columns for this review type, in reading order: study (with its year and cited-by count), design, population/sample,
 * intervention, outcomes, then direction with risk of bias under it (not for scoping or a themes review).
 */
export function litColumns(type: ReviewTypeOrLegacy, _rows: LitRow[], framework: LitFramework = "pico"): LitColumn[] {
  const cols: LitColumn[] = ["ref", "design", "population", "exposure", "outcomes"];
  // Fix round 1: six columns fit the reading column. The year and the cited-by count sit in the study cell, risk of
  // bias under the direction; a review without a direction column keeps risk of bias as its own (not for scoping).
  if (showsDirection(type) && (framework === "pico" || framework === "pcc")) cols.push("direction");
  else if (showsRiskOfBias(type)) cols.push("risk");
  return cols;
}

/** Whether the study cell carries a cited-by count (a line of dashes says nothing: it needs at least one count). */
export function showsCitedBy(rows: LitRow[]): boolean {
  return rows.some((r) => r.citedBy?.count != null);
}

/** The framework of the matrix: PCC for scoping, PICo / SPIDER-like when every read study reports themes, else PICO. */
export function litFramework(type: ReviewTypeOrLegacy, papers: Paper[], question: QuestionBlock | null | undefined): LitFramework {
  if (type === "scoping" || question?.framework === "PCC") return "pcc";
  const designs = papers.map((p) => (p.card_en ?? p.card)?.design_category).filter((d): d is NonNullable<typeof d> => d != null);
  if (!designs.length || !designs.every((d) => d === "qualitative" || d === "mixed_methods")) return "pico";
  return designs.includes("mixed_methods") ? "spider" : "pico_qual";
}

const LABELS: Record<LitFramework, Partial<Record<LitColumn, [string, string]>>> = {
  pico: {
    population: ["ประชากร / ขนาดตัวอย่าง", "Population / sample"],
    exposure: ["การรักษาหรือปัจจัย (เทียบกับ)", "Intervention (vs comparator)"],
  },
  pcc: {
    population: ["ประชากร / ขนาดตัวอย่าง", "Population / sample"],
    exposure: ["แนวคิด (C)", "Concept"],
    outcomes: ["ประเด็นที่ทำแผนที่", "Aspects charted"],
  },
  pico_qual: {
    population: ["ประชากร (P)", "Population (P)"],
    exposure: ["ปรากฏการณ์ที่สนใจ (I)", "Phenomenon of interest (I)"],
    outcomes: ["ประเด็นที่พบ", "Themes"],
  },
  spider: {
    population: ["กลุ่มตัวอย่าง (S)", "Sample (S)"],
    exposure: ["ปรากฏการณ์ที่สนใจ (PI)", "Phenomenon of interest (PI)"],
    design: ["รูปแบบการวิจัย (D, R)", "Design (D, R)"],
    outcomes: ["การประเมิน (E)", "Evaluation (E)"],
  },
};

const BASE_LABEL: Record<LitColumn, [string, string]> = {
  ref: ["งานวิจัย", "Study"], design: ["รูปแบบการศึกษา", "Study design"],
  population: ["ประชากร", "Population"], exposure: ["สิ่งที่ศึกษา", "Intervention"], outcomes: ["ผลลัพธ์", "Outcomes"],
  direction: ["ทิศทาง", "Direction"], risk: ["ความเสี่ยงอคติ", "Risk of bias"],
};

export function litColumnLabel(col: LitColumn, framework: LitFramework, lang: Lang): string {
  const [th, en] = LABELS[framework][col] ?? BASE_LABEL[col];
  return lang === "th" ? th : en;
}

/** The outcomes cell is clamped to two lines (with "show all" opening the paper in the rail) when it is long. */
export function outcomesClamped(row: LitRow): boolean {
  return row.outcomes.length > 2 || row.outcomes.reduce((n, o) => n + o.name.length, 0) > 140;
}

/** One page of `items` (`size` per page), the page clamped to the range; pages is at least 1. */
export function paginate<T>(items: T[], page: number, size: number): { items: T[]; page: number; pages: number; start: number; end: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  const start = p * size;
  const end = Math.min(items.length, start + size);
  return { items: items.slice(start, end), page: p, pages, start, end };
}
