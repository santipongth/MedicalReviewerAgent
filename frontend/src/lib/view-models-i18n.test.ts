import { describe, expect, it } from "vitest";
import { P20_FIXTURES, P20_FIXTURES_EN } from "@/test/fixtures";
import { chartsContent } from "./charts-content";
import { citationNetwork } from "./citation-network";
import { conceptTree } from "./concept-map";
import { evidenceMap } from "./evidence-map";
import type { Lang } from "./i18n";
import { litColumnLabel, litColumns, litFramework, litRows } from "./lit-matrix";
import { metaView } from "./meta-view";
import { flowRows, prismaFlow, sourceRows } from "./prisma-flow";
import { keyFindingViews, sofRows, type OutcomeContext } from "./report-view";
import { reviewTypeOf } from "./review-type";
import { ROB_COLUMN, ROB_ORDER, robSummary } from "./rob-summary";
import { hasThai } from "./text-wrap";
import { relatedLabel, relatedReasonText, relatedReportsLabel } from "./trial-reports";
import type { Review } from "./types";

// Plan 20 Task 7 fix round 1 (review finding 7): the view-model libs hold their own {th, en} labels, outside the string
// table and its literal scan. Every string they build for an English report must be English; their chrome labels for a
// Thai report must be Thai.

/** Every string inside a value (objects and arrays walked; functions skipped). */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** Everything the report's view-models build from one review, in `lang`. */
function viewModels(review: Review, lang: Lang): unknown[] {
  const r = review.result!;
  const type = reviewTypeOf(r);
  const papers = r.papers ?? [];
  const rows = r.synthesis?.comparison ?? [];
  const ctx: OutcomeContext = { rows, enRows: r.synthesis_en?.comparison ?? [], papers, meta: r.meta_analysis, lang };
  const flow = prismaFlow({ stats: r.stats, methods: r.methods, options: review.options, type, lang });
  const framework = litFramework(type, papers, r.question);
  const lit = litRows(papers, lang, r.citations ?? null);
  return [
    flow, flow && flowRows(flow), sourceRows(r.methods?.sources, lang),
    lit, litColumns(type, lit, framework).map((c) => litColumnLabel(c, framework, lang)),
    r.meta_analysis && metaView(r.meta_analysis, papers, rows, lang),
    robSummary(papers, lang), evidenceMap(papers, rows, lang), conceptTree(r, lang, type),
    r.citations && citationNetwork(papers, r.citations, lang),
    chartsContent(r, papers, rows, r.synthesis_en?.comparison ?? [], lang),
    keyFindingViews(r.synthesis?.key_findings ?? [], r.synthesis_en?.key_findings, ctx),
    sofRows(r.synthesis?.key_findings ?? [], r.synthesis_en?.key_findings, ctx, r.synthesis?.evidence_strength ?? null),
    relatedLabel("P1", lang), relatedReportsLabel(lang), relatedReasonText("same trial (NCT01234567)", lang),
  ];
}

describe("view-model labels follow the report language", () => {
  it.each(Object.keys(P20_FIXTURES_EN) as (keyof typeof P20_FIXTURES_EN)[])("%s in English: no Thai in any built string", (type) => {
    const thai = strings(viewModels(P20_FIXTURES_EN[type], "en")).filter(hasThai);
    expect(thai).toEqual([]);
  });

  it("a Thai report: the flow, the lit-matrix columns and the risk-of-bias columns are Thai", () => {
    const r = P20_FIXTURES.slr.result!;
    const flow = prismaFlow({ stats: r.stats, methods: r.methods, type: "slr", lang: "th" })!;
    const labels = [...flow.stages.map((s) => s.label), ...flow.stages.map((s) => s.main.title)];
    const framework = litFramework("slr", r.papers ?? [], r.question);
    labels.push(...litColumns("slr", litRows(r.papers ?? [], "th"), framework).map((c) => litColumnLabel(c, framework, "th")));
    labels.push(...ROB_ORDER.map((k) => ROB_COLUMN.th[k]), relatedReportsLabel("th"));
    expect(labels.filter((l) => !hasThai(l))).toEqual([]);
  });
});
