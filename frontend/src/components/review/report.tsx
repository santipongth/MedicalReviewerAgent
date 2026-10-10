"use client";

import Link from "next/link";
import { Fragment, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { exportUrl } from "@/lib/api";
import { conceptTree } from "@/lib/concept-map";
import { emptyFilters, filterPapers, isFiltered, isPooled, themePapers, type Filters } from "@/lib/charts-data";
import { EMPTY_MAP, evidenceMap } from "@/lib/evidence-map";
import type { TermKey } from "@/lib/glossary";
import type { Lang } from "@/lib/i18n";
import { REVIEW_TYPE_LABEL, SECTIONS_BY_TYPE, isMetaNotPooled, reviewTypeOf, showsRiskOfBias, showsSection } from "@/lib/review-type";
import { Term } from "../ui/term";
import type { ComparisonRow, Paper, Review, ReviewType } from "@/lib/types";
import { BottomLine } from "./bottom-line";
import { Charts } from "./charts";
import { CitationNetworkSection } from "./citation-network";
import { ConceptMapSection } from "./concept-map";
import { EvidenceMapSection } from "./evidence-map";
import { LitMatrixSection } from "./lit-matrix";
import { MetaAnalysisSection } from "./meta-analysis";
import { FilterBar, FilterStatus } from "./filter-bar";
import { ClaimsPanel, ComparisonMatrix, MatrixLegend, PaperList, QualityNote, QuestionDetails } from "./report-parts";
import { ReportNav, SECTION_H2 as H2, type NavItem } from "./report-nav";
import { RailDrawer } from "./rail-drawer";
import { SourceRail } from "./source-rail";
import { L } from "./text";

const TYPE_TERM: Record<ReviewType, TermKey> = {
  narrative: "narrativeReview", slr: "slr", scoping: "scopingReview", meta_analysis: "metaAnalysis",
};

const DL = "inline-flex min-h-11 items-center font-display font-semibold text-primary underline underline-offset-2 md:min-h-0";

type Selection = { ref: string; outcome?: string };

/** Map a matrix cell to the paper outcome it came from (by finding text, then by direction, then the first). */
function outcomeFor(paper: Paper | undefined, row: ComparisonRow, ref: string): string | undefined {
  const cell = row.cells.find((c) => c.ref === ref);
  const en = paper?.card_en ?? paper?.card;
  const shown = paper?.card ?? en;
  if (!cell || !en || !shown) return undefined;
  const idx = [shown, en].map((c) => c.outcomes.findIndex((o) => o.result === cell.finding)).find((i) => i >= 0)
    ?? -1;
  const byDir = en.outcomes.findIndex((o) => o.direction === cell.direction);
  const i = idx >= 0 ? idx : byDir >= 0 ? byDir : 0;
  return en.outcomes[i]?.outcome;
}

/** The report bench: reading column (question, summary, matrix, claims, charts, papers) + source rail. */
/** offline: rendered inside a downloaded HTML file (no links back to the service). */
export function Report({ review, offline = false }: { review: Review; offline?: boolean }) {
  const result = useMemo(() => review.result ?? {}, [review.result]);
  const original = (result.language ?? review.language ?? "th") as Lang;
  const [lang, setLang] = useState<Lang>(original);
  const showEn = lang === "en" && original === "th";
  const synthesis = (showEn ? result.synthesis_en : result.synthesis) ?? result.synthesis ?? { executive_summary: result.summary ?? "" };
  const papers = useMemo(() => result.papers ?? [], [result.papers]);
  const byRef = useMemo(() => new Map(papers.map((p) => [p.ref, p])), [papers]);
  const refs = useMemo(() => new Set(papers.map((p) => p.ref)), [papers]);
  const pooledRefs = useMemo(() => new Set(papers.filter(isPooled).map((p) => p.ref)), [papers]);
  const rows = useMemo(() => (synthesis.comparison?.length ? synthesis.comparison : showEn ? result.synthesis?.comparison ?? [] : []), [synthesis.comparison, showEn, result.synthesis?.comparison]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const visible = useMemo(() => filterPapers(papers, filters), [papers, filters]);
  const matrixRefs = useMemo(() => visible.filter((p) => rows.some((r) => r.cells.some((c) => c.ref === p.ref))).map((p) => p.ref), [visible, rows]);
  const visibleRows = useMemo(() => rows.filter((r) => r.cells.some((c) => matrixRefs.includes(c.ref))), [rows, matrixRefs]);
  const type = reviewTypeOf(result);
  const notPooled = isMetaNotPooled(result);
  const map =useMemo(() => (showsSection(type, "evidence_map") ? evidenceMap(visible, rows, lang) : EMPTY_MAP), [type, visible, rows, lang]);
  // Built from the filtered papers, like the lit matrix and the evidence map; null where the type has no concept map.
  const tree = useMemo(
    () => (showsSection(type, "concept_map") ? conceptTree({ ...result, papers: visible }, lang, type) : null),
    [type, result, visible, lang],
  );
  const firstWithCard = papers.find((p) => p.card)?.ref;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const active = selection ?? (firstWithCard ? { ref: firstWithCard } : null);

  const railHeading = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const pressed = useRef<HTMLElement | null>(null);

  /** Safari (iOS and macOS) does not focus a tapped button, so remember what was pressed as the fallback trigger. */
  function notePress(e: { target: EventTarget | null }) {
    const el = e.target instanceof Element ? e.target.closest("button,a,[tabindex]") : null;
    pressed.current = el instanceof HTMLElement ? el : null;
  }

  function select(ref: string, outcome?: string) {
    const focused = document.activeElement;
    returnFocus.current = focused instanceof HTMLElement && focused !== document.body ? focused : pressed.current;
    setSelection({ ref, outcome });
    setDrawerOpen(true);
  }

  const hasPapers = papers.length > 0;
  const hasClaims = showsSection(type, "claims") && !!(synthesis.consensus?.length || synthesis.conflicts?.length);
  const hasMatrix = showsSection(type, "findings") && rows.length > 0;
  const hasCharts = hasPapers && (showsSection(type, "forest") || showsSection(type, "prisma"));
  const hasLitMatrix = showsSection(type, "lit_matrix") && papers.length > 0;
  const litMatrix = hasLitMatrix && (
    <LitMatrixSection papers={visible} allPapers={papers} lang={lang} type={type} onSelect={select} reviewId={review.id} offline={offline}
      citations={result.citations ?? null} />
  );
  // Plan 14b: drawn only when the citation step ran (result.citations is null for legacy results and skipped steps).
  const citations = result.citations ?? null;
  const hasCitations = showsSection(type, "citations") && !!citations && hasPapers;
  const hasConceptMapSection = !!tree && tree.leaves > 0;
  const conceptMap = tree && hasConceptMapSection && <ConceptMapSection tree={tree} lang={lang} onSelect={select} />;
  const hasEvidenceMap = showsSection(type, "evidence_map") && (map.byConcept.rows.length > 0 || map.byYear.rows.length > 0);
  const filterStatus = <FilterStatus filters={filters} onChange={setFilters} shown={visible.length} total={papers.length} lang={lang} />;
  // Sections after the findings, in the order SECTIONS_BY_TYPE declares them (forest and prisma share Charts).
  // A meta review with no papers renders the "Try this" block and no section nav, like every other type: nothing could be
  // pooled or excluded, and an empty pooled section (with its banner) would only repeat that there are no studies.
  const hasMeta = showsSection(type, "meta") && hasPapers;
  // The pool's outcome is an English matrix row: directions come from the English rows (the shown ones for an English review).
  const metaRows = result.synthesis_en?.comparison?.length ? result.synthesis_en.comparison : result.synthesis?.comparison ?? [];
  const tail: Record<"evidence_map" | "lit_matrix" | "concept_map" | "citations" | "charts" | "meta", { nav: NavItem; show: boolean; node: ReactNode }> = {
    citations: { nav: { id: "h-citations", label: L(lang, "เครือข่ายการอ้างอิง", "Citation network") }, show: hasCitations,
      node: hasCitations && citations && <CitationNetworkSection citations={citations} papers={visible} lang={lang} onSelect={select} /> },
    meta: { nav: { id: "h-meta", label: notPooled ? L(lang, "รวมผลไม่ได้", "Not pooled") : L(lang, "ค่ารวม", "Pooled") }, show: hasMeta,
      node: hasMeta && (
        <MetaAnalysisSection meta={result.meta_analysis} papers={papers} rows={metaRows} lang={lang} english={lang === "en"}
          filtered={isFiltered(filters)} quality={result.quality} onSelect={select} />
      ) },
    evidence_map: { nav: { id: "h-evidence-map", label: L(lang, "แผนที่หลักฐาน", "Evidence map") }, show: hasEvidenceMap,
      node: hasEvidenceMap && <EvidenceMapSection map={map} lang={lang} /> },
    lit_matrix: { nav: { id: "h-litmatrix", label: L(lang, "ตารางงานวิจัย", "Literature matrix") }, show: hasLitMatrix, node: litMatrix },
    concept_map: { nav: { id: "h-map", label: L(lang, "แผนที่ความรู้", "Concept map") }, show: hasConceptMapSection, node: conceptMap },
    charts: { nav: { id: "h-charts", label: L(lang, "แผนภาพ", "Charts") }, show: hasCharts,
      node: hasCharts && (
        <div className="grid gap-3">
          {filterStatus}
          <Charts result={result} papers={visible} lang={lang} onSelect={select} />
        </div>
      ) },
  };
  const tailOrder = [...new Set(SECTIONS_BY_TYPE[type].flatMap((id) =>
    id === "forest" || id === "prisma" ? ["charts" as const]
      : id === "evidence_map" || id === "lit_matrix" || id === "concept_map" || id === "meta" || id === "citations" ? [id] : []))];
  const tailShown = tailOrder.filter((k) => tail[k].show);
  const navItems: NavItem[] = [
    { id: "h-summary", label: L(lang, "สรุป", "Summary") },
    ...(hasClaims ? [{ id: "h-claims", label: L(lang, "จุดตรงกัน/ขัดกัน", "Agree/conflict") }] : []),
    ...(hasMatrix ? [{ id: "h-matrix", label: L(lang, "ผลแต่ละการศึกษา", "Findings") }] : []),
    ...tailShown.map((k) => tail[k].nav),
    ...(synthesis.research_gaps?.length ? [{ id: "h-gaps", label: L(lang, "สิ่งที่ยังไม่รู้", "Gaps") }] : []),
    ...(hasPapers ? [{ id: "h-papers", label: L(lang, "งานวิจัยที่อ่าน", "Papers") }] : []),
    { id: "h-method", label: offline ? L(lang, "วิธีทำ", "Method") : L(lang, "ดาวน์โหลด", "Downloads") },
  ];
  const filterBar = papers.length > 1
    ? <FilterBar papers={papers} filters={filters} onChange={setFilters} shown={visible.length} lang={lang} showRisk={showsRiskOfBias(type)} /> : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 pt-8" onPointerDownCapture={notePress} onClickCapture={notePress}
      style={offline ? ({ "--header-h": "0px" } as CSSProperties) : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="label break-words">{review.topic}</span>
          {type !== "legacy" && (
            <span className="label rounded-sm bg-rail px-2 py-1">
              <Term k={TYPE_TERM[type]} lang={lang}>{REVIEW_TYPE_LABEL[type][lang]}</Term>
              {notPooled && <span data-not-pooled>{" "}{L(lang, "(รวมผลไม่ได้)", "(not pooled)")}</span>}
              {" · "}{L(lang, "อัตโนมัติ · อ่านเฉพาะบทคัดย่อ", "automated · abstracts only")}
            </span>
          )}
        </div>
        {original === "th" && result.synthesis_en && (
          <div role="group" aria-label="ภาษา" className="inline-flex rounded-sm border border-rule font-display text-sm">
            {(["th", "en"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}
                className={`px-3 py-1 ${lang === l ? "bg-ink text-ground" : "text-ink"}`}>
                {l === "th" ? "ภาษาไทย" : "English"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`grid grid-cols-[minmax(0,1fr)] rounded-sm border border-rule bg-surface ${hasPapers ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : ""}`}>
        <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-8 p-5 sm:p-8 ${hasPapers ? "lg:border-r lg:border-rule" : ""}`}>
          {hasPapers && <ReportNav items={navItems} label={L(lang, "ในรายงานนี้", "In this report")} />}
          <BottomLine id={review.id} question={result.question} topic={review.topic} synthesis={synthesis} result={result}
            papers={papers} lang={lang} offline={offline} onSelect={select} refs={refs} />
          <QuestionDetails question={result.question} lang={lang} type={type} />

          {!hasPapers && (
            <section aria-labelledby="h-next" className="grid gap-3">
              <h2 id="h-next" className={H2}>{L(lang, "ลองแบบนี้", "Try this")}</h2>
              <ul className="grid list-disc gap-1.5 pl-5 text-[0.95rem]">
                <li>{L(lang, "ใช้ชื่อยาหรือโรคเป็นภาษาอังกฤษ เช่น metformin, colorectal cancer", "Use the English drug or disease name, e.g. metformin, colorectal cancer")}</li>
                <li>{L(lang, "ถามให้กว้างขึ้น หรือเอาเงื่อนไขปีและชนิดงานวิจัยออก", "Ask a broader question, or remove the year and study-type filters")}</li>
              </ul>
              <Link href="/" className="w-fit rounded-sm border border-primary bg-primary px-4 py-2 font-display font-semibold text-on-primary no-underline hover:brightness-110">
                {L(lang, "ถามคำถามใหม่", "Ask a new question")}
              </Link>
            </section>
          )}

          {hasClaims && (
            <section aria-labelledby="h-claims" className="grid gap-4">
              <h2 id="h-claims" className={H2}>{L(lang, "จุดที่ตรงกันและขัดกัน", "Where studies agree and conflict")}</h2>
              <ClaimsPanel consensus={synthesis.consensus ?? []} conflicts={synthesis.conflicts ?? []} lang={lang} onSelect={select} refs={refs} />
            </section>
          )}

          {!hasMatrix && filterBar}

          {hasMatrix && (
            <section aria-labelledby="h-matrix" className="grid grid-cols-[minmax(0,1fr)] gap-3">
              <h2 id="h-matrix" className={H2}>{L(lang, "ผลแต่ละการศึกษา", "Findings by study")}</h2>
              {filterBar}
              {visibleRows.length ? <ComparisonMatrix rows={visibleRows} refs={matrixRefs} papers={papers} lang={lang} onSelect={select} selected={active ?? undefined}
                pooledRefs={pooledRefs}
                outcomeOf={(row, ref) => outcomeFor(byRef.get(ref), row, ref)} /> : <p className="text-[0.9rem] text-muted">{L(lang, "ไม่มีงานวิจัยที่ตรงกับตัวกรอง", "No studies match the filters")}</p>}
              <MatrixLegend lang={lang} themes={themePapers(papers).length > 0} />
            </section>
          )}

          {tailShown.map((k) => <Fragment key={k}>{tail[k].node}</Fragment>)}

          {!!synthesis.research_gaps?.length && (
            <section aria-labelledby="h-gaps" className="grid gap-2">
              <h2 id="h-gaps" className={H2}>{L(lang, "สิ่งที่ยังไม่รู้", "Research gaps")}</h2>
              <ul className="list-disc pl-5 text-[0.95rem]">{synthesis.research_gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </section>
          )}

          {hasPapers && (
            <section aria-labelledby="h-papers" className="grid gap-2">
              <h2 id="h-papers" className={H2}>{L(lang, "งานวิจัยที่อ่าน", "Papers read")}</h2>
              {filterStatus}
              <PaperList papers={visible} lang={lang} onSelect={select} selectedRef={active?.ref} type={type} />
            </section>
          )}

          <section aria-labelledby="h-method" className="grid gap-4">
            <h2 id="h-method" className={H2}>{offline ? L(lang, "วิธีทำ", "Method") : L(lang, "วิธีทำและดาวน์โหลด", "Method and downloads")}</h2>
            <QualityNote quality={result.quality} stats={result.stats} lang={lang} preset={result.llm_preset} />
            {!!result.external_context?.length && (
              <div className="grid gap-2 text-[0.9rem]">
                <h3 className="font-semibold">{L(lang, "ข้อมูลประกอบจากเครื่องมือภายนอก", "Background from external tools")}</h3>
                <ul className="grid gap-2">
                  {result.external_context.map((e, i) => (
                    <li key={i} className="rounded-sm bg-ground p-3"><b className="font-display">{e.tool}</b> <span className="text-muted">{e.ok ? "" : L(lang, "(ล้มเหลว)", "(failed)")}</span><p className="break-words">{e.preview}</p></li>
                  ))}
                </ul>
              </div>
            )}
            {!offline && (
              <ul aria-label={L(lang, "ดาวน์โหลดรีวิว", "Download this review")} className="flex flex-wrap gap-x-4 gap-y-1 text-[0.9rem]">
                <li><a href={`/r/${encodeURIComponent(review.id)}/report.html`} download className={DL}>{L(lang, "HTML (เปิดได้ออฟไลน์)", "HTML (works offline)")}</a></li>
                {([["md", "Markdown"], ["csv", "CSV"], ["json", "JSON"]] as const).map(([fmt, name]) => (
                  <li key={fmt}><a href={exportUrl(review.id, fmt)} download className={DL}>{name}</a></li>
                ))}
              </ul>
            )}
            <p className="text-[0.8rem] text-muted">
              {type === "legacy"
                ? L(lang, "การทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติ ไม่ใช่คำแนะนำทางการแพทย์", "Automated rapid literature review; not medical advice.")
                : L(lang, `${REVIEW_TYPE_LABEL[type].th}แบบเร่งด่วนโดยอัตโนมัติ อ่านเฉพาะบทคัดย่อ ไม่ใช่คำแนะนำทางการแพทย์`,
                  `Automated rapid ${REVIEW_TYPE_LABEL[type].en.toLowerCase()} from abstracts only; not medical advice.`)}
            </p>
          </section>
        </div>

        {hasPapers && (
          <RailDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} headingId={railHeading} returnFocus={returnFocus}>
            <SourceRail paper={active ? byRef.get(active.ref) ?? null : null} outcome={active?.outcome} lang={lang}
              onClose={() => setDrawerOpen(false)} headingId={railHeading} visible={drawerOpen} type={type} />
          </RailDrawer>
        )}
      </div>
    </div>
  );
}
