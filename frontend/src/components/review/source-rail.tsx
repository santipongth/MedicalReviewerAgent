"use client";

import { useEffect, useRef } from "react";
import { HighlightedQuote } from "@/components/ui/quote";
import { designLabel, isNonQuantitative } from "@/lib/charts-data";
import { thaijoHref } from "@/lib/citation";
import { asReported, ciLabel, effectLabel, findReported, isBlankedEffect, isBlankedSampleSize, safeHref } from "@/lib/evidence";
import { DIRECTION_LABEL, ROB_LABEL, type Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import { showsCardDirection, showsRiskOfBias, type ReviewTypeOrLegacy } from "@/lib/review-type";
import { claimsForPaper, supportState } from "@/lib/support";
import type { OutcomeResult, Paper, PaperCard, SentenceSupport } from "@/lib/types";
import { DesignMismatchFlag, Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { isRelatedReport, relatedLabelParts, relatedReasonText, relatedReportsLabel } from "@/lib/trial-reports";
import { ReadingFlag, type Select } from "./report-parts";
import { L } from "./text";

const R = RC.rail;
const S = RC.support;

/** Card text in the reader's language when the engine translated it; otherwise as stored, marked with its own `lang`. */
function Field({ text, lang }: { text: string | null | undefined; lang: Lang }) {
  return <span lang={fieldLang(text, lang)}>{text}</span>;
}

/** Free text where the verifier masked numbers as "[unverified]": each mask becomes a visible not-verified gap. */
function MaskedText({ text, lang }: { text: string; lang: Lang }) {
  const parts = text.split("[unverified]");
  return <>{parts.map((p, i) => <span key={i}>{p}{i < parts.length - 1 && <Hole lang={lang} />}</span>)}</>;
}

/**
 * Why an outcome shows no number. A qualitative/mixed-methods theme has none by design. Otherwise only an explicit
 * `effect_measure: "none"` (the reader said the abstract states no number) reads as "reports no number"; anything else
 * is only "not extracted": the reader may have missed a number that the source sentence does state.
 */
export function noNumberText(o: Pick<OutcomeResult, "effect_measure">, theme: boolean, lang: Lang): string {
  if (theme) return L(lang, R.themeNoNumber);
  if (o.effect_measure === "none") return L(lang, R.reportsNone);
  return L(lang, R.notExtracted);
}

function OutcomeEvidence({ paper, o, en, lang, selected, visible, direction, theme }: {
  paper: Paper; o: OutcomeResult; en?: OutcomeResult; lang: Lang; selected: boolean; visible: boolean; direction: boolean;
  /** qualitative / mixed-methods card: a theme, never a number or a direction */
  theme: boolean;
}) {
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!selected || !visible || typeof item.current?.scrollIntoView !== "function") return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    item.current.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [selected, visible]);
  const quote = en?.evidence_quote ?? o.evidence_quote;
  const blanked = isBlankedEffect(paper, en?.outcome ?? o.outcome);
  const hasEffect = !theme && o.effect_value != null && !blanked;
  const ci = hasEffect ? ciLabel({ ...o, evidence_quote: quote }) : null;
  return (
    <li ref={item} className={`grid gap-2 border-t border-rule pt-3 ${selected ? "-mx-2 rounded-sm bg-surface px-2 pb-2" : ""}`} aria-current={selected || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        {direction && <Glyph direction={o.direction} lang={lang} />}
        <b className="font-display text-[0.95rem]" lang={fieldLang(o.outcome, lang)}>{o.outcome}</b>
        {direction && <span className="text-sm text-muted">{DIRECTION_LABEL[lang][o.direction]}</span>}
      </div>
      {(en?.matches_question ?? o.matches_question) === false && (
        <p className="text-sm text-muted" data-other-comparison>
          {L(lang, R.otherComparison)}
          {o.comparison ? `: ${o.comparison}` : ""}
        </p>
      )}
      <p className="text-[0.92rem]" lang={fieldLang(o.result, lang)}><MaskedText text={o.result} lang={lang} /></p>
      <p className="text-[0.92rem]">
        {hasEffect ? (
          <>
            <VerifiedNumber value={effectLabel({ ...o, evidence_quote: quote })} />
            {ci && <> <Term k="ci95" lang={lang}><span className="text-muted">95% CI</span></Term> <VerifiedNumber value={ci} /></>}
          </>
        ) : blanked ? (
          <><Hole lang={lang} explain /> <span className="text-sm text-muted">{L(lang, R.blanked)}</span></>
        ) : (
          <span className="text-sm text-muted" data-no-number>{noNumberText(en ?? o, theme, lang)}</span>
        )}
      </p>
      {quote && (
        <div className="grid gap-1">
          <span className="label">{L(lang, R.sourceSentence)}</span>
          <p className="font-quote text-[1rem] leading-relaxed" lang={fieldLang(quote, lang)}>
            {hasEffect ? <HighlightedQuote quote={quote} number={findReported(o.effect_value as number, quote, { lo: o.ci_lower, hi: o.ci_upper })} /> : <>&ldquo;{quote}&rdquo;</>}
          </p>
        </div>
      )}
    </li>
  );
}

function Facts({ paper, card, cardEn, lang, riskOfBias }: { paper: Paper; card: PaperCard; cardEn?: PaperCard | null; lang: Lang; riskOfBias: boolean }) {
  const n = card.sample_size;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1 text-[0.88rem]">
      <dt className="text-muted">{L(lang, R.year)}</dt><dd>{paper.year ?? "–"}</dd>
      <dt className="text-muted">{L(lang, R.design)}</dt>
      <dd className="break-words">{card.design_category
        ? <>{designLabel(card.design_category, lang)} · <Field text={card.study_design} lang={lang} /></>
        : <Field text={card.study_design} lang={lang} />}</dd>
      <dt className="text-muted">{L(lang, R.sample)}</dt>
      <dd>
        {n != null ? <>n = <VerifiedNumber value={asReported(n, cardEn?.sample_size_quote ?? card.sample_size_quote)} /></>
          : isBlankedSampleSize(paper) ? <Hole lang={lang} /> : <span className="text-muted">{L(lang, R.notReported)}</span>}
      </dd>
      <dt className="text-muted">{L(lang, R.population)}</dt><dd className="break-words" lang={fieldLang(card.population, lang)}>{card.population}</dd>
      {riskOfBias && <><dt className="text-muted"><Term k="riskOfBias" lang={lang}>{L(lang, R.rob)}</Term></dt><dd>{ROB_LABEL[lang][card.risk_of_bias] ?? card.risk_of_bias}</dd></>}
      <dt className="text-muted">{L(lang, R.textReadLabel)}</dt>
      <dd>{paper.fulltext_source ? (R.textRead[paper.fulltext_source] ? L(lang, R.textRead[paper.fulltext_source]) : "–") : L(lang, R.abstract)}</dd>
    </dl>
  );
}

