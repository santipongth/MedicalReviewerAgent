"use client";

import { Fragment, type ReactNode } from "react";
import { isNonQuantitative } from "@/lib/charts-data";
import type { Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import { paperCounts, sourceRows } from "@/lib/prisma-flow";
import { extractionReading, modelName, reportDate } from "@/lib/report-view";
import { REVIEW_TYPE_LABEL, isGraded, type ReviewTypeOrLegacy } from "@/lib/review-type";
import { ROB_COLUMN, ROB_ORDER } from "@/lib/rob-summary";
import type { Review, ReviewResult } from "@/lib/types";
import { ThaiNodes } from "../ui/thai-text";
import { DisclosureChevron } from "../ui/disclosure-chevron";
import { READING } from "./report-parts";
import { SECTION_H2, SECTION_H3 } from "./report-nav";
import { fill, L, Lw } from "./text";

const M = RC.methods;

/** A count in running text: display face, tabular figures (never the verified-number face). */
function N({ children }: { children: number }) {
  return <span className="font-display tabular-nums">{children}</span>;
}

/** A model or version id: the code face (ui-monospace), which is not the verified-number face. */
function Code({ children }: { children: string }) {
  return <code className="font-code text-[0.85em] [overflow-wrap:anywhere]">{children}</code>;
}

type Line = [key: string, node: ReactNode];

/** Role names of backend/config/llm.yaml, as the report language says them; an unknown role keeps its key. */
function roleLabel(role: string, lang: Lang): string {
  const l = M.roles[role];
  return l ? L(lang, l) : role;
}

/** One Methods subsection: an H3 and its lines; lines with nothing to say (missing fields) are left out. */
function Part({ id, title, lines, children }: { id: string; title: ReactNode; lines: Line[]; children?: ReactNode }) {
  const shown = lines.filter(([, node]) => node != null && node !== false && node !== "");
  if (!shown.length && !children) return null;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-methods-part={id}>
      <h3 id={id} className={SECTION_H3}>{title}</h3>
      {shown.length > 0 && (
        <ul className={`grid max-w-[70ch] grid-cols-[minmax(0,1fr)] list-disc gap-1 pl-5 ${READING}`}>
          {shown.map(([key, node]) => <li key={key} data-methods-line={key}><ThaiNodes>{node}</ThaiNodes></li>)}
        </ul>
      )}
      {children}
    </div>
  );
}

const arr = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Methods (Plan 20 Task 4), from result.methods (Plan 20), result.question, result.stats/quality and review.options:
 * eligibility, sources and search date, queries, selection, extraction and verification, risk-of-bias approach,
 * synthesis, certainty, models and prompt version, and the automation limits. A line whose data the result does not
 * carry is left out, never filled in. Queries are body text in a ruled block (no monospace).
 */
