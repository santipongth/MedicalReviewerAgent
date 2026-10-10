"use client";

import Link from "next/link";
import { Fragment, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { conceptTree } from "@/lib/concept-map";
import { emptyFilters, filterPapers, isFiltered, isPooled, themePapers, type Filters } from "@/lib/charts-data";
import { EMPTY_MAP, evidenceMap } from "@/lib/evidence-map";
import type { Lang } from "@/lib/i18n";
import { robSummary } from "@/lib/rob-summary";
import { cellOutcome, keyFindingViews, sameModelReadings, sofRows, type OutcomeContext } from "@/lib/report-view";
import {
  isGraded, metaPoolGap, reportLayout, reviewTypeOf, showsRiskOfBias, showsSection,
  type BlockId, type TopSectionId,
} from "@/lib/review-type";
import type { ComparisonRow, Paper, Review } from "@/lib/types";
import { BottomLine } from "./bottom-line";
import { chartsContent } from "@/lib/charts-content";
import { Charts } from "./charts";
import { CitationNetworkSection } from "./citation-network";
import { ConceptMapSection } from "./concept-map";
import { EvidenceMapSection } from "./evidence-map";
import { KeyFindings } from "./key-findings";
import { Limitations } from "./limitations";
import { LitMatrixSection } from "./lit-matrix";
import { MetaAnalysisSection } from "./meta-analysis";
import { FilterBar, FilterStatus } from "./filter-bar";
import { CitedText, ClaimsPanel, ComparisonMatrix, MatrixLegend, READING, SameModelReadings } from "./report-parts";
import { ReferencesSection } from "./references";
import { DownloadsAndCite } from "./report-cite";
import { MethodsSection } from "./methods-section";
import { PrismaFlow } from "./prisma-flow";
import { RobSummarySection } from "./rob-summary";
import { ReportNav, ReportToc, SECTION_H2 as H2, SectionHeading, Subsections, type NavItem } from "./report-nav";
import { RailDrawer } from "./rail-drawer";
import { SofTable } from "./sof-table";
import { SourceRail } from "./source-rail";
import { TitleBlock } from "./title-block";
import { L } from "./text";

type Selection = { ref: string; outcome?: string };

/** Map a matrix cell to the paper outcome it came from (by finding text, then by direction, then the first). */
function outcomeFor(paper: Paper | undefined, row: ComparisonRow, ref: string): string | undefined {
  return cellOutcome(paper, row, ref)?.en.outcome;
}

/** Top-level sections: anchor id, short table-of-contents label and the H2 of a group section. */
const TOP: Record<Exclude<TopSectionId, "title">, { id: string; nav: [string, string]; h2?: [string, string] }> = {
  bottom_line: { id: "h-answer", nav: ["คำตอบ", "Answer"] },
  key_findings: { id: "h-key-findings", nav: ["ผลสำคัญ", "Key findings"] },
  sof: { id: "h-sof", nav: ["ตารางสรุปผล", "Summary table"] },
  selection: { id: "h-selection", nav: ["การคัดเลือก", "Selection"], h2: ["การคัดเลือกงานวิจัย", "Study selection"] },
  characteristics: { id: "h-characteristics", nav: ["ลักษณะงานวิจัย", "Studies"], h2: ["ลักษณะของงานวิจัยที่รวบรวม", "Study characteristics"] },
  results: { id: "h-results", nav: ["ผลลัพธ์", "Results"], h2: ["ผลลัพธ์ตามผลลัพธ์ที่ศึกษา", "Results by outcome"] },
  rob: { id: "h-rob", nav: ["ความเสี่ยงอคติ", "Risk of bias"] },
  consistency: { id: "h-claims", nav: ["ตรงกัน/ขัดกัน", "Agree/conflict"], h2: ["จุดที่ตรงกันและขัดกัน", "Where studies agree and conflict"] },
  landscape: { id: "h-landscape", nav: ["ภาพรวมความรู้", "Landscape"], h2: ["ภาพรวมขององค์ความรู้", "Evidence landscape"] },
  limitations: { id: "h-limitations", nav: ["ข้อจำกัด", "Limitations"] },
  gaps: { id: "h-gaps", nav: ["สิ่งที่ยังไม่รู้", "Gaps"] },
  discussion: { id: "h-discussion", nav: ["อภิปราย", "Discussion"] },
  methods: { id: "h-method", nav: ["วิธีการ", "Methods"] },
  references: { id: "h-papers", nav: ["อ้างอิง", "References"] },
  downloads: { id: "h-downloads", nav: ["ดาวน์โหลด", "Downloads"] },
};
/** The offline file has no downloads: its last section is only how to cite the report. */
const OFFLINE_DOWNLOADS_NAV: [string, string] = ["อ้างอิงรายงาน", "Cite"];

/**
 * The report bench (Plan 20 answer-first order, from SECTIONS_BY_TYPE): title block, bottom line, key findings, summary
 * of findings, study selection, characteristics, results, consistency, landscape, limitations, gaps, discussion,
 * methods, references and downloads; a left table of contents from 1280px, the source rail on the right.
 * offline: rendered inside a downloaded HTML file (no links back to the service).
 */
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
  const poolGap = metaPoolGap(result);
  const map = useMemo(() => (showsSection(type, "evidence_map") ? evidenceMap(visible, rows, lang) : EMPTY_MAP), [type, visible, rows, lang]);
  // Built from the filtered papers, like the lit matrix and the evidence map; null where the type has no concept map.
  const tree = useMemo(
    () => (showsSection(type, "concept_map") ? conceptTree({ ...result, papers: visible }, lang, type) : null),
    [type, result, visible, lang],
  );
  // The rail starts empty (Plan 20): nothing is pre-selected until the reader picks a number or a study.
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const active = selection;

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

  /**
   * The rail's "see in the references" link (Plan 20 Task 6): the anchor jumps to `#ref-Pn`, which takes focus; the
   * drawer (narrow screens) closes and hands focus to that reference too, instead of the code that opened it.
   */
  function toReference(ref: string) {
    const target = document.getElementById(`ref-${ref}`);
    if (target) returnFocus.current = target;
    setDrawerOpen(false);
  }

  // Key findings and the summary of findings use every paper (the filters narrow the tables and charts below them).
  const ctx = useMemo<OutcomeContext>(() => ({
    rows, enRows: result.synthesis_en?.comparison ?? [], papers, meta: result.meta_analysis, lang,
  }), [rows, result.synthesis_en?.comparison, papers, result.meta_analysis, lang]);
  const findings = useMemo(() => keyFindingViews(synthesis.key_findings ?? [], result.synthesis_en?.key_findings, ctx),
    [synthesis.key_findings, result.synthesis_en?.key_findings, ctx]);
  const graded = isGraded(type) && synthesis.evidence_strength != null;
  const sof = useMemo(() => (showsSection(type, "sof") ? sofRows(synthesis.key_findings ?? [], result.synthesis_en?.key_findings, ctx, graded ? synthesis.evidence_strength : null) : []),
    [type, synthesis.key_findings, result.synthesis_en?.key_findings, ctx, graded, synthesis.evidence_strength]);

  const hasPapers = papers.length > 0;
  // The results figures follow the filters (like the matrix): built from the visible papers.
  const charts = useMemo(() => chartsContent(result, visible, rows, result.synthesis_en?.comparison ?? [], lang),
    [result, visible, rows, lang]);
  // The risk-of-bias summary (Plan 20 Task 4) uses every paper, like the summary of findings; none for scoping.
  const hasRob = useMemo(() => showsSection(type, "rob") && showsRiskOfBias(type) && robSummary(papers, lang) != null, [type, papers, lang]);
  const answer = synthesis.answer?.trim() ?? "";
  const discussion = synthesis.executive_summary || result.summary || "";
  const hasClaims = showsSection(type, "claims") && !!(synthesis.consensus?.length || synthesis.conflicts?.length);
  const hasMatrix = showsSection(type, "findings") && rows.length > 0;
  const hasLitMatrix = showsSection(type, "lit_matrix") && hasPapers;
  // Plan 14b: drawn only when the citation step ran (result.citations is null for legacy results and skipped steps).
  const citations = result.citations ?? null;
  const hasCitations = showsSection(type, "citations") && !!citations && hasPapers;
  const hasConceptMap = !!tree && tree.leaves > 0;
  const hasEvidenceMap = showsSection(type, "evidence_map") && (map.byConcept.rows.length > 0 || map.byYear.rows.length > 0);
  // A meta review with no papers renders the "Try this" block: nothing could be pooled, an empty pooled section (with its
  // banner) would only repeat that there are no studies.
  const hasMeta = showsSection(type, "meta") && hasPapers;
  // The pool's outcome is an English matrix row: directions come from the English rows (the shown ones for an English review).
  const metaRows = result.synthesis_en?.comparison?.length ? result.synthesis_en.comparison : result.synthesis?.comparison ?? [];
  const filterStatus = <FilterStatus filters={filters} onChange={setFilters} shown={visible.length} total={papers.length} lang={lang} />;
  const filterBar = papers.length > 1
    ? <FilterBar papers={papers} filters={filters} onChange={setFilters} shown={visible.length} lang={lang} showRisk={showsRiskOfBias(type)} /> : null;

  const blocks: Record<BlockId, { show: boolean; node: ReactNode }> = {
    // The flow counts every record of the search (result.stats), so the filters do not apply to it; it shows even when no
    // study was included, since then it explains the empty result.
    prisma: { show: showsSection(type, "prisma") && !!result.stats,
      node: <PrismaFlow stats={result.stats} methods={result.methods} options={review.options} type={type} lang={lang} /> },
    evidence_map: { show: hasEvidenceMap, node: <EvidenceMapSection map={map} lang={lang} /> },
    lit_matrix: { show: hasLitMatrix, node: (
      <LitMatrixSection papers={visible} allPapers={papers} lang={lang} type={type} onSelect={select} reviewId={review.id} offline={offline}
        citations={citations} question={result.question} />
    ) },
    findings: { show: hasMatrix, node: (
      <section aria-labelledby="h-matrix" className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <SectionHeading id="h-matrix">{L(lang, "ผลแต่ละการศึกษา", "Findings by study")}</SectionHeading>
        {visibleRows.length ? <ComparisonMatrix rows={visibleRows} refs={matrixRefs} papers={papers} lang={lang} onSelect={select} selected={active ?? undefined}
          pooledRefs={pooledRefs}
          outcomeOf={(row, ref) => outcomeFor(byRef.get(ref), row, ref)} /> : <p className="text-[0.9rem] text-muted">{L(lang, "ไม่มีงานวิจัยที่ตรงกับตัวกรอง", "No studies match the filters")}</p>}
        <MatrixLegend lang={lang} themes={themePapers(papers).length > 0} />
      </section>
    ) },
    forest: { show: hasPapers && showsSection(type, "forest") && !charts.empty, node: (
      <div className="grid gap-3">
        {filterStatus}
        <Charts content={charts} result={result} lang={lang} onSelect={select} />
      </div>
    ) },
    meta: { show: hasMeta, node: (
      <MetaAnalysisSection meta={result.meta_analysis} papers={papers} rows={metaRows} lang={lang} english={lang === "en"}
        filtered={isFiltered(filters)} quality={result.quality} onSelect={select} />
    ) },
    claims: { show: hasClaims, node: <ClaimsPanel consensus={synthesis.consensus ?? []} conflicts={synthesis.conflicts ?? []} lang={lang} onSelect={select} refs={refs}
      graded={graded} /> },
    concept_map: { show: hasConceptMap, node: tree && <ConceptMapSection tree={tree} lang={lang} onSelect={select} /> },
    citations: { show: hasCitations, node: citations && <CitationNetworkSection citations={citations} papers={visible} lang={lang} onSelect={select} /> },
  };

  const layout = reportLayout(type);
  // The filters narrow every table and chart after them: they sit at the top of the first filtered group.
  const filterHome = layout.find((s) => (["characteristics", "results", "landscape"] as TopSectionId[]).includes(s.id)
    && s.blocks.some((b) => blocks[b].show))?.id;
  const sections: { id: TopSectionId; node: ReactNode }[] = [];
  for (const { id, blocks: ids } of layout) {
    if (id === "title") continue;
    const meta = TOP[id];
    const shown = ids.filter((b) => blocks[b].show);
    if (meta.h2) {
      if (!shown.length) continue;
      const single = id === "consistency" || id === "selection"; // one block: its content sits right under the group heading
      sections.push({ id, node: (
        <section aria-labelledby={meta.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
          <h2 id={meta.id} className={H2}>{L(lang, ...meta.h2)}</h2>
          {id === filterHome && filterBar}
          {single ? shown.map((b) => <Fragment key={b}>{blocks[b].node}</Fragment>)
            : <Subsections>{shown.map((b) => <Fragment key={b}>{blocks[b].node}</Fragment>)}</Subsections>}
        </section>
      ) });
      continue;
    }
    const node = sectionNode(id);
    if (node) sections.push({ id, node });
  }

  function sectionNode(id: TopSectionId): ReactNode {
    switch (id) {
      case "bottom_line":
        return <BottomLine synthesis={synthesis} result={result} papers={papers} lang={lang} onSelect={select} refs={refs} english={lang === "en"} />;
      case "key_findings":
        return hasPapers && findings.length ? <KeyFindings findings={findings} lang={lang} onSelect={select} /> : null;
      case "sof":
        return hasPapers && sof.length ? <SofTable rows={sof} lang={lang} onSelect={select} graded={graded} /> : null;
      case "limitations":
        return hasPapers ? <Limitations result={result} type={type} lang={lang} /> : null;
      case "gaps":
        return synthesis.research_gaps?.length ? (
          <section aria-labelledby="h-gaps" className="grid gap-2">
            <h2 id="h-gaps" className={H2}>{L(lang, "สิ่งที่ยังไม่รู้", "Research gaps")}</h2>
            <ul className={`grid max-w-[70ch] list-disc gap-1 pl-5 ${READING}`}>{synthesis.research_gaps.map((g) => <li key={g}>{g}</li>)}</ul>
          </section>
        ) : null;
      case "discussion":
        // With a direct answer, the long model summary becomes the discussion; without one it already led the report.
        return hasPapers && answer && discussion && discussion.trim() !== answer ? (
          <section aria-labelledby="h-discussion" className="grid gap-2">
            <h2 id="h-discussion" className={H2}>{L(lang, "อภิปราย", "Discussion")}</h2>
            <p className={`max-w-[65ch] ${READING}`} data-prose><CitedText text={discussion} onSelect={select} refs={refs} /></p>
            <p className="text-[0.8rem] text-muted">{L(lang, "เขียนโดยโมเดลจากงานวิจัยที่อ่าน ข้อความนี้ไม่ใช่ตัวเลขที่ตรวจแล้ว", "Written by the model from the studies read; this text is not a verified number.")}</p>
          </section>
        ) : null;
      case "rob":
        return hasRob ? <RobSummarySection papers={papers} type={type} lang={lang} fullText={result.stats?.with_fulltext != null} /> : null;
      case "methods":
        return <MethodsSection review={review} result={result} type={type} lang={lang} />;
      case "references":
        // Plan 20 Task 6: a complete reference list (the filters do not apply) and the records excluded at screening
        return hasPapers ? (
          <ReferencesSection papers={papers} stats={result.stats} lang={lang} onSelect={select} selectedRef={active?.ref} type={type} />
        ) : null;
      case "downloads":
        return <DownloadsAndCite review={review} result={result} type={type} lang={lang} offline={offline} />;
      default:
        return null;
    }
  }

  const navItems: NavItem[] = sections.map(({ id }) => {
    const top = TOP[id as Exclude<TopSectionId, "title">];
    return { id: top.id, label: L(lang, ...(offline && id === "downloads" ? OFFLINE_DOWNLOADS_NAV : top.nav)) };
  });
  const showNav = hasPapers;
  return (
    <SameModelReadings.Provider value={sameModelReadings(result)}>
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 pt-8" onPointerDownCapture={notePress} onClickCapture={notePress}
      style={offline ? ({ "--header-h": "0px" } as CSSProperties) : undefined}>
      <div className={`grid grid-cols-[minmax(0,1fr)] rounded-sm border border-rule bg-surface ${hasPapers ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-cols-[10rem_minmax(0,1fr)_minmax(0,22rem)]" : ""}`}>
        {showNav && <ReportToc items={navItems} label={L(lang, "สารบัญ", "Contents")} />}
        <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-10 p-5 sm:p-8 ${hasPapers ? "lg:border-r lg:border-rule" : ""}`}>
          {showNav && <ReportNav items={navItems} label={L(lang, "ในรายงานนี้", "In this report")} />}
          <TitleBlock review={review} result={result} type={type} lang={lang} original={original} onLang={setLang} poolGap={poolGap} offline={offline} />

          {sections.slice(0, 1).map((s) => <Fragment key={s.id}>{s.node}</Fragment>)}

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

          {sections.slice(1).map((s) => <Fragment key={s.id}>{s.node}</Fragment>)}
        </div>

        {hasPapers && (
          <RailDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} headingId={railHeading} returnFocus={returnFocus}>
            <SourceRail paper={active ? byRef.get(active.ref) ?? null : null} outcome={active?.outcome} lang={lang}
              onClose={() => setDrawerOpen(false)} headingId={railHeading} visible={drawerOpen} type={type} onSelect={select}
              onReference={toReference} />
          </RailDrawer>
        )}
      </div>
    </div>
    </SameModelReadings.Provider>
  );
}