function Links({ paper, lang }: { paper: Paper; lang: Lang }) {
  const links: [string, string][] = [];
  const fullText = safeHref(paper.fulltext_url);
  const page = safeHref(paper.url);
  if (paper.pmcid) links.push([`https://pmc.ncbi.nlm.nih.gov/articles/${paper.pmcid}/`, "PubMed Central"]);
  if (paper.pmid) links.push([`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`, "PubMed"]);
  if (paper.doi) links.push([`https://doi.org/${paper.doi}`, `DOI ${paper.doi}`]);
  const thaijo = thaijoHref(paper.thaijo_url); // Plan 24: the ThaiJO article page, never the PDF
  if (thaijo) links.push([thaijo, "ThaiJO"]);
  if (fullText && !links.some(([u]) => u === fullText)) links.push([fullText, L(lang, R.fullTextRead)]);
  if (!links.length && page) links.push([page, L(lang, R.articlePage)]);
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 font-display text-[0.88rem] font-semibold">
      {links.map(([href, label]) => (
        <li key={href}><a href={href} target="_blank" rel="noreferrer" className="break-all text-primary underline underline-offset-2">{label} ↗</a></li>
      ))}
    </ul>
  );
}

/** A ref that opens its paper in the rail when it can, else plain text. */
function RefLink({ refId, lang, onSelect }: { refId: string; lang: Lang; onSelect?: Select }) {
  if (!onSelect) return <>{refId}</>;
  return (
    <button type="button" onClick={() => onSelect(refId)} aria-label={L(lang, R.open(refId))}
      className="inline-flex min-h-11 items-center font-display font-semibold text-primary underline underline-offset-2 md:min-h-0">{refId}</button>
  );
}