export function MethodsSection({ review, result, type, lang }: {
  review: Review; result: ReviewResult; type: ReviewTypeOrLegacy; lang: Lang;
}) {
  const m = result.methods;
  const q = result.question;
  const s = result.stats ?? {};
  const quality = result.quality;
  const opts = review.options ?? {};
  const legacy = type === "legacy";
  const studies = (result.papers?.length ?? 0) > 0;
  const P = RC.parts;

  // --- Eligibility -------------------------------------------------------------------------------------------------
  const pcc = q?.framework === "PCC";
  const pico = q?.pico;
  const framework: [string, string | null | undefined][] = pcc
    ? [[L(lang, P.population), pico?.population], [L(lang, P.concept), q?.concept], [L(lang, P.context), q?.context]]
    : pico ? [[L(lang, P.population), pico.population], [L(lang, P.intervention), pico.intervention_or_exposure],
      [L(lang, P.comparator), pico.comparator], [L(lang, P.outcomes), pico.outcomes?.join(", ")]] : [];
  const frameworkShown = framework.filter(([, v]) => v && v.trim());
  const studyTypes = m ? m.eligibility.study_types : arr(opts.study_types);
  const yearFrom = m ? m.eligibility.year_from : int(opts.year_from);
  const yearKnown = !!m || int(opts.year_from) != null;
  const inclusion = m?.eligibility.inclusion_criteria ?? [];
  const exclusion = m?.eligibility.exclusion_criteria ?? [];
  const eligibility: Line[] = [
    ["framework", frameworkShown.length ? <>{pcc ? "PCC" : "PICO"}: {frameworkShown.map(([k, v], i) => (
      <span key={k}>{i > 0 && " · "}<b className="font-display font-semibold">{k}</b> <span lang={fieldLang(v, lang)}>{v}</span></span>
    ))}</> : null],
    ["study_types", studyTypes == null ? null : <>{L(lang, M.studyTypes)}: {studyTypes.length ? studyTypes.join(", ")
      : L(lang, M.anyDesign)}</>],
    ["year_from", !yearKnown ? null : yearFrom != null
      ? <>{L(lang, M.publishedFrom)} <N>{yearFrom}</N></>
      : L(lang, M.noYearLimit)],
    ["abstract", m ? fill(lang, M.abstractMin, { n: <N>{m.limits.min_abstract_chars}</N> }) : null],
    ["languages", m ? L(lang, M.languages) : null],
    ["inclusion", inclusion.length ? <>{L(lang, M.inclusion)}: <span lang={fieldLang(inclusion.join(" "), lang)}>{inclusion.join("; ")}</span></> : null],
    ["exclusion", exclusion.length ? <>{L(lang, M.exclusion)}: <span lang={fieldLang(exclusion.join(" "), lang)}>{exclusion.join("; ")}</span></> : null],
  ];

  // --- Sources and search ---------------------------------------------------------------------------------------------
  const searched = reportDate(m?.searched_at, lang);
  const finished = reportDate(review.finished_at, lang);
  const sources = sourceRows(m?.sources, lang);
  const queries = result.queries ?? [];
  const sourcesLines: Line[] = [
    ["searched_at", searched ? <>{L(lang, M.searchedOn)} {searched}</> : null],
    ["finished_at", finished ? <>{L(lang, M.finishedOn)} {finished}</> : null],
    ["sources", sources.length ? <>{L(lang, M.perSource)}:{" "}
      {sources.map((r, i) => <Fragment key={r.key}>{i > 0 && " · "}<span className="nw">{r.label} <N>{r.value}</N></span></Fragment>)}</> : null],
    ["found", s.found != null ? <>{L(lang, M.found)} <N>{s.found}</N></> : null],
  ];
  const queryList = queries.length ? (
    <ol className="grid max-w-[70ch] divide-y divide-rule rounded-sm border border-rule bg-ground" aria-label={L(lang, M.queries)} data-queries>
      {queries.map((qq, i) => (
        <li key={`${i}-${qq}`} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 px-3 py-1.5 text-[0.95rem] break-words">
          <span className="font-display text-muted tabular-nums">{i + 1}</span><span lang={fieldLang(qq, lang)}>{qq}</span>
        </li>
      ))}
    </ol>
  ) : null;
  const queriesBlock = queryList && (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
      <p className="label">{L(lang, M.queriesN(queries.length))}</p>
      {queries.length > 4 ? (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-display text-[0.92rem] font-semibold md:min-h-0">
            <DisclosureChevron />
            {L(lang, M.showQueries(queries.length))}
          </summary>
          <div className="mt-2">{queryList}</div>
        </details>
      ) : queryList}
    </div>
  );

  // --- Screening and selection --------------------------------------------------------------------------------------
  const cap = m?.limits.candidate_limit ?? int(opts.candidate_limit);
  const maxPapers = m?.limits.max_papers ?? int(opts.max_papers);
  const sc = m?.screening;
  const slrLike = type === "slr" || type === "meta_analysis";
  // Plan 21: with the requested N recorded, the line states N, S and A (and a shortfall, said here once); older results
  // keep the "at most N" line
  const counts = paperCounts(result.stats);
  const requestedLine = counts && counts.screened != null && counts.analysed != null
    ? <>{fill(lang, M.requested(counts.requested, counts.screened, counts.analysed), {
      n: <N>{counts.requested}</N>, s: <N>{counts.screened}</N>, a: <N>{counts.analysed}</N> })}
      {counts.shortfall && <span data-shortfall>{fill(lang, M.shortfall, { e: <N>{counts.shortfall.eligible}</N> })}</span>}</>
    : counts ? fill(lang, M.max(counts.requested), { n: <N>{counts.requested}</N> }) : null;
  const band = sc && { lo: <N>{sc.borderline[0]}</N>, hi: <N>{sc.borderline[1]}</N> };
  const selection: Line[] = [
    ["cap", cap != null ? fill(lang, M.cap, { n: <N>{cap}</N> }) : null],
    ["screen_model", sc?.model ? <>{L(lang, M.screenModel)} <Code>{modelName(sc.model)}</Code></> : null],
    ["second_vote", !sc ? null : sc.second_vote === "two_models"
      ? fill(lang, M.voteTwo, { ...band, model: sc.second_model ? <> (<Code>{modelName(sc.second_model)}</Code>)</> : null })
      : sc.second_vote === "same_model" ? fill(lang, M.voteSame, { ...band }) : L(lang, M.voteOff)],
    ["floor", sc ? fill(lang, sc.second_vote !== "off" ? M.floorVotes : M.floor, { n: <N>{sc.relevance_floor}</N> }) : null],
    ["designs", slrLike && studyTypes?.length ? L(lang, M.designs) : null],
    ["narrative", slrLike && m ? L(lang, M.narrative) : null],
    ["max", requestedLine ?? (maxPapers != null ? fill(lang, M.max(maxPapers), { n: <N>{maxPapers}</N> }) : null)],
    ["related", s.related_reports != null ? fill(lang, M.related(s.related_reports), { n: <N>{s.related_reports}</N> }) : null],
  ];

  // --- Extraction and verification ------------------------------------------------------------------------------------
  const reading = extractionReading(m);
  const ex = m?.extraction;
  const verified = quality?.numbers_verified;
  const total = quality?.numbers_total;
  const rate = quality?.verification_rate;
  const extraction: Line[] = [
    ["text", s.with_fulltext != null
      ? L(lang, M.fullTextEra)
      : ex?.text === "abstract" || !legacy ? L(lang, M.abstractOnly) : null],
    ["readers", reading.mode === "two_models"
      ? <>{L(lang, M.readersTwo)} (<Code>{reading.model ?? "?"}</Code>, <Code>{reading.second ?? "?"}</Code>)</>
      : reading.mode === "same_model"
        ? <>{L(lang, M.readersSame)} (<Code>{reading.model ?? "?"}</Code>)</>
        : reading.mode === "single" && reading.model
          ? <>{L(lang, M.readersOnce)} <Code>{reading.model}</Code></> : null],
    ["verify", ex == null ? null : ex.verify_quotes
      ? fill(lang, M.verify, { n: <N>{ex.quote_match_threshold}</N> })
      : L(lang, M.noVerify)],
    ["rate", total != null && verified != null ? fill(lang, M.rate, {
      verified: <N>{verified}</N>, total: <N>{total}</N>, rate: rate != null ? <> (<N>{Math.round(rate * 100)}</N>%)</> : null,
    }) : null],
  ];

  // --- Risk of bias, synthesis, certainty -----------------------------------------------------------------------------
  const rob: Line[] = type === "scoping"
    ? [["none", L(lang, M.robScoping)]]
    : [["judged", <>{L(lang, s.with_fulltext != null
        // a full-text-era result read some studies in full: the judgement came from whatever text was read
        ? M.robFullText : M.robAbstract)}{" "}
        {ROB_ORDER.map((k) => ROB_COLUMN[lang][k]).join(" / ")}</>],
      ["criteria", L(lang, M.robCriteria)],
      ["tool", L(lang, M.robTool)]];
  const themes = (result.papers ?? []).some((p) => isNonQuantitative(p.card_en ?? p.card));
  const pooling = m?.synthesis.pooling ?? null;
  const synthesis: Line[] = [
    ["approach", L(lang, type === "narrative" ? M.approachNarrative : type === "scoping" ? M.approachScoping : M.approach)],
    ["themes", themes ? L(lang, M.themes) : null],
    ["pooling", pooling ? fill(lang, M.pooling, { method: pooling }) : null],
    ["model", m?.synthesis.model ? <>{L(lang, M.synthesisModel)} <Code>{modelName(m.synthesis.model)}</Code></> : null],
  ];
  const graded = isGraded(type);
  const strength = result.synthesis?.evidence_strength;
  const certainty: Line[] = graded
    ? [["grading", strength == null && !legacy
      ? <>{L(lang, M.notGraded)}{result.synthesis?.evidence_rationale ? ` (${result.synthesis.evidence_rationale})` : ""}</>
      : <>{m?.synthesis.grading ?? "GRADE-lite"}: {L(lang, M.grading)}</>]]
    : [["none", type === "legacy" ? null : L(lang, M.noRating(REVIEW_TYPE_LABEL[type].th, REVIEW_TYPE_LABEL[type].en))]];

  // --- Models and versions --------------------------------------------------------------------------------------------
  // A second screening model exists only for a two-model vote (the contract nulls it otherwise; older data may not).
  const roles: [string, string | null | undefined][] = m
    ? [[roleLabel("screener", lang), m.screening.model],
      [roleLabel("screener_secondary", lang), m.screening.second_vote === "two_models" ? m.screening.second_model : null],
      [roleLabel("extractor", lang), m.extraction.model], [roleLabel("extractor_secondary", lang), m.extraction.second_model],
      [roleLabel("synthesizer", lang), m.synthesis.model]]
    : Object.entries(result.models ?? {}).map(([role, model]) => [roleLabel(role, lang), model]);
  const byModel = new Map<string, string[]>();
  for (const [role, model] of roles) {
    if (!model || model === "stub") continue;
    const name = modelName(model);
    byModel.set(name, [...(byModel.get(name) ?? []), role]);
  }
  const seconds = quality?.timings?.total;
  const models: Line[] = [
    ["roles", byModel.size ? <>{L(lang, M.models)}: {[...byModel].map(([model, rs], i) => (
      <span key={model}>{i > 0 && " · "}{rs.map((r, j) => (j > 0 && lang === "en" ? r.toLowerCase() : r)).join(", ")} <Code>{model}</Code></span>
    ))}</> : null],
    ["preset", result.llm_preset && result.llm_preset !== "stub" ? <>{L(lang, M.modelPreset)} <Code>{result.llm_preset}</Code></> : null],
    ["prompt", result.prompt_version ? <>{L(lang, M.promptVersion)} <Code>{result.prompt_version}</Code></> : null],
    ["time", seconds != null ? fill(lang, M.runTime, { n: <N>{Math.round(seconds)}</N> }) : null],
  ];

  return (
    <section aria-labelledby="h-method" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <h2 id="h-method" className={SECTION_H2}>{Lw(lang, M.h2)}</h2>
      <Part id="m-eligibility" title={Lw(lang, M.eligibility)} lines={eligibility} />
      <Part id="m-sources" title={Lw(lang, M.sources)} lines={sourcesLines}>{queriesBlock}</Part>
      <Part id="m-selection" title={Lw(lang, M.selection)} lines={selection} />
      {/* nothing was read, appraised or synthesised when no study was found: no method to report for those steps */}
      {studies && (
        <>
          <Part id="m-extraction" title={Lw(lang, M.extraction)} lines={extraction} />
          <Part id="m-rob" title={Lw(lang, M.rob)} lines={rob} />
          <Part id="m-synthesis" title={Lw(lang, M.synthesis)} lines={synthesis} />
          <Part id="m-certainty" title={Lw(lang, M.certainty)} lines={certainty} />
        </>
      )}
      <Part id="m-models" title={Lw(lang, M.modelsH3)} lines={models} />
      {!!result.external_context?.length && (
        <div className="grid gap-2 text-[0.9rem]" data-methods-part="m-external">
          <h3 id="m-external" className={SECTION_H3}>{Lw(lang, M.external)}</h3>
          <ul className="grid gap-2">
            {result.external_context.map((e, i) => (
              <li key={i} className="rounded-sm bg-ground p-3"><b className="font-display">{e.tool}</b> <span className="text-muted">{e.ok ? "" : L(lang, M.failed)}</span>
                <p className="break-words" lang={fieldLang(e.preview, lang)}>{e.preview}</p></li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-1.5 rounded-sm bg-info-bg px-4 py-3" data-methods-part="m-automation">
        <p className="font-display font-semibold">{L(lang, M.automation)}</p>
        <p className={`max-w-[70ch] ${READING}`}>
          {[L(lang, M.automatic), !legacy && L(lang, M.abstractsMissed)].filter(Boolean).join(" ")}
        </p>
        <p className="text-[0.85rem] text-muted" data-disclaimer>
          {L(lang, legacy ? M.disclaimerLegacy : M.disclaimer(REVIEW_TYPE_LABEL[type].th, REVIEW_TYPE_LABEL[type].en))}
        </p>
      </div>
    </section>
  );
}
