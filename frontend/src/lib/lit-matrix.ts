// Literature review matrix rows (Plan 14a). Text comes from the reader's language card, every number from the English
// card (the one the verifier checked). Nothing here formats or computes a paper number: it only hands out the helpers'
// output or a marker saying the value is blank, blanked by the verifier, or not reported.
import { designKey, designLabel } from "./charts-data";
import { asReported, ciLabel, effectLabel, isBlankedEffect, isBlankedSampleSize } from "./evidence";
import type { Lang } from "./i18n";
import { showsDirection, showsRiskOfBias, type ReviewTypeOrLegacy } from "./review-type";
import { surnameOf } from "./author";
import type { Direction, Paper, RiskOfBias } from "./types";

export type NumberCell =
  | { kind: "value"; text: string }
  | { kind: "blanked" }
  | { kind: "none" };

export interface LitOutcome {
  name: string;
  effect: { label: string; ci: string | null } | { blanked: true } | null;
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
  risk: RiskOfBias | null;
  n: NumberCell;
  limitations: string;
}

export type LitColumn =
  | "ref" | "design" | "population" | "exposure" | "comparator" | "outcomes" | "findings"
  | "direction" | "risk" | "n" | "limitations";

const join = (xs: string[] | undefined) => (xs ?? []).filter(Boolean).join("; ");

export function litRows(papers: Paper[], lang: Lang): LitRow[] {
  return papers.map((p) => {
    const card = lang === "en" ? p.card_en ?? p.card : p.card;
    const en = p.card_en ?? p.card;
    const byline = [surnameOf(p.authors?.[0]), p.year].filter(Boolean).join(" ");
    const base = { ref: p.ref, title: p.title, byline, uncertain: !!p.verification?.uncertain };
    if (!card || !en) {
      return { ...base, failed: true, design: null, population: "", exposure: "", comparator: "", outcomes: [], findings: "",
        direction: null, risk: null, n: { kind: "none" }, limitations: "" };
    }
    const key = designKey(card);
    const outcomes: LitOutcome[] = card.outcomes.map((o, i) => {
      const eo = en.outcomes[i] ?? en.outcomes.find((x) => x.outcome === o.outcome);
      let effect: LitOutcome["effect"] = null;
      if (eo && isBlankedEffect(p, eo.outcome)) effect = { blanked: true };
      else if (eo && eo.effect_value != null) effect = { label: effectLabel(eo), ci: ciLabel(eo) };
      return { name: o.outcome, effect };
    });
    const sample = en.sample_size ?? card.sample_size;
    const n: NumberCell = isBlankedSampleSize(p) ? { kind: "blanked" }
      : sample != null ? { kind: "value", text: asReported(sample, en.sample_size_quote ?? card.sample_size_quote) }
      : { kind: "none" };
    return {
      ...base, failed: false,
      design: { label: designLabel(key, lang), pooled: key.startsWith("sr_ma_") },
      population: card.population, exposure: card.intervention_or_exposure, comparator: card.comparator?.trim() ?? "",
      outcomes, findings: join(card.key_findings), direction: card.overall_direction, risk: card.risk_of_bias, n,
      limitations: join(card.limitations),
    };
  });
}

/** Columns for this review type; the comparator column goes when no row has one. */
export function litColumns(type: ReviewTypeOrLegacy, rows: LitRow[]): LitColumn[] {
  const cols: LitColumn[] = ["ref", "design", "population", "exposure"];
  if (rows.some((r) => r.comparator)) cols.push("comparator");
  cols.push("outcomes", "findings");
  if (showsDirection(type)) cols.push("direction");
  if (showsRiskOfBias(type)) cols.push("risk");
  cols.push("n", "limitations");
  return cols;
}
