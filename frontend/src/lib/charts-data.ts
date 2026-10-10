// Chart data built only from verified values. Nothing here estimates, converts or recomputes a number from a paper.
import { asReported, ciLabel, effectLabel, isBlankedEffect, isVerifiedEffect } from "./evidence";
import { DESIGN_LABEL, type Lang } from "./i18n";
import type { DesignCategory, Direction, ExclusionReason, Paper, PaperCard, RiskOfBias, Stats } from "./types";

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

/** Papers that have a card, counted by the card's overall direction. A count of papers, not a number from a paper.
 * `skipReviews` leaves narrative-review articles out (they restate other studies; the matrix and map skip them too).
 * Qualitative and mixed-methods studies are never counted (they report themes, not a direction). */
export function directionTally(papers: Paper[], skipReviews = false): Record<Direction, number> {
  const tally: Record<Direction, number> = { positive: 0, negative: 0, null: 0, mixed: 0, unclear: 0 };
  for (const p of papers) {
    const card = p.card_en ?? p.card;
    if (skipReviews && card?.design_category === "narrative_review") continue;
    if (isNonQuantitative(card)) continue;
    if (card && card.overall_direction in tally) tally[card.overall_direction] += 1;
  }
  return tally;
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

export interface Stage {
  key: keyof Stats;
  label: string;
  value: number;
}

const STAGE_LABEL: Record<string, [string, string]> = {
  found: ["ค้นเจอ (ก่อนตัดซ้ำ)", "Records found"],
  unique: ["หลังตัดซ้ำ", "After de-duplication"],
  screened: ["คัดกรอง", "Screened"],
  with_abstract: ["มีบทคัดย่อ", "With an abstract"],
  selected: ["เลือกวิเคราะห์", "Selected for analysis"],
  with_fulltext: ["ได้ฉบับเต็ม", "Full text obtained"], // legacy results only
  extracted: ["สกัดข้อมูลได้", "Data extracted"],
};

export function prismaStages(stats: Stats | undefined, lang: Lang): Stage[] {
  if (!stats) return [];
  return (["found", "unique", "with_abstract", "screened", "selected", "with_fulltext", "extracted"] as const)
    .filter((k) => typeof stats[k] === "number")
    .map((k) => ({ key: k, label: STAGE_LABEL[k][lang === "th" ? 0 : 1], value: stats[k] as number }));
}

/** Thai/English labels for the screening exclusion reasons (ExclusionReason). */
export const EXCLUSION_REASON_LABEL: Record<ExclusionReason, { th: string; en: string }> = {
  off_topic: { th: "ไม่เกี่ยวกับหัวข้อ", en: "Off topic" },
  population: { th: "กลุ่มประชากรไม่ตรง", en: "Population does not match" },
  intervention_exposure: { th: "การรักษาหรือปัจจัยที่ศึกษาไม่ตรง", en: "Intervention or exposure does not match" },
  outcome: { th: "ผลลัพธ์ไม่ตรง", en: "Outcome does not match" },
  study_design: { th: "รูปแบบการศึกษาไม่ตรงเกณฑ์", en: "Study design does not match" },
  publication_type: { th: "ชนิดสิ่งตีพิมพ์ไม่ตรง (เช่น บทบรรณาธิการ)", en: "Publication type does not match (e.g. editorial)" },
  other: { th: "เหตุผลอื่น", en: "Other reason" },
};

const REASON_ORDER = Object.keys(EXCLUSION_REASON_LABEL) as ExclusionReason[];

export interface ExclusionRow {
  key: string;
  label: string;
  value: number;
}

/**
 * The "why records were left out" rows for the PRISMA figure. Null when the result carries none of the data
 * (older results). Counts are exactly what the result recorded: technical screening failures are deliberately
 * not counted, so no remainder or "other" total is derived here.
 */
export function exclusionRows(stats: Stats | undefined, lang: Lang): { reasons: ExclusionRow[]; extra: ExclusionRow[] } | null {
  if (!stats) return null;
  const reasons = REASON_ORDER
    .filter((k) => (stats.excluded_screening?.[k] ?? 0) > 0)
    .map((k) => ({ key: k, label: EXCLUSION_REASON_LABEL[k][lang], value: stats.excluded_screening![k] as number }));
  const extra: ExclusionRow[] = [];
  const add = (key: string, th: string, en: string, value: number | undefined) => {
    if (typeof value === "number" && value > 0) extra.push({ key, label: lang === "th" ? th : en, value });
  };
  add("year_excluded", "ตีพิมพ์ก่อนปีที่กำหนด", "Published before the start year", stats.year_excluded);
  add("non_research", "ไม่ใช่งานวิจัย", "Not research", stats.non_research);
  add("no_abstract", "ไม่มีบทคัดย่อที่ใช้ได้", "No usable abstract", stats.no_abstract);
  add("low_relevance", "คะแนนความเกี่ยวข้องต่ำ", "Low relevance score", stats.excluded_selection?.low_relevance);
  add("over_limit", "เกินจำนวนที่วิเคราะห์", "Over the analysis limit", stats.excluded_selection?.over_limit);
  add("narrative_excluded", "บทความทบทวนแบบไม่เป็นระบบ", "Narrative reviews", stats.excluded_selection?.narrative_excluded);
  return reasons.length || extra.length ? { reasons, extra } : null;
}

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
      nText: asReported(card.sample_size, card.sample_size_quote), direction: card.overall_direction, design: card.study_design,
    });
  }
  return { points, missing };
}
