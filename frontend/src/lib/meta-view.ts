// View model of the pooled analysis (Plan 14b, result.meta_analysis). Pure, no React.
// The pooled values were computed by the backend (meta.py, DerSimonian-Laird); this file only formats them (2 decimals for
// estimates and CI bounds, I² as a whole percent, τ² at 3 decimals, the same rounding the narrative prompt saw) and
// never computes a new number. Study inputs keep the paper's own spelling (asReported), since those were verified.
import { asReported } from "./evidence";
import { DESIGN_LABEL, type Lang } from "./i18n";
import type { ComparisonRow, DesignCategory, Direction, MetaAnalysis, Paper, Pool, PoolExcluded, PoolMeasure } from "./types";

type Bi = { th: string; en: string };

/** Thai/English text for every warning and exclusion-reason code of result.meta_analysis (one map for both). */
export const META_CODE_LABEL: Record<string, Bi> = {
  // warnings (per pool)
  abstract_only: { th: "ใช้ตัวเลขจากบทคัดย่อเท่านั้น ไม่ได้อ่านบทความฉบับเต็ม", en: "Numbers come from the abstracts only, not the full texts" },
  ci_assumed_95: { th: "ถือว่าช่วงความเชื่อมั่นทุกค่าเป็นแบบ 95%", en: "Every confidence interval is taken to be a 95% interval" },
  adjustment_unknown: {
    th: "บทคัดย่อไม่บอกชัดว่าค่าใดปรับปัจจัยกวนแล้ว ค่ารวมจึงอาจปนค่าที่ปรับและไม่ปรับ",
    en: "Abstracts do not show which estimates were adjusted, so adjusted and unadjusted values may be mixed",
  },
  small_k: { th: "มีงานวิจัยน้อยกว่า 5 ฉบับ ค่ารวมและค่าความแตกต่างระหว่างงานจึงไม่แม่นยำ", en: "Fewer than 5 studies, so the pooled value and the heterogeneity are imprecise" },
  high_heterogeneity: {
    th: "งานวิจัยให้ผลต่างกันมาก (I² ตั้งแต่ 50%) ค่ารวมค่าเดียวอาจไม่แทนทุกงาน",
    en: "Studies differ substantially (I² of 50% or more); one pooled value may not represent them all",
  },
  md_units_assumed_equal: { th: "ถือว่าผลต่างค่าเฉลี่ย (MD) ของทุกงานใช้หน่วยเดียวกัน", en: "Mean differences are taken to share one unit" },
  other_measures_not_pooled: {
    th: "บางงานรายงานผลลัพธ์นี้ด้วยตัววัดอื่น ซึ่งไม่ได้นำมารวมในชุดนี้",
    en: "Some studies report this outcome with another measure, which is not pooled here",
  },
  duplicate_cohort_skipped: {
    th: "ข้ามงานที่น่าจะใช้กลุ่มตัวอย่างเดียวกับอีกงาน (ผู้แต่งคนแรก ปี และจำนวนตรงกัน)",
    en: "A study that seems to share its cohort with another (same first author, year and n) was skipped",
  },
  // exclusion reasons (per study and outcome)
  design_not_poolable: { th: "รูปแบบการศึกษาที่ไม่นำมารวม เช่น รายงานกลุ่มผู้ป่วย บทความทบทวน", en: "Study design that is not pooled, e.g. case series or narrative review" },
  measure_not_poolable: { th: "ตัววัดผลที่ไม่นำมารวม เช่น สหสัมพันธ์ หรือไม่มีตัววัด", en: "Effect measure that is not pooled, e.g. a correlation or none" },
  missing_numbers: { th: "ไม่มีขนาดผลพร้อมช่วงความเชื่อมั่นครบสองข้างที่ตรวจผ่าน", en: "No verified effect with both confidence limits" },
  invalid_numbers: { th: "อ่านตัวเลขเป็นค่าไม่ได้", en: "The numbers could not be read as values" },
  non_positive_ratio: { th: "ค่าอัตราส่วนเป็นศูนย์หรือติดลบ ซึ่งเป็นไปไม่ได้", en: "A ratio of zero or below, which is impossible" },
  invalid_ci: { th: "ขอบล่างของช่วงความเชื่อมั่นไม่ต่ำกว่าขอบบน", en: "The lower confidence limit is not below the upper one" },
  effect_outside_ci: { th: "ขนาดผลอยู่นอกช่วงความเชื่อมั่นของตัวเอง", en: "The effect lies outside its own confidence interval" },
  duplicate_study: { th: "งานเดียวกันซ้ำในผลลัพธ์เดียวกัน จึงนับครั้งเดียว", en: "The same study appears twice for this outcome, so it counts once" },
  duplicate_cohort: { th: "น่าจะใช้กลุ่มตัวอย่างเดียวกับอีกงานหนึ่ง", en: "Seems to share its cohort with another study" },
  too_few_studies: { th: "งานที่วัดผลแบบเดียวกันมีไม่ถึง 3 ฉบับ จึงไม่คำนวณค่ารวม", en: "Fewer than 3 studies measured it the same way, so nothing was pooled" },
};

