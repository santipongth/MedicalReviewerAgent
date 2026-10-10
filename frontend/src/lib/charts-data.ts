// Chart data built only from verified values. Nothing here estimates, converts or recomputes a number from a paper.
import { surnameOf } from "./author";
import { asReported, ciLabel, effectLabel, findReported, isBlankedEffect, isBlankedSampleSize, isVerifiedEffect } from "./evidence";
import { DESIGN_LABEL, type Lang } from "./i18n";
import { clampLabel } from "./text-wrap";
import { isRelatedReport } from "./trial-reports";
import type { DesignCategory, Direction, ExclusionReason, OutcomeResult, Paper, PaperCard, RiskOfBias } from "./types";

/** The design a paper is filtered by: its fixed category, or (results stored before categories) its free text. */
export function designKey(card: PaperCard): string {
  return card.design_category ?? card.study_design;
}

export function designLabel(key: string, lang: Lang): string {
  return DESIGN_LABEL[lang][key as DesignCategory] ?? key;
}

export interface Filters {
  minRelevance: number;
  yearFrom: number | null;
  yearTo: number | null;
  risk: RiskOfBias[];
  designs: string[];
}

export function emptyFilters(): Filters {
  return { minRelevance: 0, yearFrom: null, yearTo: null, risk: [], designs: [] };
}

export function isFiltered(f: Filters): boolean {
  return f.minRelevance > 0 || f.yearFrom != null || f.yearTo != null || f.risk.length > 0 || f.designs.length > 0;
}

export function filterPapers(papers: Paper[], f: Filters): Paper[] {
  return papers.filter((p) => {
    const card = p.card_en ?? p.card;
    if ((p.relevance ?? 0) < f.minRelevance) return false;
    if (f.yearFrom != null && (p.year == null || p.year < f.yearFrom)) return false;
    if (f.yearTo != null && (p.year == null || p.year > f.yearTo)) return false;
    if (f.risk.length && (!card || !f.risk.includes(card.risk_of_bias))) return false;
    if (f.designs.length && (!card || !f.designs.includes(designKey(card)))) return false;
    return true;
  });
}

/** Qualitative and mixed-methods studies (Plan 17a): summarised as themes from the abstract, never a direction of
 * effect, a forest-plot row or a pooled input. */
export const NON_QUANTITATIVE_DESIGNS: readonly string[] = ["qualitative", "mixed_methods"];

export function isNonQuantitative(card: { design_category?: string | null } | null | undefined): boolean {
  return !!card?.design_category && NON_QUANTITATIVE_DESIGNS.includes(card.design_category);
}

/** The card's overall direction as evidence for the question: "unclear" when it reports outcomes and every one is
 * another comparison (`matches_question: false`). Results since the Plan 19 final review already store it so; this
 * keeps older results from counting a GLP-1RA-vs-insulin "positive" as support in a metformin review. */
export function questionDirection(card: Pick<PaperCard, "overall_direction" | "outcomes">): Direction {
  const outcomes = card.outcomes ?? [];
  return outcomes.length && outcomes.every((o) => o.matches_question === false) ? "unclear" : card.overall_direction;
}

/** Papers that have a card, counted by the card's overall direction. A count of papers, not a number from a paper.
 * `skipReviews` leaves narrative-review articles out (they restate other studies; the matrix and map skip them too).
 * Qualitative and mixed-methods studies are never counted (they report themes, not a direction), and neither is a
 * further report of a trial already counted (Plan 20 Task 11: one study, however many reports). */
export function directionTally(papers: Paper[], skipReviews = false): Record<Direction, number> {
  const tally: Record<Direction, number> = { positive: 0, negative: 0, null: 0, mixed: 0, unclear: 0 };
  for (const p of papers) {
    if (isRelatedReport(p)) continue;
    const card = p.card_en ?? p.card;
    if (skipReviews && card?.design_category === "narrative_review") continue;
    if (isNonQuantitative(card)) continue;
    if (card && questionDirection(card) in tally) tally[questionDirection(card)] += 1;
  }
  return tally;
}

