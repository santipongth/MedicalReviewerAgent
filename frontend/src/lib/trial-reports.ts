// Reports of the same trial (Plan 20 Task 10 engine, Task 11 report): a further report of a trial already analysed
// (a secondary or follow-up analysis, a commentary) stays in `papers` with `related_to` = its primary report's ref.
// The engine already leaves it out of the comparison rows, consensus, conflicts, pools and every k; these helpers keep
// the report's own counts in step without subtracting anything twice.
import type { Lang } from "./i18n";
import type { Paper } from "./types";

/** A further report of a trial already counted as a study (absent or null `related_to`: a study of its own). */
export function isRelatedReport(p: Pick<Paper, "related_to"> | null | undefined): boolean {
  return !!p?.related_to;
}

/**
 * The studies behind a list of refs, in order: a further report stands for its primary report, and each study counts
 * once. Refs the engine already counted as studies (comparison rows) come back unchanged. A report whose primary is not
 * in the result stays, since it is then the only record of that trial here.
 */
export function studyRefs(refs: string[], byRef: Map<string, Paper>): string[] {
  const out: string[] = [];
  for (const r of refs) {
    const primary = byRef.get(r)?.related_to;
    const key = primary && byRef.has(primary) ? primary : r;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** The title block's counts: studies read (a card was extracted), further reports aside, papers that could not be read. */
export function includedCounts(papers: Paper[]): { studies: number; related: number; unread: number } {
  let studies = 0;
  let related = 0;
  let unread = 0;
  for (const p of papers) {
    if (!(p.card || p.card_en)) unread += 1;
    else if (isRelatedReport(p)) related += 1;
    else studies += 1;
  }
  return { studies, related, unread };
}

/** "รายงานเพิ่มเติมของ [P1] (การทดลองเดียวกัน)" / "Related report of [P1] (same trial)". */
export function relatedLabel(primary: string, lang: Lang): string {
  return lang === "th" ? `รายงานเพิ่มเติมของ [${primary}] (การทดลองเดียวกัน)` : `Related report of [${primary}] (same trial)`;
}

/** The parts of `relatedLabel` around the ref, for a label whose ref is a button. */
export function relatedLabelParts(lang: Lang): [string, string] {
  return lang === "th" ? ["รายงานเพิ่มเติมของ [", "] (การทดลองเดียวกัน)"] : ["Related report of [", "] (same trial)"];
}

/** On the primary report: "รายงานเพิ่มเติมของการทดลองนี้" / "Further reports of this trial". */
export function relatedReportsLabel(lang: Lang): string {
  return lang === "th" ? "รายงานเพิ่มเติมของการทดลองนี้" : "Further reports of this trial";
}

const NEAR_TITLE = "near-identical title, same first author, same ";
const NEAR_TITLE_TH: Record<string, string> = {
  "sample size": "ชื่อเรื่องเกือบเหมือนกัน ผู้แต่งคนแรกคนเดียวกัน และขนาดตัวอย่างเท่ากัน",
  "registry number": "ชื่อเรื่องเกือบเหมือนกัน ผู้แต่งคนแรกคนเดียวกัน และเลขทะเบียนการทดลองเดียวกัน",
};

/**
 * The engine's `related_reason` (English, fixed wording: docs/api.md) in the report language, shown after
 * `relatedLabel`, which already says "same trial": "same trial (X)" → only the trial's registry number or name
 * ("ทะเบียน/ชื่อการทดลอง: X" / "trial: X"); the near-identical-title reasons in Thai (as written in English). Wording
 * the UI does not know: in Thai "การทดลองเดียวกัน" with the engine's English in brackets; in English as written.
 */
export function relatedReasonText(reason: string | null | undefined, lang: Lang): string | null {
  const r = reason?.trim();
  if (!r) return null;
  const trial = /^same trial \((.+)\)$/.exec(r);
  if (trial) return lang === "th" ? `ทะเบียน/ชื่อการทดลอง: ${trial[1]}` : `trial: ${trial[1]}`;
  if (lang === "en") return r;
  if (r.startsWith(NEAR_TITLE) && NEAR_TITLE_TH[r.slice(NEAR_TITLE.length)]) return NEAR_TITLE_TH[r.slice(NEAR_TITLE.length)];
  return `การทดลองเดียวกัน (${r})`;
}
