"use client";

import type { ReactNode } from "react";
import { exportUrl } from "@/lib/api";
import { META_POOL_COPY } from "@/lib/copy";
import type { TermKey } from "@/lib/glossary";
import type { Lang } from "@/lib/i18n";
import { fieldLang, LANGUAGE_NAME, RC } from "@/lib/i18n-report";
import { reportDate, sourceNames } from "@/lib/report-view";
import { REVIEW_TYPE_LABEL, type ReviewTypeOrLegacy } from "@/lib/review-type";
import { includedCounts } from "@/lib/trial-reports";
import type { Review, ReviewResult, ReviewType } from "@/lib/types";
import { CopyLinkButton } from "../ui/copy-link";
import { Term } from "../ui/term";
import { ThaiText } from "../ui/thai-text";
import { QuestionDetails } from "./report-parts";
import { L } from "./text";

const T = RC.title;

const TYPE_TERM: Record<ReviewType, TermKey> = {
  narrative: "narrativeReview", slr: "slr", scoping: "scopingReview", meta_analysis: "metaAnalysis",
};

const LINK = "inline-flex min-h-11 items-center font-display font-semibold text-primary underline underline-offset-2 md:min-h-0";
const BUTTON = "inline-flex min-h-11 cursor-pointer items-center rounded-sm border border-rule bg-transparent px-3 font-display text-sm hover:border-ink md:min-h-9";

/** The fixed status line under the title: what this report is and is not. */
export function statusText(type: ReviewTypeOrLegacy, lang: Lang): string {
  return L(lang, type === "legacy" ? T.statusLegacy : T.status);
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="label">{label}</dt>
      <dd className="break-words font-display text-[0.92rem]">{children}</dd>
    </div>
  );
}

/**
 * Plan 20 title block: the refined question as the H1, the question as typed, a metadata row (type, search date,
 * studies included, sources, language, review id), the automated / abstract-only status block, the language switch,
 * the actions and how the agent read the question. Counts use the display face (never the verified-number face).
 * The H1 and the typed question wrap only between Thai words (ThaiText, Plan 20 Task 7).
 */
export function TitleBlock({ review, result, type, lang, original, onLang, poolGap = null, offline }: {
  review: Review; result: ReviewResult; type: ReviewTypeOrLegacy; lang: Lang; original: Lang; onLang: (l: Lang) => void;
  /** meta-analysis without a pooled estimate: "none" (nothing qualified) or "failed" (the step did not complete) */
  poolGap?: "none" | "failed" | null; offline: boolean;
}) {
  const question = result.question;
  const text = lang === "en" && question?.english ? question.english : question;
  const typed = question?.original_topic || review.topic;
  const refined = text?.refined_question || (lang === "en" ? question?.english_topic : null) || typed;
  const date = reportDate(result.methods?.searched_at ?? review.started_at ?? review.created_at, lang);
  const sources = sourceNames(result.methods?.sources);
  const queries = result.queries?.length ?? 0;
  // Studies actually read (a card was extracted); papers that could not be read, and further reports of a trial
  // already counted (Plan 20 Task 10), are counted aside.
  const { studies: included, related, unread } = includedCounts(result.papers ?? []);
  return (
    <header aria-labelledby="h-title" className="grid gap-4">
      <h1 id="h-title" lang={fieldLang(refined, lang)} className="max-w-[44ch] text-[clamp(1.4rem,2.4vw,1.9rem)] leading-snug font-semibold break-words">
        <ThaiText>{refined}</ThaiText>
      </h1>
      {refined.trim() !== typed.trim() && (
        <p className="max-w-[65ch] text-[0.95rem] text-muted break-words" data-typed-question>
          {L(lang, T.typed)}: <span className="text-ink" lang={fieldLang(typed, lang)}><ThaiText>{typed}</ThaiText></span>
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-rule py-3 sm:grid-cols-3 lg:flex lg:flex-wrap" aria-label={L(lang, T.details)}>
        {type !== "legacy" && (
          <Meta label={L(lang, T.type)}>
            <Term k={TYPE_TERM[type]} lang={lang}>{REVIEW_TYPE_LABEL[type][lang]}</Term>
            {poolGap && <span data-not-pooled={poolGap} className="nw">{" "}{META_POOL_COPY[poolGap].chip[lang]}</span>}
          </Meta>
        )}
        {date && <Meta label={L(lang, T.searched)}>{date}</Meta>}
        <Meta label={L(lang, T.included)}>
          <span className="tabular-nums">{included}</span> {L(lang, T.studies(included))}
          {unread > 0 && (
            <span className="text-[0.82rem] text-muted" data-unread>
              {" "}{L(lang, T.unread(unread))}
            </span>
          )}
          {related > 0 && (
            <span className="block text-[0.82rem] text-muted" data-related-count>
              {L(lang, T.related(related))}
            </span>
          )}
        </Meta>
        {(sources.length > 0 || queries > 0) && (
          <Meta label={L(lang, T.sources)}>
            {sources.length ? sources.join(", ") : (
              <><span className="tabular-nums">{queries}</span> {L(lang, T.queriesOnly(queries))}</>
            )}
          </Meta>
        )}
        <Meta label={L(lang, T.language)}><span lang={original}>{LANGUAGE_NAME[original]}</span></Meta>
        <Meta label={L(lang, T.reviewId)}>
          <span className="font-code text-[0.85rem]" title={review.id}>{review.id.slice(0, 8)}</span>
        </Meta>
      </dl>

      <p className="grid gap-0.5 rounded-sm bg-info-bg px-3 py-2.5 text-[0.9rem]" data-status>
        <b className="font-display font-semibold">{statusText(type, lang)}</b>
        <span>{L(lang, type === "legacy" ? T.byAgentLegacy : T.byAgent)}</span>
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9rem] print:hidden">
        {!offline && (
          <details>
            <summary className={`${BUTTON} list-none`}>{L(lang, T.download)}</summary>
            <nav aria-label={L(lang, T.downloadNav)} className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <a href={`/r/${encodeURIComponent(review.id)}/report.html`} download className={LINK}>
                {L(lang, T.html)}
              </a>
              {([["md", "Markdown"], ["csv", "CSV"], ["json", "JSON"]] as const).map(([fmt, name]) => (
                <a key={fmt} href={exportUrl(review.id, fmt)} download className={LINK}>{name}</a>
              ))}
            </nav>
          </details>
        )}
        {!offline && <CopyLinkButton lang={lang} />}
        <button type="button" onClick={() => window.print()} className={BUTTON}>{L(lang, T.print)}</button>
        {original === "th" && result.synthesis_en && (
          <div role="group" aria-label={L(lang, T.reportLanguage)} className="ml-auto inline-flex shrink-0 rounded-sm border border-rule font-display text-sm">
            {(["th", "en"] as const).map((l) => (
              // each language names itself in its own script (and is spoken in it)
              <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => onLang(l)}
                className={`min-h-11 px-3 md:min-h-9 ${lang === l ? "bg-ink text-ground" : "text-ink"}`}>
                {LANGUAGE_NAME[l]}
              </button>
            ))}
          </div>
        )}
      </div>

      <QuestionDetails question={question} lang={lang} type={type} />
    </header>
  );
}
