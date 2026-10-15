"use client";

import { createContext, Fragment, useContext, useId, useState, type ReactNode } from "react";
import { designKey, designLabel, isNonQuantitative, questionDirection } from "@/lib/charts-data";
import { surnameOf } from "@/lib/author";
import { DIRECTION_LABEL, ROB_LABEL, STRENGTH_LABEL, type Lang } from "@/lib/i18n";
import { fieldLang, RC, type Pair } from "@/lib/i18n-report";
import { isReviewDiscordant, matrixView } from "@/lib/report-view";
import { isRelatedReport, relatedLabel, relatedReasonText, relatedReportsLabel } from "@/lib/trial-reports";
import { isGraded, REVIEW_TYPE_LABEL, showsCardDirection, showsRiskOfBias, type ReviewTypeOrLegacy } from "@/lib/review-type";
import { citationOf, isChecked } from "@/lib/support";
import type { ComparisonCell, ComparisonRow, EvidenceCluster, Paper, PaperCard, QuestionBlock, Quality, SupportClaim, Synthesis } from "@/lib/types";
import { DesignMismatchFlag, Glyph, UncertainFlag } from "../ui/evidence";
import { Term } from "../ui/term";
import { ThaiText } from "../ui/thai-text";
import { DisclosureChevron } from "../ui/disclosure-chevron";
import { CertaintyMark } from "./certainty";
import { ScrollRegion } from "./scroll-region";
import { L } from "./text";

const P = RC.parts;

/**
 * Running prose in the report (answer, findings, claims, gaps, limitations, methods): globals.css `.reading`, the body
 * size in English and the Thai reading size (DESIGN.md: 17px / 1.75) in a Thai report (Plan 20 Task 7).
 */
export const READING = "reading";

/** Opens a paper in the rail; `claim` (Plan 25) is the checked sentence the reader came from, shown first there. */
export type Select = (ref: string, outcome?: string, claim?: string) => void;

const CITE = /\[(P\d+(?:\s*,\s*P\d+)*)\]/g;
const S = RC.support;

/** Plan 25: the claims of a shown text's citation groups (`alignMarkers`), with the papers for the badge rule. */
export interface MarkerSupport {
  claims: (SupportClaim | null)[];
  papers: Map<string, Paper>;
  lang: Lang;
}

/** The "ตรวจแล้ว" badge of one citation in running prose: a check mark with its accessible name, never colour alone. */
export function CheckedMark({ refId, lang }: { refId: string; lang: Lang }) {
  return (
    <span role="img" aria-label={L(lang, S.checkedName(refId))} title={L(lang, S.checked)} data-checked={refId}
      className="ml-0.5 font-display text-[0.8em] font-semibold text-ink">✓</span>
  );
}

/** Whether any citation of these groups carries the badge (then the legend explains the mark). */
export function hasCheckedMark(support: MarkerSupport | null | undefined): boolean {
  return !!support?.claims.some((c) => c?.citations.some((x) => isChecked(x, support.papers.get(x.ref), c)));
}

/** The legend under a text or a list that shows the badge. */
export function SupportLegend({ lang }: { lang: Lang }) {
  return <p className="text-[0.8rem] text-muted" data-support-legend>{L(lang, S.legend)}</p>;
}

/**
 * Text with [P1, P3] citations turned into buttons that open the cited paper. Narrative numbers stay plain text. With
 * `support` (Plan 25), a citation the engine checked carries the badge, and opening it names its claim.
 */
