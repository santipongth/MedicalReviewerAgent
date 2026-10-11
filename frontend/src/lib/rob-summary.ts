// Plan 20 Task 4: the risk-of-bias summary, counts of the per-paper judgements (made by a model from the abstract)
// by study design. Pure data, no React. Counts of studies: the component sets them in the display face.
import { designKey, designLabel, isNonQuantitative } from "./charts-data";
import { DESIGN_LABEL, type Lang } from "./i18n";
import { isRelatedReport } from "./trial-reports";
import type { Paper, RiskOfBias } from "./types";

/** Column order: low, some concerns (moderate), high, unclear. */
export const ROB_ORDER: RiskOfBias[] = ["low", "moderate", "high", "unclear"];

export const ROB_COLUMN: Record<Lang, Record<RiskOfBias, string>> = {
  th: { low: "ต่ำ", moderate: "มีข้อกังวลบางส่วน", high: "สูง", unclear: "ไม่ชัด" },
  en: { low: "Low", moderate: "Some concerns", high: "High", unclear: "Unclear" },
};

export interface RobRow {
  design: string;
  label: string;
  counts: Record<RiskOfBias, number>;
  total: number;
  /** qualitative / mixed-methods: themes, never a direction */
  themes: boolean;
}

export interface RobSummary {
  rows: RobRow[];
  totals: Record<RiskOfBias, number>;
  total: number;
  /** further reports of a trial already counted (Plan 20 Task 10), left out of the counts */
  related: number;
  /** papers read as a design outside the ticked study types (`design_excluded`): not evidence, left out of the counts */
  notEvidence: number;
}

const DESIGN_ORDER = Object.keys(DESIGN_LABEL.en);
const zero = (): Record<RiskOfBias, number> => ({ low: 0, moderate: 0, high: 0, unclear: 0 });

/** One row per design that has a judged paper; null when no paper has a judgement (nothing to summarise). */
export function robSummary(papers: Paper[], lang: Lang): RobSummary | null {
  const rows = new Map<string, RobRow>();
  const totals = zero();
  let related = 0;
  let notEvidence = 0;
  for (const p of papers) {
    const card = p.card_en ?? p.card;
    const rob = card?.risk_of_bias;
    if (!card || !rob || !(ROB_ORDER as string[]).includes(rob)) continue;
    // not evidence (`isNotEvidence`): each kind is left out and named in its own note
    if (isRelatedReport(p)) { related += 1; continue; }
    if (p.design_excluded) { notEvidence += 1; continue; }
    const key = designKey(card);
    const row = rows.get(key) ?? { design: key, label: designLabel(key, lang), counts: zero(), total: 0, themes: isNonQuantitative(card) };
    row.counts[rob] += 1;
    row.total += 1;
    totals[rob] += 1;
    rows.set(key, row);
  }
  if (!rows.size) return null;
  const rank = (d: string) => { const i = DESIGN_ORDER.indexOf(d); return i < 0 ? DESIGN_ORDER.length : i; };
  const sorted = [...rows.values()].sort((a, b) => rank(a.design) - rank(b.design) || a.label.localeCompare(b.label));
  return { rows: sorted, totals, total: sorted.reduce((n, r) => n + r.total, 0), related, notEvidence };
}