/** Papers with a qualitative or mixed-methods card: summarised as themes ("found in k studies"), never a direction. */
export function themePapers(papers: Paper[]): Paper[] {
  return papers.filter((p) => isNonQuantitative(p.card_en ?? p.card));
}

/** True when the paper is a systematic review / meta-analysis (it may already pool the primary studies). */
export function isPooled(p: Paper): boolean {
  return !!(p.card_en ?? p.card)?.design_category?.startsWith("sr_ma");
}

/** True when any paper is a systematic review / meta-analysis. */
export function hasPooledPapers(papers: Paper[]): boolean {
  return papers.some(isPooled);
}

export type Family = "ratio" | "difference" | "correlation";
const FAMILY: Record<string, Family> = { HR: "ratio", OR: "ratio", RR: "ratio", MD: "difference", SMD: "difference", RD: "difference", r: "correlation" };

/** The scale family of an effect measure (HR/OR/RR ratio, MD/SMD/RD difference, r correlation), or null. */
export function measureFamily(measure: string | null | undefined): Family | null {
  const m = (measure ?? "").trim();
  if (m === "r") return "correlation";
  return FAMILY[m.toUpperCase()] ?? null;
}

/** "P3 · Lindqvist 2021": the ref, then the first author's surname and the year when known. */
export function studyLabel(p: Pick<Paper, "ref" | "authors" | "year">): string {
  const byline = [surnameOf(p.authors?.[0]), p.year].filter(Boolean).join(" ");
  return byline ? `${p.ref} · ${byline}` : p.ref;
}

// --- Axes (Plan 20 Task 5) --------------------------------------------------------------------------------------------
// Positions and tick labels only: an axis never shows a paper's number, so it is set in the display face.

export type AxisKind = "ratio" | "difference" | "proportion";

export interface Axis {
  kind: AxisKind;
  min: number;
  max: number;
  ticks: number[];
  /** 1 for ratios, 0 for differences, none for proportions (sensitivity and specificity have no "no effect" line). */
  nullValue: number | null;
}

/** Log ticks a reader knows (0.25 · 0.5 · 1 · 2 · 4 around 1). */
const LOG_TICKS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 10, 20, 50, 100, 200, 500, 1000];
const MAX_TICKS = 7;

const round = (v: number) => Number(v.toPrecision(12));

