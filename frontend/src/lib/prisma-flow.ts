// Plan 20 Task 4: the study selection flow (PRISMA 2020, or PRISMA-ScR for scoping reviews) as ruled boxes. Pure data,
// no React. Every count comes from result.stats (docs/api.md "Stats" is the contract) or result.methods.sources. A key
// the result does not carry is null ("unknown"); the only differences taken are of two recorded counts that the
// contract defines (duplicates = found - unique; below the relevance cap = with_abstract - candidates). Counts are
// system counts: the component sets them in the display face, never the verified-number face.
import { EXCLUSION_REASON_LABEL } from "./charts-data";
import type { Lang } from "./i18n";
import { plural } from "./plural";
import { SOURCE_NAME } from "./report-view";
import type { ReviewTypeOrLegacy } from "./review-type";
import type { ExclusionReason, ReviewMethods, Stats } from "./types";

/** null: the result does not record this count. */
export type FlowCount = number | null;

export interface FlowLine {
  key: string;
  label: string;
  value: FlowCount;
  note?: string;
}

/** A ruled box. `value` undefined: the box has no headline count (it lists lines); null: the count is unknown. */
export interface FlowBox {
  key: string;
  title: string;
  value?: FlowCount;
  lines: FlowLine[];
  notes: string[];
  /** Plan 21: a note whose figures are counts (the requested N, a shortfall's E of N), set in the display face. */
  countNote?: string;
}

export type FlowStageKey = "identification" | "screening" | "selection" | "included";

export interface FlowStage {
  key: FlowStageKey;
  label: string;
  main: FlowBox;
  /** the records leaving the flow at this stage (PRISMA's right-hand box) */
  side: FlowBox | null;
}

export interface PrismaFlowView {
  framework: "PRISMA 2020" | "PRISMA-ScR";
  stages: FlowStage[];
}

export const UNKNOWN_COUNT: Record<Lang, string> = { th: "ไม่ทราบ", en: "unknown" };

const T = (lang: Lang, th: string, en: string) => (lang === "th" ? th : en);
const num = (v: unknown): FlowCount => (typeof v === "number" && Number.isFinite(v) ? v : null);
const diff = (a: FlowCount, b: FlowCount): FlowCount => (a != null && b != null && a >= b ? a - b : null);

/** Records per search source, in the order the methods list them; the meta-analysis RCT search stays its own row. */
export function sourceRows(sources: Record<string, number> | null | undefined, lang: Lang): { key: string; label: string; value: number }[] {
  return Object.entries(sources ?? {}).map(([key, value]) => {
    const m = /^(.*?)\s*\((.*)\)\s*$/.exec(key);
    const base = (m ? m[1] : key).trim().toLowerCase();
    if (base === "unknown") return { key, label: T(lang, "ไม่ระบุแหล่ง", "Source not named"), value };
    const name = SOURCE_NAME[base] ?? (m ? m[1] : key);
    const qualifier = m?.[2]?.trim().toLowerCase() === "rct search" ? T(lang, "ค้นเฉพาะ RCT", "RCT search") : m?.[2];
    return { key, label: qualifier ? `${name} (${qualifier})` : name, value };
  });
}

const REASON_ORDER = Object.keys(EXCLUSION_REASON_LABEL) as ExclusionReason[];

/** Plan 21: the paper counts the report states (Methods, PRISMA, Limitations), from one place so they never differ. */
export interface PaperCounts {
  /** N: the papers the user asked to have analysed */
  requested: number;
  /** S: records screened (title and abstract) */
  screened: FlowCount;
  /** E: papers that passed screening and selection (ranked for analysis) */
  eligible: FlowCount;
  /** A: papers analysed */
  analysed: FlowCount;
  /** set only when fewer than requested were analysed (A < N) because only E were eligible; never at A == N */
  shortfall: { eligible: number; requested: number } | null;
}

/**
 * The requested, screened, eligible and analysed counts, or null for a result from before Plan 21: without a recorded
 * `excluded_selection.requested` (absent or null) nothing new is said: neither `methods.limits.max_papers` nor
 * `options.max_papers` stands in for it, so no shortfall is ever inferred for an old report. `requested` and `eligible` are never exclusion counts.
 */
