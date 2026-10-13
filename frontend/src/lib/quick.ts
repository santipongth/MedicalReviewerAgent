// Plan 27: the quick answer ("ถามเร็ว"). Pure, no React: whether a review is a quick answer, its references numbered
// [1]…[n] in order of first citation (the engine stores them as `result.quick.refs`), the answer split into text and
// citation groups, and the link that asks for a full review of the same question. The references are the screened
// papers the answer cites; nothing here invents a number or a source.
import type { Review, ReviewResult } from "./types";

/** The citation groups the engine writes ("[P1]", "[P1, P3]"), the same pattern as `support.ts` and the backend. */
const CITE = /\[(P\d+(?:\s*,\s*P\d+)*)\]/g;

export function isQuickReview(review: Pick<Review, "options" | "result"> | null | undefined): boolean {
  return review?.result?.mode === "quick" || review?.options?.mode === "quick";
}

/** The refs the answer cites, in order of first citation: `result.quick.refs`, else read from the shown answer. */
export function quickRefs(result: ReviewResult): string[] {
  if (result.quick?.refs?.length) return result.quick.refs;
  const out: string[] = [];
  for (const m of (result.summary ?? result.synthesis?.executive_summary ?? "").matchAll(CITE)) {
    for (const ref of m[1].split(/\s*,\s*/)) if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

export type QuickPart =
  | { kind: "text"; text: string }
  /** `marker`: the group's index in the text (Plan 25 ties marker k to its support claim) */
  | { kind: "cite"; refs: string[]; numbers: number[]; marker: number };

/** The answer as text and citation groups; each group's refs numbered by their place in `refs` (1-based). A ref that
 * is not in `refs` is left out of its group; a group left empty keeps its marker index but shows nothing. */
export function quickParts(text: string, refs: string[]): QuickPart[] {
  const parts: QuickPart[] = [];
  let at = 0;
  let marker = 0;
  for (const m of text.matchAll(CITE)) {
    if (m.index > at) parts.push({ kind: "text", text: text.slice(at, m.index) });
    const known = m[1].split(/\s*,\s*/).filter((r) => refs.includes(r));
    parts.push({ kind: "cite", refs: known, numbers: known.map((r) => refs.indexOf(r) + 1), marker });
    marker += 1;
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}

/** A possible sentence end: a citation group (with an optional full stop after it) or a full stop, then a space. */
const END = /(\[P\d+(?:\s*,\s*P\d+)*\][.!?]?|[.!?])\s+(?=\S)/g;
/** Words whose full stop never ends a sentence. */
const ABBREV = /(?:^|[\s(])(?:vs|e\.g|i\.e|et al|etc|approx|cf|ca|incl)\.$/i;

/** The answer as sentences, each with the citation group that closes it, so each can stand on its own line. A Thai
 * sentence ends at a citation group followed by a space (Thai writes no full stop); an English one at a full stop, or
 * at a group followed by a capital. A full stop before a citation group stays with it; a decimal, an abbreviation or a
 * comma never splits. Joined with single spaces the sentences give back the answer. */
export function quickSentences(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (const m of text.matchAll(END)) {
    const end = m.index + m[1].length;
    const next = text[m.index + m[0].length];
    if (next === "[" || /[a-z0-9,;:)]/.test(next)) continue; // a citation of this sentence, or the sentence goes on
    if (!m[1].startsWith("[") && ABBREV.test(text.slice(Math.max(at, end - 12), end))) continue;
    out.push(text.slice(at, end).trim());
    at = m.index + m[0].length;
  }
  const rest = text.slice(at).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** `quickParts` per sentence (`quickSentences`), with each citation group's marker counted over the whole answer. */
export function quickBlocks(text: string, refs: string[]): QuickPart[][] {
  let offset = 0;
  return quickSentences(text).map((sentence) => {
    const parts = quickParts(sentence, refs).map((p) => (p.kind === "cite" ? { ...p, marker: p.marker + offset } : p));
    offset += parts.filter((p) => p.kind === "cite").length;
    return parts;
  });
}

/** The anchor of reference [n] in the quick answer's list. */
export const quickRefId = (n: number): string => `qref-${n}`;

type FormSource = { topic: string; language?: string | null; options?: Review["options"] | null };

/** The request form with the same question, language, start year and study types, set to `mode`. The person submits
 * it there (Turnstile, the rate limit and the report view live in the form). */
export function requestHref(mode: "quick" | "full", review: FormSource): string {
  const params = new URLSearchParams({ q: review.topic, mode });
  if (review.language === "th" || review.language === "en") params.set("lang", review.language);
  const { year_from: year, study_types: types } = review.options ?? {};
  if (typeof year === "number") params.set("year", String(year));
  const list = Array.isArray(types) ? types.filter((t): t is string => typeof t === "string") : [];
  if (list.length) params.set("types", list.join("|"));
  return `/?${params.toString()}#request`;
}

/** "ทำรีวิวฉบับเต็ม": the same question as a full review. */
export function fullReviewHref(review: Pick<Review, "topic" | "language" | "options">): string {
  return requestHref("full", review);
}

/** Retry / edit after a failed, cancelled or rejected review: the same mode it had (a quick answer retries as quick,
 * a full review, or one whose review is not known, as full), so the form never silently changes it. */
export function retryHref(topic: string, review?: Pick<Review, "language" | "options" | "result"> | null): string {
  return requestHref(isQuickReview(review) ? "quick" : "full", { topic, language: review?.language, options: review?.options });
}

/** The request form's starting values from the address (`?q=…&mode=…&lang=…&year=…&types=a|b`), each checked. */
export interface FormStart {
  topic?: string;
  mode?: "quick" | "full";
  language?: "th" | "en";
  yearFrom?: string;
  studyTypes?: string[];
}

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function formStart(params: Record<string, string | string[] | undefined>): FormStart {
  const topic = one(params.q)?.trim().slice(0, 600) || undefined;
  const mode = one(params.mode);
  const lang = one(params.lang);
  const year = one(params.year);
  const types = (one(params.types) ?? "").split("|").map((t) => t.trim().slice(0, 80)).filter(Boolean).slice(0, 10);
  return {
    topic,
    mode: mode === "quick" || mode === "full" ? mode : undefined,
    language: lang === "th" || lang === "en" ? lang : undefined,
    yearFrom: year && /^(19[5-9]\d|20\d\d)$/.test(year) ? year : undefined,
    studyTypes: types.length ? types : undefined,
  };
}