/** Warnings every pool carries (method limits): shown once for the section, not repeated per pool. */
export const GENERAL_WARNINGS = ["abstract_only", "ci_assumed_95", "adjustment_unknown"] as const;

export function metaCodeLabel(code: string, lang: Lang): string {
  return META_CODE_LABEL[code]?.[lang] ?? code;
}

export const DESIGN_GROUP_LABEL: Record<string, Bi> = {
  rct: { th: "RCT", en: "RCTs" },
  observational: { th: "งานเชิงสังเกต", en: "observational studies" },
};

const RATIO = new Set<string>(["HR", "OR", "RR"]);

/** Fixed decimals without a "-0.00". */
export function fixed(n: number, decimals: number): string {
  const s = n.toFixed(decimals);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

export function pText(p: number): string {
  return p < 0.001 ? "< 0.001" : fixed(p, 3);
}

export interface MetaStudyView {
  ref: string;
  label: string; // "P3 · 2020"
  outcomeKey: string | null; // the paper's own (English) outcome name, to open its quote in the rail
  effect: number;
  lo: number;
  hi: number;
  weight: number;
  direction: Direction;
  effectText: string; // as the paper wrote it
  ciText: string; // as the paper wrote it, "lo–hi"
  seText: string; // computed, analysis scale
  weightText: string; // computed, percent
}

export interface MetaPoolView {
  key: string;
  outcome: string; // shown name (review language, or English when the reader switched)
  measure: PoolMeasure;
  ratio: boolean;
  groupLabel: string;
  k: number;
  est: number;
  lo: number;
  hi: number;
  estText: string;
  ciText: string;
  i2Text: string;
  tau2Text: string;
  qText: string;
  df: number;
  pText: string;
  nullValue: number;
  axis: [number, number];
  studies: MetaStudyView[];
  warnings: { code: string; label: string }[]; // pool-specific (GENERAL_WARNINGS left out)
  method: string;
  version: string;
}

export interface ExcludedGroup {
  reason: string;
  label: string;
  count: number;
  items: { outcome: string; refs: string[] }[];
}

export interface ReferenceView {
  ref: string;
  outcome: string;
  design: string | null;
  measure: string | null;
  outcomeKey: string | null;
  effectText: string | null; // null: the review has no verified number for it
  ciText: string | null;
}

export interface MetaView {
  pools: MetaPoolView[];
  general: { code: string; label: string }[];
  excluded: ExcludedGroup[];
  reference: ReferenceView[];
  grade: string[];
  version: string;
}

const near = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 0.005);