export function CitedText({ text, onSelect, refs, support }: {
  text: string; onSelect: Select; refs: Set<string>; support?: MarkerSupport | null;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(CITE)) {
    parts.push(text.slice(last, m.index));
    const ids = m[1].split(/\s*,\s*/);
    const claim = support?.claims[k] ?? null;
    k += 1;
    parts.push(
      <span key={m.index} className="whitespace-nowrap">
        [{ids.map((id, i) => (
          <Fragment key={id}>
            {i > 0 && ", "}
            {refs.has(id) ? (
              <button type="button" onClick={() => (claim ? onSelect(id, undefined, claim.id) : onSelect(id))}
                className="font-display text-[0.85em] font-semibold text-primary hover:underline">{id}</button>
            ) : id}
            {support && claim && isChecked(citationOf(claim, id), support.papers.get(id), claim) && <CheckedMark refId={id} lang={support.lang} />}
          </Fragment>
        ))}]
      </span>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

/** How the agent read the question: interpretation, PICO, sub-questions, assumptions. One disclosure, no nesting. */
export function QuestionDetails({ question, lang, type = "legacy" }: { question?: QuestionBlock; lang: Lang; type?: ReviewTypeOrLegacy }) {
  const text = lang === "en" && question?.english ? question.english : question;
  const pico = question?.pico;
  const hasMore = !!text?.sub_questions?.length || !!text?.assumptions?.length || !!question?.ambiguities?.length;
  const isPcc = question?.framework === "PCC";
  const keyTerms = type === "legacy" ? [] : question?.key_terms ?? []; // legacy reports stay as they were
  if (!text?.interpretation && !pico && !isPcc && !keyTerms.length && !hasMore) return null;
  return (
    <details className="grid gap-3 text-[0.92rem]">
      <summary className="cursor-pointer font-display font-semibold">{L(lang, P.interpreted)}</summary>
      <div className="mt-3 grid gap-3">
        {text?.interpretation && <p className="max-w-[65ch] text-[0.95rem] text-muted" lang={fieldLang(text.interpretation, lang)}>{text.interpretation}</p>}
        {isPcc && <p className="label"><Term k="pcc" lang={lang}>PCC</Term></p>}
        {isPcc && (
          <dl className="grid gap-px overflow-hidden rounded-sm border border-rule bg-rule sm:grid-cols-3">
            {([["P", L(lang, P.population), pico?.population], ["C", L(lang, P.concept), question?.concept],
              ["C", L(lang, P.context), question?.context]] as const)
              .map(([k, label, v]) => (
                <div key={label} className="bg-surface px-4 py-2.5">
                  <dt className="label">{k} · {label}</dt>
                  <dd className="text-[0.92rem] break-words" lang={fieldLang(v, lang)}>{v || "–"}</dd>
                </div>
              ))}
          </dl>
        )}
        {!isPcc && pico && <p className="label"><Term k="pico" lang={lang}>PICO</Term></p>}
        {!isPcc && pico && (
          <dl className="grid gap-px overflow-hidden rounded-sm border border-rule bg-rule sm:grid-cols-2">
            {([["P", L(lang, P.population), pico.population], ["I", L(lang, P.intervention), pico.intervention_or_exposure],
              ["C", L(lang, P.comparator), pico.comparator], ["O", L(lang, P.outcomes), pico.outcomes?.join(", ")]] as const)
              .map(([k, label, v]) => (
                <div key={k} className="bg-surface px-4 py-2.5">
                  <dt className="label">{k} · {label}</dt>
                  <dd className="text-[0.92rem] break-words" lang={fieldLang(v, lang)}>{v || "–"}</dd>
                </div>
              ))}
          </dl>
        )}
        {!!keyTerms.length && (
          <div>
            <p className="label">{L(lang, P.keyTerms)}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {keyTerms.map((k) => (
                <li key={k.term} className="rounded-sm border border-rule bg-ground px-2 py-0.5 text-[0.85rem] break-words">
                  <b className="font-display font-semibold">{k.term}</b>
                  {!!k.synonyms?.length && <span className="text-muted"> · {k.synonyms.join(", ")}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!!text?.sub_questions?.length && (
          <div>
            <p className="label">{L(lang, P.subQuestions)}</p>
            <ul className="mt-1 list-disc pl-5">{text.sub_questions.map((s) => <li key={s} lang={fieldLang(s, lang)}>{s}</li>)}</ul>
          </div>
        )}
        {!!text?.assumptions?.length && (
          <p className="text-muted">{L(lang, P.assumptions)}: <span lang={fieldLang(text.assumptions.join(" "), lang)}>{text.assumptions.join(" · ")}</span></p>
        )}
        {!!question?.ambiguities?.length && (
          <p className="text-muted">{L(lang, P.otherReadings)}: <span lang={fieldLang(question.ambiguities.join(" "), lang)}>{question.ambiguities.join(" · ")}</span></p>
        )}
      </div>
    </details>
  );
}

/**
 * How code reconciled the rationale with the GRADE-lite factors (`quality.prose_check.rationale_fixed`): a small note
 * under the rationale, so a reader knows the text was edited by rules, not written that way.
 */
const FIXED_NOTE: Record<"replaced" | "appended" | "trimmed", Pair> = {
  trimmed: P.fixedTrimmed, appended: P.fixedAppended, replaced: P.fixedReplaced,
};

export function StrengthLine({ synthesis, lang, quality, type = "legacy", bar = true, openRationale = false }: {
  synthesis: Synthesis; lang: Lang; quality?: Quality; type?: ReviewTypeOrLegacy;
  /** false for a meta-analysis without a pooled estimate: the grade rests on single studies, so no graded bar */
  bar?: boolean;
  /** Plan 26: the rationale disclosure starts open (learner and committee views) */
  openRationale?: boolean;
}) {
  // A typed result with no grade must never read as "very low": only legacy results keep that fallback.
  const ungraded = type !== "legacy" && (!isGraded(type) || synthesis.evidence_strength == null);
  const level = synthesis.evidence_strength ?? "very_low";
  const typeName = type === "legacy" ? "" : REVIEW_TYPE_LABEL[type][lang];
  const rationale = (!ungraded || isGraded(type)) && synthesis.evidence_rationale;
  const fixed = quality?.prose_check?.rationale_fixed ?? null;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.92rem]">
        {ungraded ? (
          <p className="font-display font-semibold">
            {L(lang, P.notAssessed(typeName))}
          </p>
        ) : (
        <p className="flex flex-wrap items-center gap-2 font-display font-semibold">
          <Term k="evidenceStrength" lang={lang}>{L(lang, P.strength)}</Term>: <b>{STRENGTH_LABEL[lang][level]}</b>
          {bar ? <CertaintyMark level={level} lang={lang} label="silent" />
            : <span className="font-normal text-muted" data-no-bar>{L(lang, P.noBar)}</span>}
        </p>
        )}
        {quality?.numbers_total ? (
          <p className="text-muted">
            {L(lang, P.numbersVerified)}{" "}
            <span className="font-display tabular-nums">{`${quality.numbers_verified ?? 0}/${quality.numbers_total}`}</span>
          </p>
        ) : null}
      </div>
      {/* A grade's rationale sits behind a disclosure (Plan 20: the answer comes first); a graded type left ungraded
          (no quantitative studies) says why in the open. Narrative and scoping need no reason. */}
      {rationale && (ungraded ? <p className="max-w-[65ch] text-[0.88rem] text-muted" lang={fieldLang(rationale, lang)}>{rationale}</p> : (
        <details className="group text-[0.9rem]" open={openRationale || undefined}>
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-display font-semibold text-primary md:min-h-0">
            <DisclosureChevron />
            {L(lang, P.whyCertainty)}
          </summary>
          <p className="mt-1 max-w-[65ch] text-muted" lang={fieldLang(rationale, lang)}>{rationale}</p>
          {fixed && FIXED_NOTE[fixed] && (
            <p className="mt-1 max-w-[65ch] text-[0.8rem] text-muted" data-rationale-fixed={fixed}>{L(lang, FIXED_NOTE[fixed])}</p>
          )}
        </details>
      ))}
    </div>
  );
}

/** True when both readings of each paper came from the same model (Plan 20): the flag then says "two readings". */
export const SameModelReadings = createContext(false);

/** The uncertain flag in the report: "two readings disagree" when both readings came from one model. */
export function ReadingFlag({ lang }: { lang: Lang }) {
  const same = useContext(SameModelReadings);
  return <UncertainFlag lang={lang} label={same ? L(lang, P.twoReadings) : undefined} />;
}

/** Outcome × paper; every cell is a glyph button that opens its source in the rail. */
/**
 * Findings matrix (outcome × study): by default the outcomes two or more studies report, most studies first, with a
 * "show all" toggle and a k column (Plan 20 Task 5); scrolls inside its own region with an edge cue.
 */
export function ComparisonMatrix({ rows, refs: allRefs, lang, onSelect, selected, outcomeOf, pooledRefs, papers }: {
  rows: ComparisonRow[]; refs: string[]; papers?: Paper[]; lang: Lang; onSelect: Select; selected?: { ref: string; outcome?: string };
  outcomeOf: (row: ComparisonRow, ref: string) => string | undefined;
  pooledRefs?: Set<string>; // systematic reviews / meta-analyses: may already include the primary studies
}) {
  const byRef = new Map((papers ?? []).map((p) => [p.ref, p]));
  // A qualitative / mixed-methods study's cell is a theme it reports, never a direction (the card's design decides,
  // the cell's own design_category is the fallback when the paper is not at hand).
  const isThemeCell = (c: ComparisonCell) => {
    const p = byRef.get(c.ref);
    return isNonQuantitative(p ? p.card_en ?? p.card : { design_category: c.design_category });
  };
  const [showAll, setShowAll] = useState(false);
  const view = matrixView(rows, allRefs, showAll);
  const refs = view.refs;
  let selectedLine = "";
  if (selected?.outcome !== undefined) {
    for (const { row } of view.rows) {
      const cell = row.cells.find((c) => c.ref === selected.ref);
      if (cell && outcomeOf(row, selected.ref) === selected.outcome) { selectedLine = `${selected.ref} · ${row.outcome}: ${findingText(cell.finding, lang)}`; break; }
    }
  }
  const caption = L(lang, RC.report.findingsByStudy);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[0.85rem] text-muted">
      <p data-matrix-filter>
        {view.hidden > 0 ? L(lang, P.matrixShown(view.rows.length, view.total)) : L(lang, P.matrixAll(view.total))}
      </p>
      {(view.hidden > 0 || showAll) && (
        <button type="button" onClick={() => setShowAll((s) => !s)} aria-pressed={showAll}
          className="inline-flex min-h-11 items-center font-display font-semibold text-primary underline underline-offset-2 md:min-h-0 print:hidden">
          {showAll ? L(lang, P.showTwoPlus) : L(lang, P.showAll(view.total))}
        </button>
      )}
    </div>
    <ScrollRegion lang={lang} label={L(lang, P.scrollable(caption))}>
      <table aria-label={caption} className="w-full border-collapse text-[0.88rem] sm:min-w-[620px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-ground">
            <th scope="col" className="left-0 z-10 min-w-[9rem] bg-ground px-2.5 py-2 text-left label sm:sticky sm:min-w-[190px]">{L(lang, P.outcome)}</th>
            <th scope="col" className="px-2 py-2 text-center label" title={L(lang, P.kTitle)}>
              k<span className="sr-only"> {L(lang, P.kSr)}</span>
            </th>
            {refs.map((r) => {
              const paper = byRef.get(r);
              const surname = surnameOf(paper?.authors?.[0]);
              const byline = [surname, paper?.year].filter(Boolean).join(" ");
              return (
                <th key={r} scope="col" className="px-2 py-2 text-center label">
                  <abbr title={paper?.title} className="no-underline">
                    <span className="block">{r}</span>{" "}
                    {byline && <span className="block text-[0.68rem] font-normal normal-case text-muted"><bdi>{byline}</bdi></span>}
                  </abbr>
                  {pooledRefs?.has(r) && (
                    <span className="mt-0.5 block text-[0.68rem] font-semibold">
                      <Term k="srma" lang={lang}>SR/MA</Term>
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {view.rows.map(({ row, k }) => {
            const themes = row.cells.filter((c) => isThemeCell(c)).length;
            return (
            <tr key={row.outcome} className="border-t border-rule">
              <th scope="row" className="left-0 z-10 bg-surface px-2.5 py-2 text-left font-body font-medium break-words sm:sticky" lang={fieldLang(row.outcome, lang)}>
                {row.outcome}
                {themes > 0 && <span className="block text-[0.75rem] font-normal text-muted" data-theme-count>{themeFoundText(themes, lang)}</span>}
              </th>
              <td className="px-2 text-center font-display tabular-nums" data-k>{k}</td>
              {refs.map((ref) => {
                const cell = row.cells.find((c) => c.ref === ref);
                if (!cell) return <td key={ref} className="h-9 text-center text-muted">–</td>;
                const outcome = outcomeOf(row, ref);
                const isSel = selected?.ref === ref && selected.outcome === outcome;
                const theme = isThemeCell(cell);
                const charted = isCharted(cell.finding);
                // a charted (scoping "✓") cell says only that the study covers the aspect: no direction word or glyph
                const label = charted ? `${ref}: ${row.outcome} — ${findingText(cell.finding, lang)}`
                  : `${ref}: ${row.outcome} — ${theme ? THEME_CELL_LABEL[lang] : DIRECTION_LABEL[lang][cell.direction]}. ${findingText(cell.finding, lang)}`;
                return (
                  <td key={ref} className="h-9 text-center">
                    <button type="button" onClick={() => onSelect(ref, outcome)} aria-pressed={isSel}
                      aria-label={label} title={findingText(cell.finding, lang)}
                      className={`inline-grid min-h-11 min-w-11 place-items-center rounded-sm border md:h-7 md:min-h-0 md:min-w-8 ${theme ? "md:px-0.5" : "md:w-8"} ${isSel ? "border-ink bg-rail" : "border-transparent hover:border-ink"}`}>
                      {charted ? <CheckMark /> : theme ? <ThemeMark lang={lang} /> : <Glyph direction={cell.direction} lang={lang} />}
                    </button>
                  </td>
                );
              })}
            </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollRegion>
    <p aria-live="polite" className="min-h-[1.4em] text-[0.85rem] break-words">{selectedLine}</p>
    </div>
  );
}

/** Scoping cells say only that the paper covers the aspect ("✓", Plan 20 Task 10): read as words, never a bare mark. */
export function isCharted(finding: string | null | undefined): boolean {
  return (finding ?? "").trim() === "✓";
}

/** A neutral check mark in `ink` (no direction colour or shape); the button's label carries the words. */
function CheckMark() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" data-charted-mark>
      <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

function findingText(finding: string, lang: Lang): string {
  return isCharted(finding) ? L(lang, P.covers) : finding;
}

const THEME_CELL_LABEL: Record<Lang, string> = { th: P.themeCell[0], en: P.themeCell[1] };

/** "Found in k studies": how a qualitative theme is counted (never "supports"). */
export function themeFoundText(k: number, lang: Lang): string {
  return L(lang, P.foundIn(k));
}

/** The matrix mark of a qualitative theme: a neutral word, not a direction shape. */
function ThemeMark({ lang }: { lang: Lang }) {
  return (
    <span aria-hidden="true" data-theme-mark
      className="rounded-sm border border-ink px-1 font-display text-[0.75rem] leading-[1.3] font-semibold text-ink">
      {L(lang, P.found)}
    </span>
  );
}

export function MatrixLegend({ lang, themes = false }: { lang: Lang; themes?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-muted">
      {(["positive", "negative", "null", "mixed", "unclear"] as const).map((d) => (
        <span key={d} className="inline-flex items-center gap-1.5"><Glyph direction={d} lang={lang} />{DIRECTION_LABEL[lang][d]}</span>
      ))}
      {themes && (
        <span className="inline-flex items-center gap-1.5"><ThemeMark lang={lang} />
          {L(lang, P.themeLegend)}</span>
      )}
      <ReadingFlag lang={lang} />
    </div>
  );
}

/** Study codes that open the paper in the source rail (44px tall on touch). */
export function RefButtons({ refs, onSelect, lang, checked, claim }: {
  refs: string[]; onSelect: Select; lang: Lang;
  /** Plan 25: refs whose citation carries the "ตรวจแล้ว" badge, and the claim they were checked for */
  checked?: ReadonlySet<string>; claim?: string;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {refs.map((r) => (
        <button key={r} type="button" onClick={() => (claim ? onSelect(r, undefined, claim) : onSelect(r))}
          aria-label={L(lang, checked?.has(r) ? S.openChecked(r) : P.open(r))} data-checked={checked?.has(r) || undefined}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-rule px-1.5 font-display text-[0.8rem] leading-normal hover:border-ink md:min-h-6 md:min-w-0">
          {r}{checked?.has(r) && <span aria-hidden="true" className="ml-1 font-semibold">✓</span>}
        </button>
      ))}
    </span>
  );
}

/** The label of a split between systematic reviews and primary studies (Plan 20 Task 11). */
export const REVIEW_DISCORDANT_LABEL: Record<Lang, string> = { th: P.reviewDiscordant[0], en: P.reviewDiscordant[1] };

export function ClaimsPanel({ consensus, conflicts, lang, onSelect, refs, graded = true }: {
  consensus: EvidenceCluster[]; conflicts: EvidenceCluster[]; lang: Lang; onSelect: Select; refs: Set<string>;
  /** the review is graded: the note says such a split does not lower the certainty */
  graded?: boolean;
}) {
  if (!consensus.length && !conflicts.length) return null;
  const discordant = [...consensus, ...conflicts].some(isReviewDiscordant);
  return (
    <div className="grid gap-4">
    <div className="grid gap-6 md:grid-cols-2">
      {([[L(lang, P.agree), consensus, false], [L(lang, P.conflict), conflicts, true]] as const).map(([title, items, isConflict]) => (
        <section key={title} className="grid content-start gap-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          {items.length === 0 ? (
            <p className="text-[0.9rem] text-muted">{L(lang, isConflict ? P.noConflict : P.noAgree)}</p>
          ) : (
            <ul className="grid gap-3">
              {items.map((c) => {
                // reviews vs primary studies: its own ruled card (info tint), never the warning tint of a real conflict
                const split = isReviewDiscordant(c);
                return (
                <li key={c.statement} data-claim data-conflict={isConflict || undefined} data-review-discordant={split || undefined}
                  className={`grid gap-1.5 rounded-sm p-3 ${split ? "border border-rule bg-info-bg" : isConflict ? "bg-warn-bg" : "bg-ground"}`}>
                  {split && (
                    <span className="label w-fit rounded-sm border border-ink px-1.5 py-0.5 text-ink">
                      <ThaiText>{REVIEW_DISCORDANT_LABEL[lang]}</ThaiText>
                    </span>
                  )}
                  <b className="font-display" lang={fieldLang(c.statement, lang)}>{c.statement}</b>
                  <p className={READING} lang={fieldLang(c.explanation, lang)}><CitedText text={c.explanation} onSelect={onSelect} refs={refs} /></p>
                  {!!c.likely_reasons?.length && (
                    <p className="text-[0.88rem]"><span className="label mr-1.5">{L(lang, P.likelyReasons)}</span>
                      <span lang={fieldLang(c.likely_reasons.join(" "), lang)}>{c.likely_reasons.join(" · ")}</span></p>
                  )}
                  <RefButtons refs={c.refs} onSelect={onSelect} lang={lang} />
                </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
    {discordant && (
      <p className="max-w-[65ch] text-[0.88rem] text-muted" data-discordant-note>
        {L(lang, P.discordantNote)}
        {/* GRADE-lite records only a split on the primary outcome, as minor inconsistency; none downgrades (api.md) */}
        {L(lang, graded ? P.discordantGraded : P.discordantEnd)}
      </p>
    )}
    </div>
  );
}

const otherComparisons = (card: PaperCard) => card.outcomes.filter((o) => o.matches_question === false).length;

/**
 * What the review made of one paper (year, design, direction, bias, flags, reports of the same trial), as the button
 * that opens it in the source rail. Its accessible name starts with the ref ("P3 …"). Sits in its reference (Task 6).
 */
export function StudyButton({ p, lang, onSelect, selected, type = "legacy" }: {
  p: Paper; lang: Lang; onSelect: Select; selected: boolean; type?: ReviewTypeOrLegacy;
}) {
  const card = lang === "en" ? p.card_en ?? p.card : p.card;
  const en = p.card_en ?? p.card; // the checked card: design, direction and comparison flags
  const others = en ? otherComparisons(en) : 0;
  const meta = useId();
  // an unread paper has no source sentences to show: the cue promises only the paper
  const cue = L(lang, card ? P.showSources : P.showPaper);
  return (
    <button type="button" onClick={() => onSelect(p.ref)} aria-pressed={selected} aria-describedby={meta}
      aria-label={`${p.ref} ${cue}: ${p.title}`}
      className={`grid min-h-11 w-full min-w-0 gap-1 rounded-sm px-1 py-1 text-left hover:bg-ground ${selected ? "bg-ground" : ""}`}>
      <span id={meta} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.85rem] text-muted">
        {card && en ? (
          <>
            <span>{designLabel(designKey(card), lang)}</span>
            {showsCardDirection(type, en) ? (
              <span className="inline-flex items-center gap-1.5"><Glyph direction={questionDirection(en)} lang={lang} />{DIRECTION_LABEL[lang][questionDirection(en)]}</span>
            ) : isNonQuantitative(en) && (
              <span data-theme-paper>{L(lang, P.themesNoDirection)}</span>
            )}
            {showsRiskOfBias(type) && <span>{L(lang, P.bias)}: {ROB_LABEL[lang][card.risk_of_bias]}</span>}
            {others > 0 && (
              <span data-other-comparison>
                {L(lang, others === en.outcomes.length ? P.otherOnly : P.otherSome(others))}
              </span>
            )}
          </>
        ) : (
          <span className="text-err">{L(lang, P.unread)}{p.error ? ` · ${p.error}` : ""}</span>
        )}
        {p.verification?.uncertain && <ReadingFlag lang={lang} />}
        {p.verification?.design_mismatch && <DesignMismatchFlag lang={lang} />}
      </span>
      {/* reports of the same trial (Plan 20 Task 10): one study, however many reports */}
      {isRelatedReport(p) && (
        <span className="text-[0.85rem]" data-related-to={p.related_to}>
          <span className="font-display font-semibold">{relatedLabel(p.related_to!, lang)}</span>
          {relatedReasonText(p.related_reason, lang) && <span className="text-muted"> · {relatedReasonText(p.related_reason, lang)}</span>}
        </span>
      )}
      {!!p.related_reports?.length && (
        <span className="text-[0.85rem] text-muted" data-related-reports>
          {relatedReportsLabel(lang)}: {p.related_reports.join(", ")}
        </span>
      )}
      <span className="font-display text-[0.85rem] font-semibold text-primary underline underline-offset-2 print:hidden">
        {cue}
      </span>
    </button>
  );
}
