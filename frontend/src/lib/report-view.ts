// View model of the Plan 20 answer-first sections (title block, key findings, summary of findings, limitations).
// Pure, no React. Nothing here computes a number shown as if from a paper: effects are the cards' verified values
// (spelled as the paper wrote them), pooled values are the backend's computed values (formatted like meta-view.ts),
// and the only arithmetic is counting studies and adding up verified sample sizes (a computed number: ComputedNumber).
import { designKey, designLabel, isNonQuantitative, isPooled } from "./charts-data";
import { asReported, ciLabel, effectLabel, isBlankedEffect, isBlankedSampleSize } from "./evidence";
import { DIRECTION_ORDER, type Lang } from "./i18n";
import { DESIGN_GROUP_LABEL, fixed } from "./meta-view";
import type {
  ComparisonRow, Direction, EvidenceStrength, KeyFinding, MetaAnalysis, OutcomeResult, Paper, Pool, ReviewMethods, ReviewResult,
} from "./types";

// --- Matrix cells → card outcomes ------------------------------------------------------------------------------------

/**
 * The card outcome a matrix cell came from (by finding text, then by direction, then the first): shown and English.
 * Loose on purpose: only for choosing which sentence the source rail highlights. Never for showing a number.
 */
export function cellOutcome(paper: Paper | undefined, row: ComparisonRow, ref: string): { shown: OutcomeResult; en: OutcomeResult } | null {
  const cell = row.cells.find((c) => c.ref === ref);
  const en = paper?.card_en ?? paper?.card;
  const shown = paper?.card ?? en;
  if (!cell || !en || !shown || !en.outcomes.length) return null;
  const idx = [shown, en].map((c) => c.outcomes.findIndex((o) => o.result === cell.finding)).find((i) => i >= 0) ?? -1;
  const byDir = en.outcomes.findIndex((o) => o.direction === cell.direction);
  const i = idx >= 0 ? idx : byDir >= 0 ? byDir : 0;
  const o = en.outcomes[i];
  return o ? { en: o, shown: shown.outcomes[i] ?? o } : null;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * The card outcome a matrix cell is about, matched exactly: the cell's finding text equals the outcome's result (shown
 * or English card), or the outcome's name equals the row's name (shown or English). No fallback to the same direction
 * or to the first outcome: a number is only ever shown under the outcome it was verified for. Used for every number
 * in the key findings and the summary of findings; the rail keeps the looser `cellOutcome` for highlighting.
 */
export function cellOutcomeExact(paper: Paper | undefined, row: ComparisonRow, ref: string, enRow?: string | null):
  { shown: OutcomeResult; en: OutcomeResult } | null {
  const cell = row.cells.find((c) => c.ref === ref);
  const en = paper?.card_en ?? paper?.card;
  const shown = paper?.card ?? en;
  if (!cell || !en || !shown) return null;
  const finding = norm(cell.finding);
  const names = [norm(row.outcome), norm(enRow)].filter(Boolean);
  const i = en.outcomes.findIndex((o, j) => {
    const s = shown.outcomes[j];
    return (!!finding && (norm(o.result) === finding || norm(s?.result) === finding))
      || names.includes(norm(o.outcome)) || (!!s && names.includes(norm(s.outcome)));
  });
  if (i < 0) return null;
  return { en: en.outcomes[i], shown: shown.outcomes[i] ?? en.outcomes[i] };
}

/** A paper's verified effect for one matrix row, as the paper wrote it (never re-formatted). */
export interface StudyEffect {
  ref: string;
  outcomeKey: string; // the card's English outcome name, to open its quote in the rail
  measure: string | null;
  value: number;
  num: string; // "0.80", as written in the quote
  text: string; // "HR 0.80"
  ci: string | null; // "0.71–0.90"
}

export type EffectState = { kind: "verified"; effect: StudyEffect } | { kind: "blanked"; ref: string; outcomeKey: string } | null;

/**
 * The verified effect of `ref` in `row` (matched exactly, see `cellOutcomeExact`), a blanked one (shown as a
 * not-verified gap), or null (no number). `enRow` is the row's English name.
 */
export function studyEffect(paper: Paper | undefined, row: ComparisonRow, ref: string, enRow?: string | null): EffectState {
  const card = paper?.card_en ?? paper?.card;
  if (!paper || !card || isNonQuantitative(card)) return null;
  const hit = cellOutcomeExact(paper, row, ref, enRow);
  if (!hit || hit.en.matches_question === false) return null;
  if (isBlankedEffect(paper, hit.en.outcome)) return { kind: "blanked", ref, outcomeKey: hit.en.outcome };
  if (hit.en.effect_value == null) return null;
  const o = { ...hit.shown, evidence_quote: hit.en.evidence_quote ?? hit.shown.evidence_quote };
  return {
    kind: "verified",
    effect: {
      ref, outcomeKey: hit.en.outcome, measure: hit.en.effect_measure ?? null, value: hit.en.effect_value,
      num: asReported(hit.en.effect_value, o.evidence_quote), text: effectLabel(o), ci: ciLabel(o),
    },
  };
}

// --- Pools -------------------------------------------------------------------------------------------------------------

export interface PooledText {
  key: string;
  measure: string;
  est: string; // computed, 2 decimals like the meta-analysis section
  ci: string; // computed, "lo–hi"
  group: string; // "RCT" / "งานเชิงสังเกต"
  k: number;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The pools of one outcome, matched by the English row name or the shown one. */
export function poolsFor(meta: MetaAnalysis | null | undefined, shown: string, en: string | null | undefined, lang: Lang): PooledText[] {
  return (meta?.pools ?? [])
    .filter((p: Pool) => same(p.outcome, en) || same(p.outcome, shown) || same(p.outcome_display, shown))
    .map((p, i) => ({
      key: `${p.outcome}|${p.design_group}|${p.measure}|${i}`, measure: p.measure, est: fixed(p.pooled.est, 2),
      ci: `${fixed(p.pooled.ci_lower, 2)}–${fixed(p.pooled.ci_upper, 2)}`, group: DESIGN_GROUP_LABEL[p.design_group]?.[lang] ?? p.design_group, k: p.k,
    }));
}

// --- Rows by outcome ---------------------------------------------------------------------------------------------------

export interface OutcomeContext {
  rows: ComparisonRow[]; // shown comparison rows
  enRows: ComparisonRow[]; // English rows (same order as `rows` when both exist)
  papers: Paper[];
  meta?: MetaAnalysis | null;
  lang: Lang;
}

/** The English name of a shown row: the row at the same position in the English rows, when the two lists line up. */
function enName(ctx: OutcomeContext, row: ComparisonRow): string {
  const i = ctx.rows.indexOf(row);
  return ctx.enRows.length === ctx.rows.length && i >= 0 ? ctx.enRows[i]?.outcome ?? row.outcome : row.outcome;
}

/** The shown row a key finding is about: by its shown outcome name, or by its English one. */
export function rowFor(ctx: OutcomeContext, outcome: string, enOutcome?: string | null): ComparisonRow | undefined {
  const direct = ctx.rows.find((r) => same(r.outcome, outcome));
  if (direct) return direct;
  if (!enOutcome || ctx.enRows.length !== ctx.rows.length) return undefined;
  const i = ctx.enRows.findIndex((r) => same(r.outcome, enOutcome));
  return i >= 0 ? ctx.rows[i] : undefined;
}

const refsOf = (row: ComparisonRow) => [...new Set(row.cells.map((c) => c.ref))];

// --- Key findings ------------------------------------------------------------------------------------------------------

export interface FindingView {
  outcome: string;
  statement: string;
  refs: string[];
  k: number;
  /** every cited study is qualitative or mixed methods: counted as "found in k studies" */
  themes: boolean;
  pools: PooledText[];
  /** a single study's number (k = 1 and no pool), verified or blanked; null otherwise */
  effect: EffectState;
}

/**
 * Key findings with the one number that fits each: the pooled value(s) of its outcome (computed), else the verified
 * effect when it rests on one study, else nothing (the reader sees "k studies"; the summary-of-findings table shows
 * the range). `enFindings` is synthesis_en.key_findings (same order) for the English outcome names.
 */
export function keyFindingViews(findings: KeyFinding[], enFindings: KeyFinding[] | undefined, ctx: OutcomeContext): FindingView[] {
  const byRef = new Map(ctx.papers.map((p) => [p.ref, p]));
  return findings.map((f, i) => {
    const enOutcome = enFindings?.[i]?.outcome ?? null;
    const row = rowFor(ctx, f.outcome, enOutcome);
    const en = row ? enName(ctx, row) : null;
    const pools = poolsFor(ctx.meta, row?.outcome ?? f.outcome, enOutcome ?? en, ctx.lang);
    // One source for the studies: the matched row (as in the summary of findings), else the finding's own refs.
    const refs = row ? refsOf(row) : f.refs ?? [];
    const k = refs.length || f.k || 0;
    const effect = !pools.length && row && refs.length === 1 ? studyEffect(byRef.get(refs[0]), row, refs[0], en) : null;
    const themes = refs.length > 0 && refs.every((r) => isNonQuantitative(byRef.get(r)?.card_en ?? byRef.get(r)?.card));
    return { outcome: f.outcome, statement: f.statement, refs, k, themes, pools, effect };
  });
}

// --- Summary of findings -------------------------------------------------------------------------------------------------

export type SofEffect =
  | { kind: "pooled"; pools: PooledText[] }
  /** verified values of one named measure (HR, OR, MD …), lowest and highest; `other` = verified values of other measures */
  | { kind: "range"; measure: string; lo: StudyEffect; hi: StudyEffect; n: number; other: number }
  | { kind: "single"; effect: StudyEffect; other: number }
  /** two or more verified values with no shared named measure: counted per measure, never ranged */
  | { kind: "mixed"; measures: { measure: string | null; count: number }[] }
  | { kind: "blanked"; ref: string; outcomeKey: string }
  | { kind: "none" };

/** Participants of a row: the sum of verified sample sizes (a computed number), or why there is none. */
export type SofParticipants =
  | { kind: "sum"; total: number; counted: number; of: number; reviews: number }
  /** a primary study's sample size failed verification and none could be counted: a not-verified gap */
  | { kind: "blanked" }
  /** no primary study reports (or had extracted) a sample size: plain "not reported", never a gap */
  | { kind: "not_reported" }
  /** only systematic reviews / meta-analyses: their participants overlap with primary studies, so none are summed */
  | { kind: "reviews_only"; reviews: number };

export interface SofRow {
  key: string;
  outcome: string;
  refs: string[];
  k: number;
  designs: { label: string; count: number }[];
  participants: SofParticipants;
  effect: SofEffect;
  certainty: EvidenceStrength | null;
  /** "finding": set for this outcome; "review": the review-level grade repeated on every row */
  certaintySource: "finding" | "review" | null;
  statement: string | null;
  tally: { direction: Direction; count: number }[];
  themes: number;
}

/** A measure that names a scale shared across studies (HR, OR, RR, MD, SMD, RD …); never null, "none" or "other". */
export function isNamedMeasure(m: string | null | undefined): m is string {
  return !!m && !["none", "other", ""].includes(m.trim().toLowerCase());
}

function designsOf(refs: string[], byRef: Map<string, Paper>, lang: Lang) {
  const counts = new Map<string, number>();
  for (const r of refs) {
    const card = byRef.get(r)?.card ?? byRef.get(r)?.card_en;
    if (!card) continue;
    const label = designLabel(designKey(card), lang);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function participantsOf(refs: string[], byRef: Map<string, Paper>): SofParticipants {
  let total = 0;
  let counted = 0;
  let primary = 0;
  let reviews = 0;
  let blanked = 0;
  for (const r of refs) {
    const p = byRef.get(r);
    const card = p?.card_en ?? p?.card;
    if (!p || !card) continue;
    if (isPooled(p)) { reviews += 1; continue; } // a review's participants overlap with its primary studies
    primary += 1;
    if (isBlankedSampleSize(p)) blanked += 1;
    else if (card.sample_size != null) {
      total += card.sample_size;
      counted += 1;
    }
  }
  if (counted) return { kind: "sum", total, counted, of: primary, reviews };
  if (blanked) return { kind: "blanked" };
  if (!primary && reviews) return { kind: "reviews_only", reviews };
  return { kind: "not_reported" };
}

function effectOf(row: ComparisonRow | undefined, en: string | null, pools: PooledText[], byRef: Map<string, Paper>): SofEffect {
  if (pools.length) return { kind: "pooled", pools };
  if (!row) return { kind: "none" };
  const states = refsOf(row).filter((r) => !(byRef.get(r) && isPooled(byRef.get(r)!))).map((r) => studyEffect(byRef.get(r), row, r, en));
  const verified = states.flatMap((s) => (s?.kind === "verified" ? [s.effect] : []));
  if (!verified.length) {
    const blanked = states.find((s) => s?.kind === "blanked");
    return blanked?.kind === "blanked" ? blanked : { kind: "none" };
  }
  if (verified.length === 1) return { kind: "single", effect: verified[0], other: 0 };
  // A range only across values of one named measure; null, "none" and "other" are never a group.
  const groups = new Map<string, StudyEffect[]>();
  for (const e of verified) {
    if (!isNamedMeasure(e.measure)) continue;
    const m = e.measure.trim().toUpperCase();
    groups.set(m, [...(groups.get(m) ?? []), e]);
  }
  const best = [...groups.entries()].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length)[0];
  if (!best) {
    const counts = new Map<string | null, number>();
    for (const e of verified) {
      const m = isNamedMeasure(e.measure) ? e.measure.trim().toUpperCase() : null;
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return { kind: "mixed", measures: [...counts.entries()].map(([measure, count]) => ({ measure, count })) };
  }
  const [measure, list] = best;
  const other = verified.length - list.length;
  const sorted = [...list].sort((a, b) => a.value - b.value);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  if (lo.value === hi.value) return { kind: "single", effect: lo, other: other + list.length - 1 };
  return { kind: "range", measure, lo, hi, n: list.length, other };
}

function tallyOf(row: ComparisonRow | undefined, byRef: Map<string, Paper>) {
  const counts: Record<Direction, number> = { positive: 0, negative: 0, null: 0, mixed: 0, unclear: 0 };
  let themes = 0;
  for (const c of row?.cells ?? []) {
    const p = byRef.get(c.ref);
    if (isNonQuantitative(p ? p.card_en ?? p.card : { design_category: c.design_category })) themes += 1;
    else if (c.direction in counts) counts[c.direction] += 1;
  }
  return { tally: DIRECTION_ORDER.filter((d) => counts[d] > 0).map((direction) => ({ direction, count: counts[direction] })), themes };
}

/**
 * Summary-of-findings rows: the key findings' outcomes first (in their order), then every other matrix row that two or
 * more studies report, most studies first. Certainty is the finding's own (code-set) value, else the review's grade.
 */
export function sofRows(findings: KeyFinding[], enFindings: KeyFinding[] | undefined, ctx: OutcomeContext,
  strength: EvidenceStrength | null | undefined): SofRow[] {
  const byRef = new Map(ctx.papers.map((p) => [p.ref, p]));
  const used = new Set<ComparisonRow>();
  const out: SofRow[] = [];
  const build = (outcome: string, row: ComparisonRow | undefined, refs: string[], finding: KeyFinding | null, en: string | null): SofRow => {
    const pools = poolsFor(ctx.meta, outcome, en, ctx.lang);
    const { tally, themes } = tallyOf(row, byRef);
    const own = finding?.certainty ?? null;
    const certainty = own ?? strength ?? null;
    return {
      key: `${out.length}|${outcome}`, outcome, refs, k: refs.length, designs: designsOf(refs, byRef, ctx.lang),
      participants: participantsOf(refs, byRef), effect: effectOf(row, row ? enName(ctx, row) : en, pools, byRef),
      certainty, certaintySource: certainty == null ? null : own != null ? "finding" : "review",
      statement: finding?.statement || null, tally, themes,
    };
  };
  findings.forEach((f, i) => {
    const enOutcome = enFindings?.[i]?.outcome ?? null;
    const row = rowFor(ctx, f.outcome, enOutcome);
    if (row && used.has(row)) return;
    if (row) used.add(row);
    const refs = row ? refsOf(row) : f.refs ?? [];
    out.push(build(row?.outcome ?? f.outcome, row, refs, f, enOutcome ?? (row ? enName(ctx, row) : null)));
  });
  ctx.rows
    .filter((r) => !used.has(r) && refsOf(r).length >= 2)
    .sort((a, b) => refsOf(b).length - refsOf(a).length)
    .forEach((r) => out.push(build(r.outcome, r, refsOf(r), null, enName(ctx, r))));
  return out;
}

// --- Title block ---------------------------------------------------------------------------------------------------------

/** "10 ตุลาคม 2569 (ค.ศ. 2026)" in Thai (Buddhist era, then the common era), "10 October 2026" in English. UTC date. */
export function reportDate(iso: string | null | undefined, lang: Lang): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (lang === "en") return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const th = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  return `${th} (ค.ศ. ${d.getUTCFullYear()})`;
}

export const SOURCE_NAME: Record<string, string> = {
  pubmed: "PubMed", "europe pmc": "Europe PMC", europepmc: "Europe PMC", openalex: "OpenAlex", "semantic scholar": "Semantic Scholar",
  semanticscholar: "Semantic Scholar", crossref: "Crossref", arxiv: "arXiv", doaj: "DOAJ", openaire: "OpenAIRE",
};

/** Search sources by name, in the order the methods list them; the RCT search counts as its engine. */
export function sourceNames(sources: Record<string, number> | null | undefined): string[] {
  const names = Object.keys(sources ?? {}).map((k) => {
    const base = k.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
    return SOURCE_NAME[base] ?? k;
  });
  return [...new Set(names)];
}

/** "openrouter:deepseek/deepseek-v4-pro" → "deepseek/deepseek-v4-pro". */
export function modelName(m: string): string {
  const i = m.indexOf(":");
  return i >= 0 ? m.slice(i + 1) : m;
}

/** Every distinct model the review used: the methods' roles, else the result's role map. */
export function modelsUsed(result: Pick<ReviewResult, "methods" | "models">): string[] {
  const m = result.methods;
  const list = m
    ? [m.screening.model, m.screening.second_model, m.extraction.model, m.extraction.second_model, m.synthesis.model]
    : Object.values(result.models ?? {});
  return [...new Set(list.filter((x): x is string => !!x && x !== "stub").map(modelName))];
}

export type ReadingMode = "two_models" | "same_model" | "single" | "unknown";

/** How each paper was read: twice by two models, twice by the same model, once, or not recorded (older results). */
export function extractionReading(methods: ReviewMethods | undefined): { mode: ReadingMode; model: string | null; second: string | null } {
  const e = methods?.extraction;
  if (!e) return { mode: "unknown", model: null, second: null };
  const model = e.model ? modelName(e.model) : null;
  const second = e.second_model ? modelName(e.second_model) : null;
  if (!second) return { mode: "single", model, second };
  return { mode: second === model ? "same_model" : "two_models", model, second };
}

/** The "models disagree" flag says "two readings disagree" when both readings came from the same model. */
export function sameModelReadings(result: Pick<ReviewResult, "methods"> | null | undefined): boolean {
  return extractionReading(result?.methods).mode === "same_model";
}