export function paperCounts(stats: Stats | null | undefined): PaperCounts | null {
  const sel = stats?.excluded_selection;
  const requested = num(sel?.requested);
  if (!stats || requested == null) return null;
  const eligible = num(sel?.eligible);
  // A = min(E, N): screening.py keeps `ranked[:max_papers]` as `selected`, so A < N exactly when E < N, and then A = E.
  // Methods' analysed count reads A (`selected`); the shortfall figures read E (`eligible`) and N (`requested`).
  const analysed = num(stats.selected);
  return {
    requested, screened: num(stats.screened), eligible, analysed,
    shortfall: analysed != null && eligible != null && analysed < requested ? { eligible, requested } : null,
  };
}

/** The PRISMA "included" note: the requested N, or on a shortfall "E eligible of N requested" (figures only). */
function requestedNote(c: PaperCounts, lang: Lang): string {
  return c.shortfall
    ? T(lang, `ผ่านเกณฑ์ ${c.shortfall.eligible} จากที่ขอ ${c.shortfall.requested}`, `${c.shortfall.eligible} eligible of ${c.shortfall.requested} requested`)
    : T(lang, `ขอ ${c.requested} ฉบับ`, `${c.requested} requested`);
}

/**
 * The flow for one result, or null when it has no stats. `options` is review.options (the requested caps), used only
 * where result.methods is absent.
 */