/** The paper outcome a pool cell came from: same measure, same effect and interval (English card, then the shown one). */
function sourceOutcome(paper: Paper | undefined, measure: string | null, effect: number | null, lo: number | null, hi: number | null) {
  const card = paper?.card_en ?? paper?.card;
  if (!card || effect == null) return null;
  const sameMeasure = card.outcomes.filter((o) => measure == null || o.effect_measure === measure);
  // Exact values first (the pool copies the card's numbers), so two near-equal effects never open the wrong quote;
  // the tolerance only catches float noise.
  const exact = sameMeasure.filter((o) => o.effect_value === effect);
  const exactCi = exact.find((o) => (lo == null || o.ci_lower === lo) && (hi == null || o.ci_upper === hi));
  if (exactCi) return exactCi;
  const hits = exact.length ? exact : sameMeasure.filter((o) => near(o.effect_value, effect));
  return hits.find((o) => (lo == null || near(o.ci_lower, lo)) && (hi == null || near(o.ci_upper, hi))) ?? hits[0] ?? null;
}

function shownOutcome(item: { outcome: string; outcome_display?: string | null }, english: boolean): string {
  return english ? item.outcome : item.outcome_display || item.outcome;
}

/** Axis bounds containing every study interval, the pooled interval and the null value (1 for ratios, 0 otherwise). */
export function metaAxis(pool: Pick<Pool, "measure" | "studies" | "pooled">): [number, number] {
  const ratio = RATIO.has(pool.measure);
  const values = pool.studies.flatMap((s) => [s.effect, s.ci_lower, s.ci_upper])
    .concat([pool.pooled.est, pool.pooled.ci_lower, pool.pooled.ci_upper, ratio ? 1 : 0]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (ratio) return [min / 1.15, max * 1.15];
  const pad = (max - min || 1) * 0.1;
  return [min - pad, max + pad];
}

/**
 * GRADE-lite downgrade reasons (backend English text from grade.apply_meta_grade) in the reader's language. Known
 * patterns are translated; anything else is shown as the backend wrote it.
 */
export function gradeReasonText(reason: string, lang: Lang, outcome: string, group: string | null): string {
  if (lang === "en") return reason;
  const m = /^(inconsistency|imprecision)( \(pooled analysis, already downgraded\))?: /.exec(reason);
  if (!m) return reason;
  const what = `${outcome}${group ? ` (${DESIGN_GROUP_LABEL[group]?.th ?? group}) ` : " "}`;
  const again = m[2] ? " (ลดระดับในด้านนี้ไปแล้ว จึงไม่ลดซ้ำ)" : "";
  return m[1] === "inconsistency"
    ? `ความไม่สอดคล้อง: งานวิจัยในค่ารวมของ${what}ให้ผลต่างกันมาก (I² ตั้งแต่ 50%)${again}`
    : `ความไม่แม่นยำ: ช่วงความเชื่อมั่น 95% ของค่ารวมของ${what}ครอบคลุมค่าที่แปลว่าไม่มีผล${again}`;
}

/**
 * Everything the meta-analysis section shows. `rows` are the English comparison rows (pool.outcome is an English
 * matrix row name), used for each study's direction glyph. `english` shows English outcome names (reader switched a
 * Thai review to English).
 */
export function metaView(meta: MetaAnalysis, papers: Paper[], rows: ComparisonRow[], lang: Lang, english = lang === "en"): MetaView {
  const byRef = new Map(papers.map((p) => [p.ref, p]));
  const general = GENERAL_WARNINGS.filter((c) => meta.pools.some((p) => p.warnings.includes(c)))
    .map((code) => ({ code, label: metaCodeLabel(code, lang) }));
  const pools = meta.pools.map((pool, i): MetaPoolView => {
    const ratio = RATIO.has(pool.measure);
    const row = rows.find((r) => r.outcome === pool.outcome);
    const studies = pool.studies.map((s): MetaStudyView => {
      const paper = byRef.get(s.ref);
      const o = sourceOutcome(paper, pool.measure, s.effect, s.ci_lower, s.ci_upper);
      const q = o?.evidence_quote;
      const direction = row?.cells.find((c) => c.ref === s.ref)?.direction ?? o?.direction ?? "unclear";
      return {
        ref: s.ref, label: paper?.year ? `${s.ref} · ${paper.year}` : s.ref, outcomeKey: o?.outcome ?? null,
        effect: s.effect, lo: s.ci_lower, hi: s.ci_upper, weight: s.weight, direction,
        effectText: asReported(s.effect, q), ciText: `${asReported(s.ci_lower, q)}–${asReported(s.ci_upper, q)}`,
        seText: fixed(s.se, 3), weightText: `${fixed(s.weight, 1)}%`,
      };
    });
    return {
      key: `${pool.outcome}|${pool.design_group}|${pool.measure}|${i}`, outcome: shownOutcome(pool, english), measure: pool.measure, ratio,
      groupLabel: DESIGN_GROUP_LABEL[pool.design_group]?.[lang] ?? pool.design_group, k: pool.k,
      est: pool.pooled.est, lo: pool.pooled.ci_lower, hi: pool.pooled.ci_upper,
      estText: fixed(pool.pooled.est, 2), ciText: `${fixed(pool.pooled.ci_lower, 2)}–${fixed(pool.pooled.ci_upper, 2)}`,
      i2Text: `${Math.round(pool.i2)}%`, tau2Text: fixed(pool.tau2, 3), qText: fixed(pool.q, 2), df: pool.df, pText: pText(pool.p_het),
      nullValue: ratio ? 1 : 0, axis: metaAxis(pool), studies,
      warnings: pool.warnings.filter((c) => !(GENERAL_WARNINGS as readonly string[]).includes(c))
        .map((code) => ({ code, label: metaCodeLabel(code, lang) })),
      method: pool.method, version: pool.version,
    };
  });
  return {
    pools, general, excluded: excludedGroups(meta.excluded, lang, english),
    reference: meta.reference.map((r): ReferenceView => {
      const o = sourceOutcome(byRef.get(r.ref), r.measure, r.effect, r.ci_lower, r.ci_upper);
      const q = o?.evidence_quote;
      const has = r.effect != null;
      return {
        ref: r.ref, outcome: shownOutcome(r, english), measure: r.measure, outcomeKey: o?.outcome ?? null,
        design: r.design_category ? DESIGN_LABEL[lang][r.design_category as DesignCategory] ?? r.design_category : null,
        effectText: has ? asReported(r.effect as number, q) : null,
        ciText: has && r.ci_lower != null && r.ci_upper != null ? `${asReported(r.ci_lower, q)}–${asReported(r.ci_upper, q)}` : null,
      };
    }),
    grade: gradeReasons(meta, lang, english),
    version: meta.version,
  };
}

function gradeReasons(meta: MetaAnalysis, lang: Lang, english: boolean): string[] {
  const g = meta.grade;
  if (!g?.reasons?.length) return [];
  const pool = meta.pools.find((p) => p.outcome === g.primary_outcome);
  const outcome = pool ? shownOutcome(pool, english) : g.primary_outcome ?? "";
  return g.reasons.map((r) => gradeReasonText(r, lang, outcome, g.design_group ?? null));
}

/** Exclusions summarised by reason (in the label map's order), then by outcome: a count and the refs, not one line per cell. */
export function excludedGroups(excluded: PoolExcluded[], lang: Lang, english = lang === "en"): ExcludedGroup[] {
  const order = Object.keys(META_CODE_LABEL);
  const byReason = new Map<string, PoolExcluded[]>();
  for (const e of excluded) byReason.set(e.reason, [...(byReason.get(e.reason) ?? []), e]);
  return [...byReason.entries()]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1))
    .map(([reason, list]) => {
      const items: ExcludedGroup["items"] = [];
      for (const e of list) {
        const outcome = shownOutcome(e, english);
        const item = items.find((x) => x.outcome === outcome) ?? (items.push({ outcome, refs: [] }), items[items.length - 1]);
        if (!item.refs.includes(e.ref)) item.refs.push(e.ref);
      }
      return { reason, label: metaCodeLabel(reason, lang), count: list.length, items };
    });
}
