// Helpers that keep the "every number is verifiable" promise in the UI: numbers are displayed exactly as the paper
// wrote them (never re-formatted or computed), and only values the backend verified are treated as verified.
import type { OutcomeResult, Paper, ReviewResult } from "./types";

const NUM = /(?<![A-Za-z0-9_.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![A-Za-z0-9_.])-?\d+(?:\.\d+)?/g;

// Same normalisation as the backend verifier (app/harness/verify.py), one character for one character so indices
// still point into the original quote: Lancet decimal point, unicode minus, en/em dashes used as ranges.
const SAME_LENGTH: Record<string, string> = { "\u00b7": ".", "\u2212": "-", "\u2013": " ", "\u2014": " ", "\u00a0": " " };

export interface Reported {
  text: string;
  index: number;
}

/** Where and how `value` appears in `quote` (exact spelling, standalone number), or null. */
export function findReported(value: number, quote?: string | null): Reported | null {
  if (!quote) return null;
  const normalised = quote.replace(/[\u00b7\u2212\u2013\u2014\u00a0]/g, (c) => SAME_LENGTH[c] ?? c);
  for (const m of normalised.matchAll(NUM)) {
    const parsed = Number(m[0].replace(/,/g, ""));
    if (Math.abs(parsed - value) <= Math.max(1e-9, Math.abs(value) * 0.005)) {
      const index = m.index ?? 0;
      return { text: quote.slice(index, index + m[0].length), index };
    }
  }
  return null;
}

/** The number as written in `quote` (e.g. "0.80", "0·80", "1,234"); falls back to the plain value. */
export function asReported(value: number, quote?: string | null): string {
  return findReported(value, quote)?.text ?? String(value);
}

/** Only http(s) links are rendered; anything else (javascript:, data:) is dropped. */
export function safeHref(url?: string | null): string | null {
  const u = url?.trim();
  return u && /^https?:\/\//i.test(u) ? u : null;
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
  value: number;
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
        reported: asReported(o.effect_value as number, o.evidence_quote), value: o.effect_value as number,
        quote: o.evidence_quote,
        design: card.study_design,
        sampleSize: card.sample_size != null ? asReported(card.sample_size, card.sample_size_quote) : undefined,
      };
    }
  }
  return null;
}
