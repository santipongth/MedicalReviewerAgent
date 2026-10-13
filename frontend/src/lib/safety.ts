// Plan 26: deterministic safety rails over a finished result, in every audience view (no model call, nothing
// rewritten): the harms gap (abstracts often leave harms out, roadmap risk 1) and the dosing notice (the report never
// presents individual dosing instructions). Pure: no React.
import { isNonQuantitative } from "./charts-data";
import { reviewTypeOf } from "./review-type";
import { isNotEvidence } from "./trial-reports";
import type { Paper, PaperCard, ReviewResult, Synthesis } from "./types";

/** An outcome about harms: English (the card before translation) or Thai (a Thai card without its English copy). */
export const HARM_EN = /(?<![a-z])(?:adverse|side[- ]?effects?|harms?(?![a-z])|harmful|safety|tolerab|toxicit|complications?|withdrawals? due to|discontinu\w* due to)/i;
export const HARM_TH = /ไม่พึงประสงค์|ผลข้างเคียง|อาการข้างเคียง|ความปลอดภัย|อันตราย|ภาวะแทรกซ้อน|ความเป็นพิษ/;

/** Question types whose answer is a treatment or prevention effect, where missing harms data matters. */
const HARMS_QUESTIONS = new Set(["therapy", "prevention"]);

export function reportsHarms(card: PaperCard | null | undefined): boolean {
  return (card?.outcomes ?? []).some((o) => {
    const text = `${o.outcome ?? ""} ${o.result ?? ""}`;
    return HARM_EN.test(text) || HARM_TH.test(text);
  });
}

export interface HarmsGap {
  /** evidence studies whose abstract reports a harms or adverse-event outcome */
  reporting: number;
  /** evidence studies read (not a further report, not a design outside the ticked types, not qualitative themes) */
  studies: number;
}

/**
 * The harms gap of a treatment or prevention question: how many evidence studies report harms, when not all do.
 * Null for other question types, scoping reviews, results without studies or a question type, and when every study
 * reports harms. Counts of studies are plain figures (never a number from a paper).
 */
export function harmsGap(result: ReviewResult | null | undefined): HarmsGap | null {
  if (!result || reviewTypeOf(result) === "scoping") return null;
  if (!HARMS_QUESTIONS.has(result.question?.question_type ?? "")) return null;
  const studies = (result.papers ?? []).filter((p: Paper) => {
    const card = p.card_en ?? p.card;
    return !!card && !isNotEvidence(p) && !isNonQuantitative(card);
  });
  if (!studies.length) return null;
  const reporting = studies.filter((p) => reportsHarms(p.card_en) || reportsHarms(p.card)).length;
  return reporting < studies.length ? { reporting, studies: studies.length } : null;
}

const UNIT_EN = String.raw`\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|μg|g|ml|iu|units?|tablets?|capsules?|puffs?|drops?)(?![a-z])`;
/**
 * Advice to the reader: an imperative or "should" verb followed closely (same sentence) by a dose. A study's dose
 * stated as a condition ("metformin 500 mg twice daily was associated…", "participants who take 100 mg…", "randomized
 * to take 20 mg…", "the use of 500 mg…") is not advice.
 */
export const DOSE_ADVICE_EN = new RegExp(
  String.raw`(?:(?<!who |that |which |to )\b(?:take|give|administer|prescribe)\b|\bshould (?:take|receive|use|be given|be taken)\b|\brecommended (?:daily )?dose\b)[^.;]{0,40}?`
    + UNIT_EN, "i");
const UNIT_TH = String.raw`\d+(?:[.,]\d+)?\s?(?:มก|มิลลิกรัม|ไมโครกรัม|กรัม|มล|มิลลิลิตร|ยูนิต|หน่วย|เม็ด|แคปซูล)`;
/** Thai advice: ควร / แนะนำให้ / โปรด with a dose or a schedule (ครั้งละ, วันละ) in the same sentence. */
export const DOSE_ADVICE_TH = new RegExp(String.raw`(?:ควร|แนะนำให้|โปรด)[^.;]{0,30}?(?:${UNIT_TH}|ครั้งละ|วันละ)`);

export function hasDosingAdvice(text: string | null | undefined): boolean {
  return !!text && (DOSE_ADVICE_EN.test(text) || DOSE_ADVICE_TH.test(text));
}

function synthesisTexts(s: Synthesis | null | undefined): string[] {
  if (!s) return [];
  return [s.answer ?? "", s.executive_summary ?? "", ...(s.key_findings ?? []).map((k) => k.statement ?? "")];
}

/** True when any model-written text of the report (shown or English) reads as dosing advice: the notice is shown. */
export function needsDosingNotice(result: ReviewResult | null | undefined): boolean {
  if (!result) return false;
  return [result.summary ?? "", ...synthesisTexts(result.synthesis), ...synthesisTexts(result.synthesis_en)]
    .some(hasDosingAdvice);
}