/** A 1-2-5 step at least `raw`. */
function niceStep(raw: number): number {
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  return round((f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp);
}

/**
 * Axis bounds and ticks for `values` (estimates and interval ends). Ratios: a log axis whose ends are ticks of LOG_TICKS,
 * thinned outward from 1 to at most 7; differences: 1-2-5 steps; both keep the null value inside the frame, never on
 * its edge. Proportions: a fixed 0–100% axis.
 */
export function niceAxis(values: number[], kind: AxisKind): Axis {
  // inset by 2 points so a marker at 0% or 100% stays inside the frame
  if (kind === "proportion") return { kind, min: -2, max: 102, ticks: [0, 25, 50, 75, 100], nullValue: null };
  const nullValue = kind === "ratio" ? 1 : 0;
  const vs = values.filter((v) => Number.isFinite(v) && (kind !== "ratio" || v > 0)).concat(nullValue);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  if (kind === "ratio") {
    let a = [...LOG_TICKS].reverse().find((t) => t <= lo) ?? lo;
    let b = LOG_TICKS.find((t) => t >= hi) ?? hi;
    const step = (t: number, dir: 1 | -1) => LOG_TICKS[LOG_TICKS.indexOf(t) + dir] ?? (dir > 0 ? t * 2 : t / 2);
    if (a === nullValue) a = step(a, -1);
    if (b === nullValue) b = step(b, 1);
    let ticks = LOG_TICKS.filter((t) => t >= a && t <= b);
    if (ticks.length > MAX_TICKS) {
      const one = ticks.indexOf(1);
      ticks = ticks.filter((_, i) => (i - one) % 2 === 0);
    }
    return { kind, min: a, max: b, ticks, nullValue };
  }
  const step = niceStep(Math.max(hi - lo, 1e-9) / 4);
  let a = round(Math.floor(lo / step) * step);
  let b = round(Math.ceil(hi / step) * step);
  if (a === nullValue) a = round(a - step);
  if (b === nullValue) b = round(b + step);
  const ticks: number[] = [];
  for (let t = a; t <= b + step / 2; t = round(t + step)) ticks.push(t);
  return { kind, min: a, max: b, ticks, nullValue };
}

/** Where `v` sits across the axis, 0 (left) to 1 (right), clamped; log for ratios. */
export function axisFraction(v: number, axis: Axis): number {
  const f = axis.kind === "ratio"
    ? (Math.log(v) - Math.log(axis.min)) / (Math.log(axis.max) - Math.log(axis.min))
    : (v - axis.min) / (axis.max - axis.min);
  return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
}

/** A tick label: no trailing zeros, a true minus sign. */
export function tickText(v: number): string {
  const s = String(Number(v.toPrecision(3)));
  return s.startsWith("-") ? `−${s.slice(1)}` : s;
}

/**
 * The axis's two sides in measure terms only (Plan 20 Task 5 fix round 1): "< 1 · lower with <I>" and "> 1 · higher
 * with <I>" for ratios (0 for differences). Never "favours": the result does not say whether lower is better (a harm or
 * exposure question reads the other way), so the label claims nothing about benefit. Correlations have no arms: null.
 */
export function armLabels(family: Family, intervention: string | null | undefined, lang: Lang): [string, string] | null {
  if (family === "correlation") return null;
  const at = family === "ratio" ? "1" : "0";
  const raw = (intervention ?? "").trim();
  const name = raw ? clampLabel(raw, 28, 1).text : null;
  if (lang === "en") {
    const arm = name ? `with ${name}` : "in the treated/exposed group";
    return [`< ${at} · lower ${arm}`, `> ${at} · higher ${arm}`];
  }
  // Thai sets a space before a Latin word; a Thai name joins the word before it
  const arm = name ? `กลุ่ม${/^[฀-๿]/.test(name) ? "" : " "}${name}` : "กลุ่มที่ได้รับการรักษา/สัมผัส";
  return [`< ${at} · ต่ำกว่าใน${arm}`, `> ${at} · สูงกว่าใน${arm}`];
}

/** A review about themes: qualitative or mixed-methods studies are at least half of the papers read. */
export function themesReview(papers: Paper[]): boolean {
  let themes = 0;
  let quant = 0;
  for (const p of papers) {
    const card = p.card_en ?? p.card;
    if (!card) continue;
    if (isNonQuantitative(card)) themes += 1;
    else quant += 1;
  }
  return themes > 0 && themes >= quant;
}

// --- Diagnostic accuracy (Plan 20 Task 5) ------------------------------------------------------------------------------
// Sensitivity, specificity and AUC as each paper reported them (verified, or a gap when blanked). Nothing is derived:
// no PPV/NPV, no pooled sensitivity, no conversion of a printed number.

export type DtaMetric = "sens" | "spec" | "auc";

const DTA_PATTERNS: Record<DtaMetric, RegExp> = {
  sens: /\bsensitivity\b|\btrue[- ]positive rate\b/i,
  spec: /\bspecificity\b|\btrue[- ]negative rate\b/i,
  auc: /\bAUC\b|\bAUROC\b|\barea under\b|\bc-statistic\b/i,
};
/** A sensitivity of something else (insulin, contrast, salt …) is a physiological measure, not test accuracy. */
const QUALIFIED = /\b(insulin|contrast|salt|baroreflex|leptin|glucose|chemo|radio|drug|antibiotic|antimicrobial|heat|cold|light|pain|noise|reward|anxiety|interoceptive|visceral|skin|tissue|cultural|gluten|food|pressure)[- ]sensitivity/i;

/** The diagnostic-accuracy metric an outcome name names, or null (none, a combined name, a sensitivity analysis, a qualified sensitivity). */
export function dtaMetric(outcome: string): DtaMetric | null {
  if (/sensitivity analys/i.test(outcome) || QUALIFIED.test(outcome)) return null;
  const hits = (Object.keys(DTA_PATTERNS) as DtaMetric[]).filter((m) => DTA_PATTERNS[m].test(outcome));
  return hits.length === 1 ? hits[0] : null;
}

const PAIR = /\b(sensitivity|specificity)\s+and\s+(sensitivity|specificity)\b\s*(?:were|was|of|=|:)?\s*/gi;
const NUM = String.raw`(\d+(?:\.\d+)?)\s*%?`;
const TWO = new RegExp(String.raw`^${NUM}\s*,?\s*and\s+${NUM}(?!\s*,?\s*(?:and\s+)?\d)`, "i");

/**
 * Fix round 2: "Sensitivity and specificity were X and Y" (two labels, then two numbers in the same order, intervals in
 * brackets skipped). Returns the label of `value` when it is exactly one of the two numbers; "ambiguous" when such a
 * phrase is there but cannot be resolved (part of a longer list of three or more, more than two numbers, both numbers
 * equal), so no single label before the number is trusted either; null when the quote has no such phrase.
 */
function pairedLabel(quote: string, value: number): DtaMetric | "ambiguous" | null {
  let found = false;
  for (const m of quote.matchAll(PAIR)) {
    const [whole, a, b] = m;
    if (a.toLowerCase() === b.toLowerCase()) continue;
    found = true;
    // a list such as "accuracy, sensitivity and specificity" pairs three labels with three numbers: leave it out
    if (/,\s*$/.test(quote.slice(0, m.index ?? 0))) continue;
    const after = quote.slice((m.index ?? 0) + whole.length).replace(/\s*\([^)]*\)/g, "");
    const two = TWO.exec(after);
    if (!two) continue;
    const x = Number(two[1]);
    const y = Number(two[2]);
    if (x === y) continue;
    const same = (n: number) => Math.abs(n - value) <= Math.max(1e-9, Math.abs(value) * 0.005);
    const label = (s: string): DtaMetric => (s.toLowerCase() === "sensitivity" ? "sens" : "spec");
    if (same(x)) return label(a);
    if (same(y)) return label(b);
  }
  return found ? "ambiguous" : null;
}

