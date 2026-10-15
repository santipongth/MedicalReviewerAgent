"use client";

import { useSyncExternalStore } from "react";
import { exportUrl } from "@/lib/api";
import { howToCite, howToCiteParts } from "@/lib/citation";
import type { Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import type { ReviewTypeOrLegacy } from "@/lib/review-type";
import type { Review, ReviewResult } from "@/lib/types";
import { CopyTextButton } from "../ui/copy-text";
import { SECTION_H2 as H2, SECTION_H3 as H3 } from "./report-nav";
import { L, Lw } from "./text";

const C = RC.cite;

const DL = "inline-flex min-h-11 items-center font-display font-semibold text-primary underline underline-offset-2 md:min-h-0";

const noop = () => () => {};
/** The page's origin in the browser; null while rendering on the server (the citation then has no URL until hydrated). */
function useOrigin(): string | null {
  return useSyncExternalStore(noop, () => window.location.origin, () => null);
}

/** The refined question as the title block shows it (the H1). */
export function citedQuestion(review: Review, result: ReviewResult, lang: Lang): string {
  const q = result.question;
  const text = lang === "en" && q?.english ? q.english : q;
  return text?.refined_question || (lang === "en" ? q?.english_topic : null) || q?.original_topic || review.topic;
}

/**
 * The downloads as a labelled list (format and what each file holds; sizes are not known before the file is made, so
 * none is claimed).
 */
function Downloads({ id, lang }: { id: string; lang: Lang }) {
  const items: { href: string; name: string; ext: string; what: string }[] = [
    { href: `/r/${encodeURIComponent(id)}/report.html`, name: "HTML", ext: ".html", what: L(lang, C.html) },
    { href: exportUrl(id, "md"), name: "Markdown", ext: ".md", what: L(lang, C.md) },
    { href: exportUrl(id, "csv"), name: "CSV", ext: ".csv", what: L(lang, C.csv) },
    { href: exportUrl(id, "json"), name: "JSON", ext: ".json", what: L(lang, C.json) },
  ];
  return (
    <ul aria-label={L(lang, C.list)} className="grid gap-1 text-[0.9rem]">
      {items.map((d) => (
        <li key={d.ext} className="flex flex-wrap items-baseline gap-x-2">
          <a href={d.href} download className={DL}>{d.name} <span className="ml-1 font-code text-[0.85em] font-normal">({d.ext})</span></a>
          <span className="text-muted">{d.what}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Section 14 (Plan 20 Task 6): how to cite this report, and the downloads. The date is when the review finished (or was
 * created), never the viewing time. The offline file keeps only how to cite, without a URL (it has no address).
 */
export function DownloadsAndCite({ review, result, type, lang, offline }: {
  review: Review; result: ReviewResult; type: ReviewTypeOrLegacy; lang: Lang; offline: boolean;
}) {
  const origin = useOrigin();
  const url = offline || !origin ? null : `${origin}/r/${encodeURIComponent(review.id)}`;
  const cite = howToCite({ question: citedQuestion(review, result, lang), type, id: review.id,
    date: review.finished_at ?? review.created_at, url, lang });
  const citeParts = howToCiteParts({ question: citedQuestion(review, result, lang), type, id: review.id,
    date: review.finished_at ?? review.created_at, url, lang });
  const citeTitle = Lw(lang, C.title);
  const R = RC.refs;
  const citeBlock = (
    <div className="grid gap-2">
      <p data-how-to-cite className="max-w-[75ch] rounded-sm border border-rule bg-ground px-3 py-2.5 text-[0.95rem] leading-[1.7] break-words"
        lang={fieldLang(cite, lang)}>
        {citeParts.map((s, i) => (s.isolate ? <bdi key={i}>{s.text}</bdi> : s.text))}
      </p>
      <CopyTextButton text={cite} label={L(lang, R.copy)}
        name={L(lang, C.name)} copied={L(lang, R.copied)}
        failed={L(lang, R.copyFailed)}
        boxLabel={L(lang, C.box)} />
    </div>
  );
  if (offline) {
    return (
      <section aria-labelledby="h-downloads" className="grid gap-3">
        <h2 id="h-downloads" className={H2}>{citeTitle}</h2>
        {citeBlock}
      </section>
    );
  }
  return (
    <section aria-labelledby="h-downloads" className="grid gap-6">
      <h2 id="h-downloads" className={H2}>{Lw(lang, C.h2)}</h2>
      <div className="grid gap-3">
        <h3 id="cite-report" className={H3}>{citeTitle}</h3>
        {citeBlock}
      </div>
      <div className="grid gap-3 print:hidden">
        <h3 id="download-files" className={H3}>{Lw(lang, C.downloads)}</h3>
        <Downloads id={review.id} lang={lang} />
      </div>
    </section>
  );
}