/**
 * Reports of the same trial (Plan 20 Task 10): a further report names its primary report and why they were linked; the
 * primary lists its further reports. Both open in the rail.
 */
function RelatedNote({ paper, lang, onSelect }: { paper: Paper; lang: Lang; onSelect?: Select }) {
  const reason = relatedReasonText(paper.related_reason, lang);
  const [before, after] = relatedLabelParts(lang);
  return (
    <>
      {isRelatedReport(paper) && (
        <p className="grid gap-0.5 border-t border-rule pt-2 text-[0.9rem]" data-related-to={paper.related_to}>
          <span className="font-display font-semibold">{before}<RefLink refId={paper.related_to!} lang={lang} onSelect={onSelect} />{after}</span>
          {reason && <span className="text-muted">{reason}</span>}
          <span className="text-[0.82rem] text-muted">{L(lang, R.notCounted)}</span>
        </p>
      )}
      {!!paper.related_reports?.length && (
        <p className="flex flex-wrap items-baseline gap-x-2 border-t border-rule pt-2 text-[0.9rem]" data-related-reports>
          <span className="text-muted">{relatedReportsLabel(lang)}:</span>
          {paper.related_reports.map((r, i) => <span key={r}>{i > 0 && ", "}<RefLink refId={r} lang={lang} onSelect={onSelect} /></span>)}
        </p>
      )}
    </>
  );
}

/** The chip of a support state: a checked citation gets the outlined "✓ ตรวจแล้ว" mark, "not found" a dashed warning. */
const STATE_CHIP = {
  checked: "border-ink", unsupported: "border-dashed border-harm text-warn",
  numbers: "border-rule text-muted", partial: "border-rule text-muted", computed: "border-rule text-muted",
  not_evidence: "border-rule text-muted", unchecked: "border-rule text-muted",
} as const;

/**
 * Plan 25, "why this source was cited": every sentence of the report that cites this paper (the one the reader came
 * from first), as the engine checked it in English, the label, and the abstract sentence verbatim (the supporting one,
 * else the closest one). "Not found" is shown, never hidden.
 */
