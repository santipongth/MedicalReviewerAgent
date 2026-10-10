"use client";

import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import { RC } from "@/lib/i18n-report";
import { extractionReading, modelsUsed } from "@/lib/report-view";
import { isGraded, type ReviewTypeOrLegacy } from "@/lib/review-type";
import type { ReviewResult } from "@/lib/types";
import { READING } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { fill, L, Lw } from "./text";

const M = RC.limits;

/** A count in running text: display face, tabular figures (never the verified-number face). */
function N({ children }: { children: number }) {
  return <span className="font-display tabular-nums">{children}</span>;
}

function Code({ children }: { children: string }) {
  return <code className="font-code text-[0.85em] [overflow-wrap:anywhere]">{children}</code>;
}

/** The cap on what was screened and analysed, from the real counts; parts with no count are left out. */
function capText(result: ReviewResult, lang: Lang): ReactNode {
  const s = result.stats ?? {};
  const lim = result.methods?.limits;
  const pool = s.with_abstract ?? s.unique ?? s.found;
  const screened = s.candidates ?? s.screened;
  const related = s.related_reports ?? 0;
  if (screened == null && s.selected == null) return null;
  const max = lim ? fill(lang, M.max, { n: <N>{lim.max_papers}</N> }) : null;
  return (
    <>
      {screened != null && fill(lang, M.screened, {
        n: <N>{screened}</N>,
        cap: lim ? fill(lang, M.cap, { n: <N>{lim.candidate_limit}</N> }) : null,
        pool: pool != null ? fill(lang, s.with_abstract != null ? M.poolAbstract : M.poolFound, { n: <N>{pool}</N> }) : null,
      })}
      {screened != null && s.selected != null && L(lang, M.sep)}
      {s.selected != null && !related && fill(lang, M.analysed(s.selected), { n: <N>{s.selected}</N>, max })}
      {/* `selected` counts reports; with further reports of a trial (Plan 20 Task 10) the studies are the difference,
          as in the PRISMA flow (subtracted once, from the stats) */}
      {s.selected != null && related > 0 && fill(lang, M.analysedRelated(s.selected, s.selected - related, related), {
        selected: <N>{s.selected}</N>, studies: <N>{Math.max(0, s.selected - related)}</N>, related: <N>{related}</N>, max,
      })}
    </>
  );
}

function readingText(result: ReviewResult, lang: Lang): ReactNode {
  const r = extractionReading(result.methods);
  const uncertain = result.quality?.papers_uncertain ?? 0;
  switch (r.mode) {
    case "two_models":
      return <>{L(lang, M.twoModels)} (<Code>{r.model ?? "?"}</Code>, <Code>{r.second ?? "?"}</Code>){" "}
        {L(lang, M.flagged)}{uncertain > 0 && <> (<N>{uncertain}</N> {L(lang, M.studies(uncertain))})</>}</>;
    case "same_model":
      return <>{L(lang, M.sameModel)} (<Code>{r.model ?? "?"}</Code>){" "}
        {L(lang, M.notIndependent)}{uncertain > 0 && <>; {L(lang, M.differed)} <N>{uncertain}</N> {L(lang, M.studies(uncertain))}</>}</>;
    case "single":
      return L(lang, M.single);
    default:
      return result.quality?.agreement_mean != null || uncertain > 0 ? L(lang, M.unknownSecond) : null;
  }
}

function screeningVoteText(result: ReviewResult, lang: Lang): ReactNode {
  const vote = result.methods?.screening.second_vote;
  if (vote === "two_models") return L(lang, M.voteTwo);
  if (vote === "same_model") return L(lang, M.voteSame);
  if (vote === "off") return L(lang, M.voteOff);
  return null;
}

/**
 * Limitations (Plan 20): fixed, honest text plus this review's own data: abstract-only reading, the screening and
 * analysis caps with the real counts, LLM screening and extraction, the models, what the search does not cover,
 * publication bias, and how many readings each study had (from the methods, never assumed independent).
 */
export function Limitations({ result, type, lang }: { result: ReviewResult; type: ReviewTypeOrLegacy; lang: Lang }) {
  const s = result.stats ?? {};
  const fullTextEra = s.with_fulltext != null; // results stored before abstract-only reading
  const models = modelsUsed(result);
  const pooled = !!result.meta_analysis?.pools?.length;
  // Only a review that was actually graded claims a GRADE-lite certainty (legacy results keep their "very low" fallback).
  const graded = isGraded(type) && (type === "legacy" || result.synthesis?.evidence_strength != null);
  const items: [string, ReactNode][] = [
    ["text", fullTextEra
      ? L(lang, M.fullTextEra)
      : <>{L(lang, M.abstractOnly)}{s.no_abstract ? fill(lang, M.noAbstract, { n: <N>{s.no_abstract}</N> }) : null}</>],
    ["cap", capText(result, lang)],
    ["llm", L(lang, M.llm)],
    ["models", models.length ? <>{L(lang, M.models)}: {models.map((m, i) => <span key={m}>{i > 0 && ", "}<Code>{m}</Code></span>)}
      {result.llm_preset && result.llm_preset !== "stub" && <> ({L(lang, M.preset)} <Code>{result.llm_preset}</Code>)</>}</> : null],
    ["reading", readingText(result, lang)],
    ["vote", screeningVoteText(result, lang)],
    ["coverage", L(lang, M.coverage)],
    ["pubbias", L(lang, M.pubBias) + (pooled ? L(lang, M.noFunnel) : "")],
    ["appraisal", L(lang, type === "scoping" ? M.appraisalScoping : M.appraisal)],
    ["certainty", graded
      ? L(lang, M.certainty)
      : L(lang, M.notGraded) + (isGraded(type) && result.synthesis?.evidence_rationale ? ` (${result.synthesis.evidence_rationale})` : "")],
    ["pooled", pooled ? L(lang, M.pooled) : null],
  ];
  return (
    <section aria-labelledby="h-limitations" className="grid gap-3">
      <h2 id="h-limitations" className={SECTION_H2}>{Lw(lang, M.h2)}</h2>
      <ul className={`grid max-w-[70ch] list-disc gap-1.5 pl-5 ${READING}`}>
        {items.filter(([, node]) => node != null && node !== "").map(([key, node]) => <li key={key} data-limitation={key}>{node}</li>)}
      </ul>
    </section>
  );
}
