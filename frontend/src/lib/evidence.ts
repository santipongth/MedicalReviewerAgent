// Helpers that keep the "every number is verifiable" promise in the UI: numbers are displayed exactly as the paper
// wrote them (never re-formatted or computed), and only values the backend verified are treated as verified.
import type { OutcomeResult, Paper } from "./types";

// The backend verifier's tokenizer (app/harness/verify.py `_tokens`), ported so a verified number is found in its
// quote in every format the verifier accepts. FOLD maps one character to one character, so match offsets are offsets
// in the original quote: em dash -> en dash, Lancet middle dot -> decimal point, no-break / thin / narrow no-break /
// figure spaces -> space.
const FOLD: Record<string, string> = {
  "\u2014": "\u2013", "\u00b7": ".", "\u00a0": " ", "\u2009": " ", "\u202f": " ", "\u2007": " ",
};
const HEAD = String.raw`(?<![A-Za-z0-9_.])(?:(?<sign>[-\u2013]) {0,2}|(?<usign>\u2212) *)?(?:`;
const TAIL = String.raw`(?<comma_k>\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?!\d|,\d)` + // 1,234  1,234.5
  String.raw`|(?<space_k>\d{1,3}(?: \d{3})+(?:\.\d+)?)(?!\d| \d)` + // 111 725
  String.raw`|(?<plain>\d+(?:\.\d+)?)` +
  String.raw`|(?<lead_dot>\.\d+))`; // P = .003
// comma-decimal quotes only: 0,85 / 12,5 (three digits after the comma = thousands), never inside a list "1,2,5"
const DEC_COMMA = String.raw`(?<!\d,)(?<dec_comma>0,\d+|[1-9]\d{0,2},\d{1,2})(?!\d|,\d)|`;
// decimal-point quotes: "0,86" is one unreadable token that matches no value, never two integers
const OPAQUE = String.raw`(?<!\d,)(?<opaque>\d+,\d{1,2})(?!\d|,\d)|`;
const TOKEN_POINT = new RegExp(HEAD + OPAQUE + TAIL, "g");
const TOKEN_COMMA = new RegExp(HEAD + DEC_COMMA + TAIL, "g");

export interface Reported {
  text: string;
  index: number;
}

interface Token extends Reported {
  value: number;
}

function fold(text: string): string {
  return text.replace(/[\u2014\u00b7\u00a0\u2009\u202f\u2007]/g, (c) => FOLD[c] ?? c);
}

/** True when the text writes decimals with a comma: it has no decimal point at all (as the verifier decides). */
function commaDecimals(text: string): boolean {
  return !/\d\.\d/.test(fold(text));
}

/** Every readable number in `text`, with its spelling and offset in the original text. */
function tokens(text: string, comma: boolean): Token[] {
  const folded = fold(text);
  const out: Token[] = [];
  for (const m of folded.matchAll(comma ? TOKEN_COMMA : TOKEN_POINT)) {
    const g = m.groups ?? {};
    if (g.opaque !== undefined) continue; // unreadable: verifies nothing, so it is never "the" number
    const raw = g.comma_k ?? g.space_k ?? g.dec_comma ?? g.plain ?? g.lead_dot ?? "";
    let value = Number(
      g.comma_k !== undefined || g.space_k !== undefined ? raw.replace(/[, ]/g, "")
        : g.dec_comma !== undefined ? raw.replace(",", ".")
          : g.lead_dot !== undefined ? `0${raw}` : raw);
    const end = (m.index ?? 0) + m[0].length;
    let start = end - raw.length;
    if (g.usign !== undefined) { // the unicode minus is always a minus
      value = -value;
      start = m.index ?? start;
    } else if (g.sign !== undefined) {
      // a hyphen or en dash right after a number ("0.71 - 0.90", "12% \u2013 15%") is a range, not a minus
      const before = folded.slice(0, m.index ?? 0).trimEnd();
      const last = before.slice(-1);
      if (!(last && (/\d/.test(last) || last === "%"))) {
        value = -value;
        start = m.index ?? start;
      }
    }
    out.push({ value, index: start, text: text.slice(start, end) });
  }
  return out;
}

function same(parsed: number, value: number): boolean {
  return Math.abs(parsed - value) <= Math.max(1e-9, Math.abs(value) * 0.005);
}

/**
 * Where and how `value` appears in `quote` (exact spelling, standalone number), or null. When the same value appears
 * more than once (e.g. "RR 0.73" for two outcomes), `ci` picks the occurrence its own interval follows.
 */
export function findReported(value: number, quote?: string | null,
  ci?: { lo?: number | null; hi?: number | null }): Reported | null {
  if (!quote) return null;
  const comma = commaDecimals(quote);
  const all = tokens(quote, comma);
  const hits: Reported[] = all.filter((t) => same(t.value, value)).map(({ text, index }) => ({ text, index }));
  if (hits.length > 1 && ci?.lo != null && ci?.hi != null) {
    const { lo, hi } = ci;
    const own = hits.find((h) => {
      const from = h.index + h.text.length;
      const after = all.filter((t) => t.index >= from && t.index + t.text.length <= from + 60); // the next 60 chars
      return after.some((t) => same(t.value, lo)) && after.some((t) => same(t.value, hi));
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