function WhyCited({ paper, support, claim, lang }: {
  paper: Paper; support?: SentenceSupport | null; claim?: string | null; lang: Lang;
}) {
  const items = claimsForPaper(support, paper.ref, claim);
  if (!items.length) return null;
  return (
    <section aria-label={L(lang, S.why)} className="grid gap-2 border-t border-rule pt-3" data-why-cited>
      <h3 className="label">{L(lang, S.why)}</h3>
      <ul className="grid gap-3">
        {items.map(({ claim: c, citation }) => {
          const state = supportState(c, citation, paper);
          const supporting = state === "checked" || state === "numbers" || state === "partial";
          return (
            <li key={c.id} data-support={state} aria-current={c.id === claim || undefined}
              className={`grid gap-1.5 ${c.id === claim ? "-mx-2 rounded-sm bg-surface px-2 py-2" : ""}`}>
              <span className={`w-fit rounded-sm border px-1.5 py-0.5 font-display text-[0.8rem] font-semibold ${STATE_CHIP[state]}`}>
                {state === "checked" && <span aria-hidden="true">✓ </span>}{L(lang, S.state[state])}
              </span>
              <span className="text-[0.8rem] text-muted">{L(lang, c.where === "key_finding" ? S.finding : S.claim)}</span>
              <p className="text-[0.92rem] break-words" lang="en">{c.claim}</p>
              {citation.evidence && (
                <>
                  <span className="label">{L(lang, supporting ? S.supporting : S.closest)}</span>
                  <p className="font-quote text-[1rem] leading-relaxed break-words" lang="en">&ldquo;{citation.evidence}&rdquo;</p>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[0.8rem] text-muted">{L(lang, S.note)}</p>
    </section>
  );
}

/** The paper behind whatever the reader selected: facts, each outcome's number and the exact sentence it came from. */
export function SourceRail({ paper, outcome, lang, onClose, headingId, visible = true, type = "legacy", onSelect, onReference,
  support, claim }: {
  paper: Paper | null; outcome?: string; lang: Lang; onClose?: () => void;
  /** Plan 25: the engine's sentence support, and the checked sentence the reader came from (listed first) */
  support?: SentenceSupport | null; claim?: string | null;
  /** the reader follows the link to the paper's reference (the drawer closes and focus lands there) */
  onReference?: (ref: string) => void;
  /** opens another paper in the rail (the primary report of a further report, and back) */
  onSelect?: Select;
  /** review type: scoping shows no direction and no risk of bias. */
  type?: ReviewTypeOrLegacy;
  /** id of the heading (the drawer's accessible name and initial focus target). */
  headingId?: string;
  /** false while the rail is hidden (closed drawer): the selected outcome scrolls into view once it shows. */
  visible?: boolean;
}) {
  const card = paper ? (lang === "en" ? paper.card_en ?? paper.card : paper.card) : null;
  const cardEn = paper?.card_en ?? paper?.card;
  return (
    <aside aria-label={L(lang, R.source)} aria-live="polite" data-source-rail
      className="grid min-w-0 content-start gap-4 bg-rail p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} tabIndex={-1} className="label">{L(lang, R.source)}{paper ? ` · ${paper.ref}` : ""}</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-sm border border-rule px-2 py-0.5 text-sm lg:hidden">
            {L(lang, R.close)}
          </button>
        )}
      </div>
      {!paper ? (
        <p className="text-[0.92rem] text-muted" data-rail-empty>{L(lang, R.empty)}</p>
      ) : (
        <>
          {paper.verification?.uncertain && (
            <p className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-harm pt-2 font-display text-[0.85rem] font-semibold text-warn">
              <ReadingFlag lang={lang} />
              <Term k="uncertain" lang={lang}>{L(lang, R.whatMeans)}</Term>
            </p>
          )}
          {paper.verification?.design_mismatch && (
            <p className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-harm pt-2 font-display text-[0.85rem] font-semibold text-warn">
              <DesignMismatchFlag lang={lang} />
            </p>
          )}
          <p className="font-display text-base font-semibold leading-snug break-words" lang={fieldLang(paper.title, lang)}>{paper.title}</p>
          {paper.journal && <p className="-mt-3 text-sm text-muted">{paper.journal}</p>}
          <RelatedNote paper={paper} lang={lang} onSelect={onSelect} />
          <WhyCited paper={paper} support={support} claim={claim} lang={lang} />
          {card ? (
            <>
              <Facts paper={paper} card={card} cardEn={cardEn} lang={lang} riskOfBias={showsRiskOfBias(type)} />
              <ul className="grid gap-3">
                {card.outcomes.map((o, i) => (
                  <OutcomeEvidence key={`${o.outcome}-${i}`} paper={paper} o={o} en={cardEn?.outcomes[i]} lang={lang}
                    direction={showsCardDirection(type, cardEn ?? card)} theme={isNonQuantitative(cardEn ?? card)}
                    selected={outcome != null && (cardEn?.outcomes[i]?.outcome ?? o.outcome) === outcome} visible={visible} />
                ))}
              </ul>
            </>
          ) : (
            <p className="rounded-sm bg-err-bg px-3 py-2 text-[0.9rem]">
              {L(lang, R.unread)}
              {paper.error ? ` (${paper.error})` : ""}
            </p>
          )}
          <Links paper={paper} lang={lang} />
          {/* Plan 20 Task 6: the rail links back to the paper's numbered reference */}
          <a href={`#ref-${paper.ref}`} onClick={() => onReference?.(paper.ref)}
            className="inline-flex min-h-11 w-fit items-center font-display text-[0.88rem] font-semibold text-primary underline underline-offset-2 md:min-h-0">
            {L(lang, R.toReference(paper.ref))}
          </a>
        </>
      )}
    </aside>
  );
}
