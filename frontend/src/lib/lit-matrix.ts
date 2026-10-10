// Literature review matrix rows (Plan 14a). Text comes from the reader's language card, every number from the English
// card (the one the verifier checked). Nothing here formats or computes a paper number: it only hands out the helpers'
// output or a marker saying the value is blank, blanked by the verifier, or not reported.
import { designKey, designLabel, isNonQuantitative } from "./charts-data";
import { asReported, ciLabel, effectLabel, isBlankedEffect, isBlankedSampleSize } from "./evidence";
import type { Lang } from "./i18n";
import { showsDirection, showsRiskOfBias, type ReviewTypeOrLegacy } from "./review-type";
import { surnameOf } from "./author";
import { citedByCell, type CitedByCell } from "./citation-network";
import type { Citations, Direction, OutcomeResult, Paper, RiskOfBias } from "./types";

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
}

export type LitColumn =
  | "ref" | "design" | "population" | "exposure" | "comparator" | "outcomes" | "findings"
  | "direction" | "risk" | "n" | "citedBy" | "limitations";

const join = (xs: string[] | undefined) => (xs ?? []).filter(Boolean).join("; ");

export function litRows(papers: Paper[], lang: Lang, citations: Citations | null = null): LitRow[] {
  return papers.map((p) => {
    const card = lang === "en" ? p.card_en ?? p.card : p.card;
    const en = p.card_en ?? p.card;
    const byline = [surnameOf(p.authors?.[0]), p.year].filter(Boolean).join(" ");
    const base = {
      ref: p.ref, title: p.title, byline, uncertain: !!p.verification?.uncertain,
      designMismatch: !!p.verification?.design_mismatch, theme: isNonQuantitative(p.card_en ?? p.card),
      ...(citations ? { citedBy: citedByCell(citations, p.ref) } : {}),
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

/** Columns for this review type; the comparator column goes when no row has one, "cited by" needs a count. */
export function litColumns(type: ReviewTypeOrLegacy, rows: LitRow[]): LitColumn[] {
  const cols: LitColumn[] = ["ref", "design", "population", "exposure"];
  if (rows.some((r) => r.comparator)) cols.push("comparator");
  cols.push("outcomes", "findings");
  if (showsDirection(type)) cols.push("direction");
  if (showsRiskOfBias(type)) cols.push("risk");
  cols.push("n");
  // A column of dashes says nothing: it needs at least one count.
  if (rows.some((r) => r.citedBy?.count != null)) cols.push("citedBy");
  cols.push("limitations");
  return cols;
}