export function prismaFlow({ stats, methods, options, type, lang }: {
  stats: Stats | null | undefined; methods?: ReviewMethods | null; options?: Record<string, unknown> | null;
  type: ReviewTypeOrLegacy; lang: Lang;
}): PrismaFlowView | null {
  if (!stats) return null;
  const scoping = type === "scoping";
  const s = stats;
  const cap = num(methods?.limits.candidate_limit) ?? num(options?.candidate_limit);
  const maxPapers = num(methods?.limits.max_papers) ?? num(options?.max_papers);
  const minChars = num(methods?.limits.min_abstract_chars);
  const floor = num(methods?.screening.relevance_floor);
  const found = num(s.found);
  const withAbstract = num(s.with_abstract);
  const candidates = num(s.candidates);
  const screened = num(s.screened);
  const counts = paperCounts(stats);

  // --- Identification -------------------------------------------------------------------------------------------
  const sources = sourceRows(methods?.sources, lang);
  const identified: FlowBox = {
    key: "identified",
    title: T(lang, "ระเบียนที่ค้นพบจากฐานข้อมูล", "Records identified from databases"),
    value: found,
    lines: sources.map((r) => ({ key: `source:${r.key}`, label: r.label, value: r.value })),
    notes: sources.length
      ? [T(lang, "นับตามแหล่งก่อนตัดซ้ำ ระเบียนที่พบในหลายแหล่งนับทุกแหล่ง ผลรวมจึงอาจมากกว่าจำนวนที่ค้นพบ",
        "Per source, before de-duplication: a record found by several sources counts for each, so these can sum to more than the total")]
      : [],
  };
  const removed: FlowBox = {
    key: "removed_before",
    title: T(lang, "ระเบียนที่ตัดออกก่อนคัดกรอง", "Records removed before screening"),
    lines: [
      { key: "duplicates", label: T(lang, "ระเบียนซ้ำ", "Duplicates"), value: diff(found, num(s.unique)) },
      { key: "year_excluded", label: T(lang, "ตีพิมพ์ก่อนปีที่กำหนด", "Published before the start year"), value: num(s.year_excluded) },
      { key: "non_research", label: T(lang, "ไม่ใช่งานวิจัย", "Not research"), value: num(s.non_research) },
      { key: "no_abstract",
        label: minChars != null
          ? T(lang, `ไม่มีบทคัดย่อที่ใช้ได้ (สั้นกว่า ${minChars} ตัวอักษร)`, `No usable abstract (under ${minChars} characters)`)
          : T(lang, "ไม่มีบทคัดย่อที่ใช้ได้", "No usable abstract"),
        value: num(s.no_abstract) },
      { key: "below_cap", label: T(lang, "อยู่นอกอันดับความเกี่ยวข้องที่คัดกรอง", "Ranked below the relevance cap (not screened)"),
        value: diff(withAbstract, candidates) },
    ],
    notes: [],
  };

  // --- Screening ----------------------------------------------------------------------------------------------------
  // "top N" only from the recorded candidates; a requested cap alone is a limit, not an outcome
  const capNote = candidates != null
    ? T(lang,
      `เรียงตามความเกี่ยวข้อง คัดกรอง ${candidates} อันดับแรก${withAbstract != null ? ` จาก ${withAbstract} ระเบียนที่มีบทคัดย่อ` : ""}${cap != null ? ` (เพดาน ${cap})` : ""}`,
      `Ranked by relevance: the top ${candidates}${withAbstract != null ? ` of ${withAbstract} ${plural(withAbstract, "record", "records")} with an abstract` : ""} were screened${cap != null ? ` (cap ${cap})` : ""}`)
    : cap != null
      ? T(lang, `เรียงตามความเกี่ยวข้อง คัดกรองไม่เกิน ${cap} ระเบียน`, `Ranked by relevance: at most ${cap} were screened`)
      : null;
  const screenedBox: FlowBox = {
    key: "screened",
    title: T(lang, "ระเบียนที่คัดกรอง (ชื่อเรื่องและบทคัดย่อ)", "Records screened (title and abstract)"),
    value: screened,
    lines: candidates != null && screened != null && candidates !== screened
      ? [{ key: "candidates", label: T(lang, "ส่งเข้าคัดกรอง", "Sent to screening"), value: candidates }] : [],
    notes: capNote ? [capNote] : [],
  };
  const reasons = s.excluded_screening;
  const excludedScreening: FlowBox = {
    key: "excluded_screening",
    title: T(lang, "ระเบียนที่คัดออกตอนคัดกรอง", "Records excluded at screening"),
    lines: reasons == null
      ? [{ key: "reasons", label: T(lang, "เหตุผล", "Reasons"), value: null }]
      : REASON_ORDER.filter((k) => (reasons[k] ?? 0) > 0).map((k) => ({
        key: k, label: EXCLUSION_REASON_LABEL[k][lang], value: reasons[k] as number,
        ...(k === "study_design" ? { note: T(lang, "รวมระเบียนที่ตัดออกตอนคัดเลือกเพราะรูปแบบไม่ตรงชนิดที่เลือก",
          "includes records dropped at selection because their design matched no ticked type") } : {}),
      })),
    notes: reasons == null ? [] : [
      ...(REASON_ORDER.some((k) => (reasons[k] ?? 0) > 0) ? [] : [T(lang, "ไม่มีระเบียนที่บันทึกเหตุผลไว้", "No record has a recorded reason")]),
      T(lang, "ไม่ได้แจกแจง: นับเฉพาะระเบียนที่บันทึกเหตุผลไว้ ผลรวมจึงอาจน้อยกว่าจำนวนที่คัดออก",
        "Not itemised: only records with a recorded reason are counted, so the reasons can sum to less than the records excluded"),
    ],
  };

  // --- Selection ----------------------------------------------------------------------------------------------------
  const sel = s.excluded_selection;
  const relaxed = num(sel?.study_design_relaxed);
  const selectionBox: FlowBox = {
    key: "selection",
    title: T(lang, "ผ่านการคัดกรอง ตรวจตามเกณฑ์การคัดเลือก", "Included at screening, checked against the selection rules"),
    lines: [],
    notes: [T(lang, "ระบบไม่ได้บันทึกจำนวนที่ผ่านการคัดกรองแยกไว้", "The number included at screening is not recorded separately")],
  };
  const notAnalysed: FlowBox = {
    key: "excluded_selection",
    title: scoping ? T(lang, "แหล่งหลักฐานที่ไม่ได้นำมาวิเคราะห์", "Sources of evidence not analysed")
      : T(lang, "ระเบียนที่ไม่ได้นำมาวิเคราะห์", "Records not analysed"),
    lines: [
      { key: "low_relevance", value: num(sel?.low_relevance),
        label: floor != null ? T(lang, `คะแนนความเกี่ยวข้องต่ำกว่า ${floor}`, `Relevance score below ${floor}`)
          : T(lang, "คะแนนความเกี่ยวข้องต่ำ", "Low relevance score") },
      ...(sel?.off_focus != null ? [{ key: "off_focus", value: num(sel.off_focus),
        label: T(lang, "ไม่กล่าวถึงสิ่งที่ศึกษาของคำถาม", "Never names the question's focus") }] : []),
      { key: "narrative_excluded", value: num(sel?.narrative_excluded),
        label: T(lang, "บทความทบทวนแบบไม่เป็นระบบ", "Narrative reviews") },
      { key: "over_limit", value: num(sel?.over_limit),
        label: counts ? T(lang, `ผ่านเกณฑ์แต่เกินจำนวนที่กำหนด (${counts.requested} ฉบับ)`, `Eligible but beyond the requested ${counts.requested}`)
          : maxPapers != null ? T(lang, `เกินจำนวนที่วิเคราะห์ (สูงสุด ${maxPapers})`, `Over the analysis limit (at most ${maxPapers})`)
          : T(lang, "เกินจำนวนที่วิเคราะห์", "Over the analysis limit") },
      { key: "study_design_corrected", value: num(sel?.study_design_corrected),
        label: T(lang, "อ่านแล้วพบว่ารูปแบบไม่ตรงชนิดที่เลือก (คงไว้ในรายการ ไม่ใช้เป็นหลักฐาน นับอยู่ในรายงานที่รวม)",
          "Read as a design outside the ticked types (kept in the list, not used as evidence; counted in the reports included)") },
    ],
    notes: relaxed
      ? [T(lang, `คงไว้ ${relaxed} ระเบียนที่รูปแบบไม่ตรงชนิดที่เลือก เพราะงานที่ตรงมีไม่ถึง 3 ฉบับ (มีธงกำกับ)`,
        `${relaxed} ${plural(relaxed, "record whose design matched no ticked type was", "records whose design matched no ticked type were")} kept because fewer than 3 matched (flagged)`)]
      : [],
  };

  // --- Included -----------------------------------------------------------------------------------------------------
  // PRISMA 2020 counts studies and reports apart. `selected` counts reports (further reports of a trial stay in it), so
  // with `related_reports` recorded the studies are their difference; without it, only the reports are known.
  const related = num(s.related_reports);
  const selected = num(s.selected);
  const split = related != null && !scoping;
  const included: FlowBox = {
    key: "included",
    title: scoping ? T(lang, "แหล่งหลักฐานที่รวมในการทบทวน", "Sources of evidence included")
      : split ? T(lang, "การศึกษาที่รวมในการทบทวน", "Studies included in the review")
        : T(lang, "รายงานที่รวมในการทบทวน", "Reports included in the review"),
    value: split ? diff(selected, related) : selected,
    // "of which" sits directly under the count it is part of: the reports line (split) or the box's own count (scoping)
    lines: [
      ...(split ? [{ key: "reports_included", label: T(lang, "รายงานของการศึกษาที่รวม", "Reports of included studies"), value: selected }] : []),
      ...(related != null ? [{ key: "related_reports", value: related,
        label: scoping
          ? T(lang, "ในจำนวนนี้ เป็นรายงานเพิ่มเติมของแหล่งหลักฐานที่รวมแล้ว", "of which further reports of a source of evidence already included")
          : T(lang, "ในจำนวนนี้ เป็นรายงานเพิ่มเติมของการทดลองที่นับเป็นการศึกษาแล้ว", "of which further reports of a trial already counted as a study") }]
        : []),
      { key: "extracted", label: T(lang, "อ่านและสกัดข้อมูลได้", "Read and data extracted"), value: num(s.extracted) },
      ...(s.with_fulltext != null ? [{ key: "with_fulltext", label: T(lang, "ได้ฉบับเต็ม", "Full text obtained"), value: num(s.with_fulltext) }] : []),
    ],
    notes: [],
    ...(counts ? { countNote: requestedNote(counts, lang) } : {}),
  };

  return {
    framework: scoping ? "PRISMA-ScR" : "PRISMA 2020",
    stages: [
      { key: "identification", label: T(lang, "การระบุ", "Identification"), main: identified, side: removed },
      { key: "screening", label: T(lang, "การคัดกรอง", "Screening"), main: screenedBox, side: excludedScreening },
      { key: "selection", label: T(lang, "การคัดเลือก", "Selection"), main: selectionBox, side: notAnalysed },
      { key: "included", label: T(lang, "ที่รวมในการทบทวน", "Included"), main: included, side: null },
    ],
  };
}

export interface FlowRow {
  stage: string;
  /** 0: a box, 1: a line inside it */
  depth: 0 | 1;
  label: string;
  value: FlowCount | undefined;
  /** a line's own explanation */
  detail?: string;
  /** a box note (the cap, "not itemised", a relaxed count): text only, never a count */
  note?: true;
}

/** The flow as table rows (the accessible twin): each box, its lines, then its notes, stage by stage. */
export function flowRows(view: PrismaFlowView): FlowRow[] {
  const out: FlowRow[] = [];
  for (const st of view.stages) {
    for (const b of [st.main, st.side]) {
      if (!b) continue;
      out.push({ stage: st.label, depth: 0, label: b.title, value: b.value });
      for (const l of b.lines) out.push({ stage: st.label, depth: 1, label: l.label, value: l.value, detail: l.note });
      for (const n of b.notes) out.push({ stage: st.label, depth: 1, label: n, value: undefined, note: true });
      if (b.countNote) out.push({ stage: st.label, depth: 1, label: b.countNote, value: undefined, note: true });
    }
  }
  return out;
}
