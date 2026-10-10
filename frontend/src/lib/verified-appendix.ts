// The verified-numbers appendix (Plan 20 Task 8): every number from a study that the report shows, with the abstract
// sentence it was verified against, so a printed report keeps the "where does this number come from" trail; and the
// system's computed (pooled) numbers apart, with the inputs they were computed from. Numbers are only the ones the rail
// and the literature matrix show (verified, never blanked, never on a theme); nothing here is computed from a paper.
import { isNonQuantitative } from "./charts-data";
import { asReported, ciLabel, effectLabel, findReported, isBlankedEffect, type Reported } from "./evidence";
import type { Lang } from "./i18n";
import { metaView } from "./meta-view";
import type { ComparisonRow, MetaAnalysis, Paper } from "./types";

export interface VerifiedEntry {
  ref: string;
  kind: "effect" | "sample_size";
  /** the outcome as the report shows it (the English card in an English view); null for the sample size */
  outcome: string | null;
  /** the English card's outcome name: opens this outcome's quote in the source rail */
  outcomeKey: string | null;
  /** Plan 19: an estimate for another comparison, shown on the card but never used in the synthesis */
  otherComparison: boolean;
  /** as written in the paper: "HR 0.80", "1,234" */
  value: string;
  /** "0.71–0.90" as written, or null */
  ci: string | null;
  /** the abstract sentence the number was verified against (null when the result did not store one) */
  quote: string | null;
  /** where the number sits in the quote (the highlight), or null */
  mark: Reported | null;
}

/** Every verified number of every card, in the report's paper order: the sample size first, then each outcome. */
export function verifiedEntries(papers: Paper[], lang: Lang): VerifiedEntry[] {
  const out: VerifiedEntry[] = [];
  for (const paper of papers) {
    const card = lang === "en" ? paper.card_en ?? paper.card : paper.card;
    const en = paper.card_en ?? paper.card;
    if (!card || !en) continue;
    const n = card.sample_size;
    if (n != null) {
      const quote = en.sample_size_quote ?? card.sample_size_quote ?? null;
      out.push({ ref: paper.ref, kind: "sample_size", outcome: null, outcomeKey: null, otherComparison: false, value: asReported(n, quote), ci: null,
        quote, mark: findReported(n, quote) });
    }
    if (isNonQuantitative(en)) continue; // themes: no numbers by design
    card.outcomes.forEach((o, i) => {
      const oe = en.outcomes[i];
      if (o.effect_value == null || isBlankedEffect(paper, oe?.outcome ?? o.outcome)) return;
      const quote = oe?.evidence_quote ?? o.evidence_quote ?? null;
      const withQuote = { ...o, evidence_quote: quote };
      out.push({
        ref: paper.ref, kind: "effect", outcome: o.outcome, outcomeKey: oe?.outcome ?? o.outcome, otherComparison: (oe?.matches_question ?? o.matches_question) === false,
        value: effectLabel(withQuote), ci: ciLabel(withQuote), quote,
        mark: findReported(o.effect_value, quote, { lo: o.ci_lower, hi: o.ci_upper }),
      });
    });
  }
  return out;
}

export interface ComputedEntry {
  key: string;
  outcome: string;
  measure: string;
  group: string;
  k: number;
  est: string;
  ci: string;
  i2: string;
  tau2: string;
  refs: string[];
}

/** Each pooled estimate (meta-analysis) with what it was computed from; [] for any other review. */
export function computedEntries(meta: MetaAnalysis | null | undefined, papers: Paper[], rows: ComparisonRow[], lang: Lang): ComputedEntry[] {
  if (!meta?.pools?.length) return [];
  return metaView(meta, papers, rows, lang).pools.map((p) => ({
    key: p.key, outcome: p.outcome, measure: p.measure, group: p.groupLabel, k: p.k, est: p.estText, ci: p.ciText,
    i2: p.i2Text, tau2: p.tau2Text, refs: p.studies.map((s) => s.ref),
  }));
}