/** The DTA word the paper writes last before `at` in its quote (its own label for the number), or null. */
function quoteLabel(quote: string, at: number): DtaMetric | null {
  const before = quote.slice(Math.max(0, at - 60), at);
  let best: { m: DtaMetric; i: number } | null = null;
  for (const m of Object.keys(DTA_PATTERNS) as DtaMetric[]) {
    const re = new RegExp(DTA_PATTERNS[m].source, "gi");
    for (const hit of before.matchAll(re)) if (!best || (hit.index ?? 0) > best.i) best = { m, i: hit.index ?? 0 };
  }
  if (!best) return null;
  const tail = before.slice(Math.max(0, best.i - 20));
  return QUALIFIED.test(tail) || /sensitivity analys/i.test(before.slice(best.i)) ? null : best.m;
}

/**
 * The DTA metric of one outcome (Plan 20 Task 5 fix round 1). The result has no metric field: the engine stores test
 * accuracy as `effect_measure: "other"` (docs/api.md), so that measure is required (an HR, MD … or "none" never is);
 * the metric must then be named by the outcome and, for a number, by the paper's own label right before the number in
 * its quote, and the two must agree.
 */
export function dtaMetricOf(o: OutcomeResult): DtaMetric | null {
  if ((o.effect_measure ?? "").trim().toLowerCase() !== "other") return null;
  const named = dtaMetric(o.outcome);
  if (!named || o.effect_value == null) return named && o.effect_value == null ? named : null;
  const hit = findReported(o.effect_value, o.evidence_quote, { lo: o.ci_lower, hi: o.ci_upper });
  if (!hit || !o.evidence_quote) return null;
  const paired = pairedLabel(o.evidence_quote, o.effect_value);
  if (paired === "ambiguous") return null;
  const label = paired ?? quoteLabel(o.evidence_quote, hit.index);
  return label === named ? named : null;
}

