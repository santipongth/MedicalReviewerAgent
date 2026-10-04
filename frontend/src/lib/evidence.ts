// Helpers that keep the "every number is verifiable" promise in the UI: numbers are displayed exactly as the paper
// wrote them (never re-formatted or computed), and only values the backend verified are treated as verified.
import type { OutcomeResult, Paper, ReviewResult } from "./types";

const NUM = /(?<![A-Za-z0-9_.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![A-Za-z0-9_.])-?\d+(?:\.\d+)?/g;

/** The number as written in `quote` (e.g. "0.80", "1,234"); falls back to the plain value. */
export function asReported(value: number, quote?: string | null): string {
  if (quote) {
    for (const m of quote.matchAll(NUM)) {
      const parsed = Number(m[0].replace(/,/g, ""));
      if (Math.abs(parsed - value) <= Math.max(1e-9, Math.abs(value) * 0.005)) return m[0];
    }
  }
  return String(value);
}

/** True when the outcome carries a numeric effect that survived verification. */
export function isVerifiedEffect(paper: Paper, outcome: OutcomeResult): boolean {
  if (outcome.effect_value == null) return false;
  const blanked = paper.verification?.unverified ?? [];
  return !blanked.some((u) => u.field === "effect" && u.outcome === outcome.outcome);
}

/** True when the verifier blanked this outcome's numbers (show a "not verified" gap, not "not reported"). */
export function isBlankedEffect(paper: Paper, outcomeName: string): boolean {
  return (paper.verification?.unverified ?? []).some((u) => u.field === "effect" && u.outcome === outcomeName);
}

export function isBlankedSampleSize(paper: Paper): boolean {
  return (paper.verification?.unverified ?? []).some((u) => u.field === "sample_size");
}

export function effectLabel(o: OutcomeResult): string {
  const measure = o.effect_measure && o.effect_measure !== "none" && o.effect_measure !== "other" ? `${o.effect_measure} ` : "";
  return `${measure}${asReported(o.effect_value as number, o.evidence_quote)}`;
}

export function ciLabel(o: OutcomeResult): string | null {
  if (o.ci_lower == null || o.ci_upper == null) return null;
  return `${asReported(o.ci_lower, o.evidence_quote)}–${asReported(o.ci_upper, o.evidence_quote)}`;
}

export interface Receipt {
  ref: string;
  title: string;
  outcome: string;
  display: string;
  reported: string;
  quote: string;
  design?: string;
  sampleSize?: string;
}

/** First verified effect (with its verbatim quote) in a result, for the landing page's receipt. */
export function pickReceipt(result: ReviewResult | null | undefined): Receipt | null {
  for (const p of result?.papers ?? []) {
    const card = p.card_en ?? p.card;
    if (!card) continue;
    for (const o of card.outcomes ?? []) {
      if (!o.evidence_quote || !isVerifiedEffect(p, o)) continue;
      return {
        ref: p.ref, title: p.title, outcome: o.outcome, display: effectLabel(o),
        reported: asReported(o.effect_value as number, o.evidence_quote), quote: o.evidence_quote,
        design: card.study_design,
        sampleSize: card.sample_size != null ? asReported(card.sample_size, card.sample_size_quote) : undefined,
      };
    }
  }
  return null;
}
