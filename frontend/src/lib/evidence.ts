// Helpers that keep the "every number is verifiable" promise in the UI: numbers are displayed exactly as the paper
// wrote them (never re-formatted or computed), and only values the backend verified are treated as verified.
import type { OutcomeResult, Paper } from "./types";

const NUM = /(?<![A-Za-z0-9_.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![A-Za-z0-9_.])-?\d+(?:\.\d+)?/g;

// Same normalisation as the backend verifier (app/harness/verify.py), one character for one character so indices
// still point into the original quote: Lancet decimal point, unicode minus, en/em dashes used as ranges.
const SAME_LENGTH: Record<string, string> = { "\u00b7": ".", "\u2212": "-", "\u2013": " ", "\u2014": " ", "\u00a0": " " };

export interface Reported {
  text: string;
  index: number;
}

/**
 * Where and how `value` appears in `quote` (exact spelling, standalone number), or null. When the same value appears
 * more than once (e.g. "RR 0.73" for two outcomes), `ci` picks the occurrence its own interval follows.
 */
export function findReported(value: number, quote?: string | null,
  ci?: { lo?: number | null; hi?: number | null }): Reported | null {
  if (!quote) return null;
  const normalised = quote.replace(/[\u00b7\u2212\u2013\u2014\u00a0]/g, (c) => SAME_LENGTH[c] ?? c);
  const hits: Reported[] = [];
  for (const m of normalised.matchAll(NUM)) {
    const parsed = Number(m[0].replace(/,/g, ""));
    if (Math.abs(parsed - value) <= Math.max(1e-9, Math.abs(value) * 0.005)) {
      const index = m.index ?? 0;
      hits.push({ text: quote.slice(index, index + m[0].length), index });
    }
  }
  if (hits.length > 1 && ci?.lo != null && ci?.hi != null) {
    const { lo, hi } = ci;
    const own = hits.find((h) => {
      const after = quote.slice(h.index + h.text.length, h.index + h.text.length + 60);
      return findReported(lo, after) !== null && findReported(hi, after) !== null;
    });
    if (own) return own;
  }
  return hits[0] ?? null;
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