export type DtaValue =
  | {
    kind: "verified"; outcomeKey: string; outcome: string;
    /** as the paper wrote it ("97.4", "0.79"); `percent` = written as a percentage (the "%" is a unit, set apart) */
    text: string; percent: boolean; ci: string | null;
    /** plot positions on a 0–100 axis (a position, never shown as a number) */
    pos: number; lo: number | null; hi: number | null;
  }
  | { kind: "blanked"; outcomeKey: string; outcome: string };

export interface DtaStudy {
  ref: string;
  label: string;
  title: string;
  review: boolean;
  sens: DtaValue[];
  spec: DtaValue[];
  auc: DtaValue[];
  n: { kind: "value"; text: string } | { kind: "blanked" } | { kind: "none" };
}

export interface DtaData {
  studies: DtaStudy[];
  has: Record<DtaMetric, boolean>;
}

/** Studies that report sensitivity, specificity or AUC (qualitative cards and other comparisons never do), or null. */
export function dtaData(papers: Paper[], lang: Lang): DtaData | null {
  const studies: DtaStudy[] = [];
  for (const p of papers) {
    const en = p.card_en ?? p.card;
    const shown = (lang === "en" ? p.card_en : p.card) ?? en;
    if (!en || !shown || isNonQuantitative(en)) continue;
    const values: Record<DtaMetric, DtaValue[]> = { sens: [], spec: [], auc: [] };
    en.outcomes.forEach((o, i) => {
      // a blanked value has no trusted number to locate in its quote: the measure and the name decide (it shows as a gap)
      const blanked = isBlankedEffect(p, o.outcome);
      const metric = blanked ? dtaMetricOf({ ...o, effect_value: null }) : dtaMetricOf(o);
      if (!metric || o.matches_question === false) return;
      const outcome = shown.outcomes[i]?.outcome ?? o.outcome;
      if (blanked) {
        values[metric].push({ kind: "blanked", outcomeKey: o.outcome, outcome });
        return;
      }
      if (!isVerifiedEffect(p, o)) return;
      const v = o.effect_value as number;
      if (v < 0 || v > 100) return;
      const percent = v > 1;
      const at = (x: number | null | undefined) => (x == null ? null : percent ? x : x * 100);
      values[metric].push({
        kind: "verified", outcomeKey: o.outcome, outcome, text: asReported(v, o.evidence_quote), percent, ci: ciLabel(o),
        pos: at(v) as number, lo: at(o.ci_lower), hi: at(o.ci_upper),
      });
    });
    if (!values.sens.length && !values.spec.length && !values.auc.length) continue;
    const sample = en.sample_size;
    studies.push({
      ref: p.ref, label: studyLabel(p), title: p.title, review: isPooled(p), ...values,
      n: isBlankedSampleSize(p) ? { kind: "blanked" } : sample != null ? { kind: "value", text: asReported(sample, en.sample_size_quote) } : { kind: "none" },
    });
  }
  if (!studies.length) return null;
  const has = (m: DtaMetric) => studies.some((s) => s[m].length > 0);
  return { studies, has: { sens: has("sens"), spec: has("spec"), auc: has("auc") } };
}

export interface ForestRow {
  ref: string;
  outcome: string;
  outcomeKey: string;
  label: string;
  measure: string;
  value: number;
  lo: number | null;
  hi: number | null;
  direction: Direction;
  valueText: string;
  ciText: string | null;
}

export interface ForestGroup {
  family: Family;
  measures: string[];
  rows: ForestRow[];
}

export interface ForestData {
  groups: ForestGroup[];
  unverified: { ref: string; outcome: string }[];
}

/** One row per verified paper × outcome effect, grouped so each group shares one axis (ratio: log around 1). */
export function forestData(papers: Paper[], lang: Lang): ForestData {
  const groups = new Map<Family, ForestGroup>();
  const unverified: ForestData["unverified"] = [];
  for (const p of papers) {
    const en = p.card_en ?? p.card;
    const shown = (lang === "en" ? p.card_en : p.card) ?? en;
    // qualitative/mixed-methods cards are themes: never a forest row, even if a number slipped through
    if (!en || !shown || isNonQuantitative(en)) continue;
    en.outcomes.forEach((o, i) => {
      if (o.matches_question === false) return; // another comparison: on the card only, never a forest row
      if (isBlankedEffect(p, o.outcome)) {
        unverified.push({ ref: p.ref, outcome: shown.outcomes[i]?.outcome ?? o.outcome });
        return;
      }
      const family = FAMILY[o.effect_measure ?? ""];
      if (!family || !isVerifiedEffect(p, o)) return;
      const value = o.effect_value as number;
      if (family === "ratio" && (value <= 0 || (o.ci_lower != null && o.ci_lower <= 0))) return;
      const g = groups.get(family) ?? { family, measures: [], rows: [] };
      if (!g.measures.includes(o.effect_measure as string)) g.measures.push(o.effect_measure as string);
      const outcomeName = shown.outcomes[i]?.outcome ?? o.outcome;
      g.rows.push({
        ref: p.ref, outcome: outcomeName, outcomeKey: o.outcome, label: `${p.ref} · ${outcomeName}`,
        measure: o.effect_measure as string, value, lo: o.ci_lower ?? null, hi: o.ci_upper ?? null, direction: o.direction,
        valueText: effectLabel(o), ciText: ciLabel(o),
      });
      groups.set(family, g);
    });
  }
  const order: Family[] = ["ratio", "difference", "correlation"];
  return { groups: order.filter((f) => groups.has(f)).map((f) => groups.get(f)!), unverified };
}

/** Axis bounds that contain every point and interval plus the null value (1 for ratios, 0 otherwise). */
export function forestAxis(g: ForestGroup): [number, number] {
  const nullValue = g.family === "ratio" ? 1 : 0;
  const values = g.rows.flatMap((r) => [r.value, r.lo ?? r.value, r.hi ?? r.value]).concat(nullValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (g.family === "ratio") return [min / 1.15, max * 1.15];
  const pad = (max - min || 1) * 0.1;
  return [min - pad, max + pad];
}

/** Thai/English labels for the screening exclusion reasons (ExclusionReason); the PRISMA flow (prisma-flow.ts) uses them. */
export const EXCLUSION_REASON_LABEL: Record<ExclusionReason, { th: string; en: string }> = {
  off_topic: { th: "ไม่เกี่ยวกับหัวข้อ", en: "Off topic" },
  population: { th: "กลุ่มประชากรไม่ตรง", en: "Population does not match" },
  intervention_exposure: { th: "การรักษาหรือปัจจัยที่ศึกษาไม่ตรง", en: "Intervention or exposure does not match" },
  outcome: { th: "ผลลัพธ์ไม่ตรง", en: "Outcome does not match" },
  study_design: { th: "รูปแบบการศึกษาไม่ตรงเกณฑ์", en: "Study design does not match" },
  publication_type: { th: "ชนิดสิ่งตีพิมพ์ไม่ตรง (เช่น บทบรรณาธิการ)", en: "Publication type does not match (e.g. editorial)" },
  other: { th: "เหตุผลอื่น", en: "Other reason" },
};

export interface StudyPoint {
  ref: string;
  title: string;
  year: number;
  n: number;
  nText: string;
  direction: Direction;
  design: string;
}

/**
 * Studies with a publication year and a verified sample size (a blanked sample size is null and is not plotted).
 * Qualitative/mixed-methods studies are left out: the map colours points by effect direction, which they never have.
 */
export function studyPoints(papers: Paper[]): { points: StudyPoint[]; missing: number } {
  const points: StudyPoint[] = [];
  let missing = 0;
  for (const p of papers) {
    const card = p.card_en ?? p.card;
    if (isNonQuantitative(card)) continue;
    if (!card || p.year == null || card.sample_size == null || card.sample_size <= 0) {
      missing += 1;
      continue;
    }
    points.push({
      ref: p.ref, title: p.title, year: p.year, n: card.sample_size,
      nText: asReported(card.sample_size, card.sample_size_quote), direction: questionDirection(card), design: card.study_design,
    });
  }
  return { points, missing };
}
