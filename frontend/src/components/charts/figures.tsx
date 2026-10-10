"use client";

import { useMemo } from "react";
import { edgeCurves, SOURCE_LABEL, type CitationNetwork, type DesignGroup, type EdgeCurve, type NetNode } from "@/lib/citation-network";
import { topOutcomes, type ConceptTree, type MapNode } from "@/lib/concept-map";
import type { StudyPoint } from "@/lib/charts-data";
import type { TermKey } from "@/lib/glossary";
import { glyphSize, haloWidth } from "@/lib/glyphs";
import { DIRECTION_LABEL, type Lang } from "@/lib/i18n";
import { RC, type Pair } from "@/lib/i18n-report";
import type { MetaPoolView } from "@/lib/meta-view";
import { wrapLabel } from "@/lib/text-wrap";
import { L } from "../review/text";
import { ComputedNumber, Glyph, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { EChart, encodeHTML, type EChartsOption } from "./echart";
import { Figure } from "./figure";
import { SYMBOL, type ChartTokens } from "./tokens";

type Select = (ref: string, outcome?: string) => void;

/** Tooltip numbers: the tooltip's display face with tabular figures. Martian Mono stays with VerifiedNumber (and its
 * tape) only; the verified value and its source are one click away in the table view and the rail. */
const TIP_NUM = "font-variant-numeric:tabular-nums";

const G = RC.figures;

const MEASURE_NOTE: Record<string, Pair> = G.measureNote;

const MEASURE_TERM: Record<string, TermKey> = { HR: "hr", OR: "or", RR: "rr", MD: "md", SMD: "smd", RD: "rd" };

function MeasureGlossary({ measures, lang }: { measures: string[]; lang: Lang }) {
  const known = measures.filter((m) => MEASURE_TERM[m]);
  if (!known.length) return null;
  return (
    <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <dt className="label">{L(lang, G.abbreviations)}</dt>
      {known.map((m) => <dd key={m}><Term k={MEASURE_TERM[m]} lang={lang}>{m}</Term></dd>)}
    </dl>
  );
}

/**
 * Forest plot of one pooled analysis: the studies (direction glyphs, size by weight, verified intervals) and the pooled
 * estimate as an outlined lozenge (stroke only, never filled: the solid ◆ means harm). Null line at 1 (log axis) for
 * ratios, 0 otherwise. Every value comes from lib/meta-view.ts.
 */
function metaForestOption(pool: MetaPoolView, t: ChartTokens, lang: Lang): EChartsOption {
  const [min, max] = pool.axis;
  const n = pool.studies.length;
  const maxW = Math.max(...pool.studies.map((s) => s.weight), 1);
  const pooledLabel = L(lang, G.pooledComputed);
  return {
    animation: !t.reducedMotion,
    animationDuration: 500,
    aria: { enabled: false },
    grid: { left: 8, right: 24, top: 12, bottom: 32, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: t.surface,
      borderColor: t.rule,
      textStyle: { color: t.ink, fontFamily: t.fontDisplay },
      formatter: (p: { seriesName?: string; dataIndex: number }) => {
        if (p.seriesName === "pooled") {
          return `<b>${encodeHTML(`${pool.measure} ${pool.estText}`)}</b> <span style="color:${t.muted}">95% CI</span> ${encodeHTML(pool.ciText)}<br/><span style="color:${t.muted}">${encodeHTML(L(lang, G.pooledTip))}</span>`;
        }
        const s = pool.studies[p.dataIndex];
        if (!s) return "";
        return `<b style="${TIP_NUM}">${encodeHTML(`${pool.measure} ${s.effectText}`)}</b> <span style="color:${t.muted}">95% CI</span> ${encodeHTML(s.ciText)}<br/><span style="color:${t.muted}">${encodeHTML(s.label)} · ${encodeHTML(L(lang, G.weight))} ${encodeHTML(s.weightText)} · ${encodeHTML(DIRECTION_LABEL[lang][s.direction])}</span>`;
      },
    },
    xAxis: {
      type: pool.ratio ? "log" : "value", min, max, logBase: 10,
      axisLine: { lineStyle: { color: t.rule } }, splitLine: { lineStyle: { color: t.rule, type: "solid", opacity: 0.6 } },
      axisLabel: { color: t.muted, fontFamily: t.fontDisplay, fontSize: 11, formatter: (v: number) => String(Number(v.toPrecision(2))) },
    },
    yAxis: {
      type: "category", inverse: true, data: [...pool.studies.map((s) => s.label), pooledLabel],
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: {
        fontSize: 12, width: 220, overflow: "truncate",
        // The pooled row reads as a result line, not another study.
        color: t.ink, fontFamily: t.fontDisplay,
        formatter: (v: string) => (v === pooledLabel ? `{b|${v}}` : v),
        rich: { b: { color: t.ink, fontFamily: t.fontDisplay, fontWeight: 600, fontSize: 12 } },
      },
    },
    series: [
      {
        type: "custom",
        data: pool.studies.map((s, i) => [s.lo, s.hi, i]),
        encode: { x: [0, 1], y: 2 },
        silent: true,
        z: 1,
        renderItem: (params: { dataIndex: number }, api: { value: (i: number) => number; coord: (v: [number, number]) => number[] }) => {
          const a = api.coord([api.value(0), api.value(2)]);
          const b = api.coord([api.value(1), api.value(2)]);
          return { type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] },
            style: { stroke: t.direction[pool.studies[params.dataIndex].direction], lineWidth: 2, lineCap: "round" } };
        },
      },
      {
        type: "scatter",
        z: 2,
        cursor: "pointer",
        symbolKeepAspect: true,
        data: pool.studies.map((s, i) => ({
          value: [s.effect, i], ref: s.ref, outcome: s.outcomeKey ?? undefined, symbol: SYMBOL[s.direction],
          symbolSize: glyphSize(s.direction, Math.round(8 + 8 * Math.sqrt(s.weight / maxW))),
          itemStyle: { color: t.direction[s.direction], borderColor: t.surface, borderWidth: haloWidth(s.direction) },
        })),
        emphasis: { scale: 1.2 },
        markLine: {
          silent: true, symbol: "none", label: { show: false },
          lineStyle: { color: t.ink, width: 1, type: "solid" }, data: [{ xAxis: pool.nullValue }],
        },
      },
      {
        // The pooled estimate: an outlined lozenge from the lower to the upper limit, centred on the estimate.
        name: "pooled",
        type: "custom",
        data: [[pool.lo, pool.est, pool.hi, n]],
        encode: { x: [0, 1, 2], y: 3 },
        z: 3,
        renderItem: (_params: unknown, api: { value: (i: number) => number; coord: (v: [number, number]) => number[]; size: (v: [number, number]) => number[] }) => {
          const row = api.value(3);
          const lo = api.coord([api.value(0), row]);
          const mid = api.coord([api.value(1), row]);
          const hi = api.coord([api.value(2), row]);
          const h = Math.min(9, (api.size([0, 1])[1] || 24) * 0.3);
          return {
            type: "polygon",
            shape: { points: [[lo[0], mid[1]], [mid[0], mid[1] - h], [hi[0], mid[1]], [mid[0], mid[1] + h]] },
            style: { fill: "none", stroke: t.ink, lineWidth: 2, lineJoin: "miter" },
          };
        },
      },
    ],
  };
}

/** One pooled analysis as a figure with its table twin (studies, then the pooled row). */
export function MetaForestFigure({ pool, tokens, lang, onSelect }: { pool: MetaPoolView; tokens: ChartTokens; lang: Lang; onSelect: Select }) {
  const option = useMemo(() => metaForestOption(pool, tokens, lang), [pool, tokens, lang]);
  const family = pool.ratio ? "ratio" : "difference";
  return (
    <Figure lang={lang}
      title={`${L(lang, G.pooledForest)} · ${pool.measure}`}
      caption={<>
        {L(lang, MEASURE_NOTE[family])}
        {pool.ratio && <> (<Term k="logScale" lang={lang}>{L(lang, G.whatLog)}</Term>)</>}
        {" · "}{L(lang, G.markerWeight)}
        <MeasureGlossary measures={[pool.measure]} lang={lang} />
      </>}
      chart={
        <EChart option={option} height={Math.max(160, (pool.studies.length + 1) * 34 + 56)}
          label={L(lang, G.pooledAria(pool.k, pool.outcome))}
          onItemClick={(d) => { const x = d as { ref?: string; outcome?: string }; if (x?.ref) onSelect(x.ref, x.outcome); }} />
      }
      table={
        <table className="w-full min-w-[480px] border-collapse text-[0.88rem]">
          <thead><tr className="border-b border-rule text-left">
            <th scope="col" className="py-1.5 label">{L(lang, G.study)}</th>
            <th scope="col" className="py-1.5 label">{L(lang, G.effect)}</th>
            <th scope="col" className="py-1.5 label">95% CI</th>
            <th scope="col" className="py-1.5 label">{L(lang, G.weightComputed)}</th>
            <th scope="col" className="py-1.5 label">{L(lang, G.direction)}</th>
          </tr></thead>
          <tbody>
            {pool.studies.map((s) => (
              <tr key={s.ref} className="border-b border-rule">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal break-words">{s.label}</th>
                <td className="py-1.5 pr-3"><VerifiedNumber value={s.effectText} onSelect={() => onSelect(s.ref, s.outcomeKey ?? undefined)} /></td>
                <td className="py-1.5 pr-3"><VerifiedNumber value={s.ciText} /></td>
                <td className="py-1.5 pr-3"><ComputedNumber value={s.weightText} lang={lang} tag={false} /></td>
                <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><Glyph direction={s.direction} lang={lang} />{DIRECTION_LABEL[lang][s.direction]}</span></td>
              </tr>
            ))}
            <tr className="border-b border-rule">
              <th scope="row" className="py-1.5 pr-3 text-left font-display font-semibold">{L(lang, G.pooled)}</th>
              <td className="py-1.5 pr-3"><ComputedNumber value={pool.estText} lang={lang} /></td>
              <td className="py-1.5 pr-3"><ComputedNumber value={pool.ciText} lang={lang} tag={false} /></td>
              <td className="py-1.5 pr-3 text-muted">–</td>
              <td className="py-1.5 text-muted">–</td>
            </tr>
          </tbody>
        </table>
      }
    />
  );
}

export function StudyMapFigure({ points, missing, tokens, lang, onSelect }: {
  points: StudyPoint[]; missing: number; tokens: ChartTokens; lang: Lang; onSelect: Select;
}) {
  const option = useMemo<EChartsOption>(() => {
    const years = points.map((p) => p.year);
    const axisName = { color: tokens.ink, fontFamily: tokens.fontDisplay, fontSize: 12, fontWeight: 600 };
    // the y-axis title clears its widest tick label ("100,000"), which the log axis puts at the next power of ten
    // (Task 8 fix round 1: at 40px it ran through "10,000")
    const top = 10 ** Math.ceil(Math.log10(Math.max(10, ...points.map((p) => p.n))));
    const yNameGap = Math.round(top.toLocaleString("en-US").length * 6.6) + 14;
    return {
      animation: !tokens.reducedMotion,
      aria: { enabled: false },
      // the axis names sit outside the plot: room for them on the left and below
      grid: { left: 28, right: 16, top: 16, bottom: 36, containLabel: true },
      tooltip: {
        trigger: "item", backgroundColor: tokens.surface, borderColor: tokens.rule, textStyle: { color: tokens.ink, fontFamily: tokens.fontDisplay },
        formatter: (p: { data: { idx: number } }) => {
          const s = points[p.data.idx];
          return `<b style="${TIP_NUM}">n = ${encodeHTML(s.nText)}</b> · ${s.year}<br/>${encodeHTML(s.ref)} · ${encodeHTML(s.design)}<br/><span style="color:${tokens.muted}">${encodeHTML(s.title)}</span>`;
        },
      },
      xAxis: { type: "value", min: Math.min(...years) - 1, max: Math.max(...years) + 1, minInterval: 1,
        name: L(lang, G.publicationYear), nameLocation: "middle", nameGap: 26, nameTextStyle: axisName,
        axisLabel: { color: tokens.muted, fontFamily: tokens.fontDisplay, fontSize: 11, formatter: (v: number) => String(v) },
        axisLine: { lineStyle: { color: tokens.rule } }, splitLine: { show: false } },
      yAxis: { type: "log", logBase: 10,
        name: L(lang, G.sampleSize), nameLocation: "middle", nameGap: yNameGap, nameTextStyle: axisName,
        axisLabel: { color: tokens.muted, fontFamily: tokens.fontDisplay, fontSize: 11 }, splitLine: { lineStyle: { color: tokens.rule, opacity: 0.6, type: "dashed" } } },
      series: [{
        type: "scatter", symbolSize: 14, symbolKeepAspect: true, cursor: "pointer",
        data: points.map((p, idx) => ({ value: [p.year, p.n], idx, ref: p.ref, symbol: SYMBOL[p.direction], symbolSize: glyphSize(p.direction, 14),
          itemStyle: { color: tokens.direction[p.direction], borderColor: tokens.surface, borderWidth: haloWidth(p.direction) } })),
        // no point labels: neighbouring refs overlapped; the tooltip and the table view name every study
        label: { show: false },
        emphasis: { scale: 1.3 },
      }],
    };
  }, [points, tokens, lang]);
  if (!points.length) return null;
  const title = L(lang, G.mapTitle);
  return (
    <Figure lang={lang} title={title}
      caption={missing ? L(lang, G.mapMissing(missing)) : undefined}
      chart={<EChart option={option} height={300} label={L(lang, G.mapAria(points.length))}
        onItemClick={(d) => { const x = d as { ref?: string }; if (x?.ref) onSelect(x.ref); }} />}
      table={
        <table className="w-full min-w-[420px] border-collapse text-[0.88rem]">
          <caption className="pb-1 text-left font-display text-[0.85rem] font-semibold">{title}</caption>
          <thead><tr className="border-b border-rule text-left">
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, G.study)}</th>
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, G.year)}</th>
            <th scope="col" className="py-1.5 pr-3 label">n</th>
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, G.design)}</th>
            <th scope="col" className="py-1.5 label">{L(lang, G.direction)}</th>
          </tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.ref} className="border-b border-rule">
                <th scope="row" className="py-1.5 pr-3 text-left font-display font-normal">{p.ref}</th>
                <td className="py-1.5 pr-3 font-display tabular-nums">{p.year}</td>
                <td className="py-1.5 pr-3"><VerifiedNumber value={p.nText} /></td><td className="py-1.5 pr-3">{p.design}</td>
                <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><Glyph direction={p.direction} lang={lang} />{DIRECTION_LABEL[lang][p.direction]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}

type TreeDatum = { name: string; ref?: string; value: string; tip?: string; symbol: string; symbolSize: number; symbolKeepAspect: boolean; itemStyle: Record<string, unknown>; label?: Record<string, unknown>; children?: TreeDatum[] };

function treeData(n: MapNode, t: ChartTokens, lang: Lang): TreeDatum {
  const leaf = n.kind === "group";
  const colour = leaf && n.direction ? t.direction[n.direction] : t.muted;
  const name = n.kind === "root" ? L(lang, G.question) : n.label;
  return {
    // Full labels, wrapped on word boundaries (Thai included) instead of truncated mid-word.
    name: leaf ? name : wrapLabel(name, 22).join("\n"), value: n.text, ref: n.refs?.[0],
    tip: leaf && n.refs?.length ? L(lang, G.clickOpen(n.refs[0])) : undefined,
    // Shapes no direction glyph uses (circle, diamond, flat bar, half circle, dashed ring): rounded square for structure,
    // pin for design groups and qualitative themes.
    symbol: leaf ? (n.direction ? SYMBOL[n.direction] : "pin") : "roundRect",
    symbolSize: leaf ? 12 : 10,
    symbolKeepAspect: true,
    itemStyle: leaf ? { color: colour, borderColor: t.surface, borderWidth: n.direction ? Math.min(1, haloWidth(n.direction)) : 1 } : { color: t.muted, borderColor: t.surface, borderWidth: 1 },
    // Only study groups label to the right; a childless element or term keeps its label above, clear of the level after it.
    ...(!leaf && !n.children.length ? { label: { ...CONCEPT_LABEL_TOP, color: t.ink, backgroundColor: t.surface, fontFamily: t.fontDisplay } } : {}),
    ...(n.children.length ? { children: n.children.map((c) => treeData(c, t, lang)) } : {}),
  };
}

const CONCEPT_LABEL_TOP = { position: "top", distance: 6, verticalAlign: "bottom", align: "center", fontSize: 12, lineHeight: 15, padding: [1, 3] };

function conceptOption(tree: ConceptTree, t: ChartTokens, lang: Lang): EChartsOption {
  const label = { color: t.ink, fontFamily: t.fontDisplay, fontSize: 12, lineHeight: 15, backgroundColor: t.surface, padding: [1, 3] };
  return {
    animation: !t.reducedMotion,
    animationDuration: 400,
    aria: { enabled: false },
    tooltip: {
      trigger: "item", triggerOn: "mousemove", backgroundColor: t.surface, borderColor: t.rule,
      textStyle: { color: t.ink, fontFamily: t.fontDisplay },
      formatter: (p: { data: { value: string; tip?: string } }) =>
        encodeHTML(p.data.value) + (p.data.tip ? `<br/><span style="color:${t.muted}">${encodeHTML(p.data.tip)}</span>` : ""),
    },
    series: [{
      type: "tree", data: [treeData(tree.root, t, lang)], layout: "orthogonal", orient: "LR",
      initialTreeDepth: 3, expandAndCollapse: true, roam: false, top: 28, bottom: 8, left: 34, right: 196,
      lineStyle: { color: t.muted, width: 1.5, curveness: 0 },
      label: { ...label, position: "top", distance: 6, verticalAlign: "bottom", align: "center" },
      leaves: { label: { ...label, position: "right", distance: 8, verticalAlign: "middle", align: "left" } },
      emphasis: { focus: "descendant" },
      animationDurationUpdate: t.reducedMotion ? 0 : 300,
    }],
  };
}

/** The outline twin: every node with its full text; each paper ref is a button that opens the source rail. */
function ConceptOutline({ node, lang, onSelect }: { node: MapNode; lang: Lang; onSelect: Select }) {
  return (
    <li className="grid gap-1">
      <span className="break-words">
        {node.kind === "group" ? (
          <>
            {node.direction && <><Glyph direction={node.direction} lang={lang} />{" "}</>}
            {node.text}{!node.theme && <> <span className="font-display tabular-nums">({node.count})</span></>}
            {node.refs?.map((r) => (
              <button key={r} type="button" onClick={() => onSelect(r)}
                className="ml-1 inline-flex min-h-11 min-w-11 items-center justify-center font-display font-semibold text-primary underline underline-offset-2">
                {r}
              </button>
            ))}
          </>
        ) : node.text}
      </span>
      {node.children.length > 0 && (
        <ul className="grid list-disc gap-1 pl-5">
          {node.children.map((c) => <ConceptOutline key={c.id} node={c} lang={lang} onSelect={onSelect} />)}
        </ul>
      )}
    </li>
  );
}

/** The concept map's chart holds the outcomes most studies report; the outline twin keeps every one. */
export const CONCEPT_TOP_OUTCOMES = 8;

/**
 * The concept map: the chart (the top 8 outcomes by number of studies, full wrapped labels) and its outline twin, which
 * is the default view below 1024px (`wide` false), where the tree cannot be read. No title: the section heading names it.
 */
export function ConceptMapFigure({ tree, tokens, lang, onSelect, wide }: {
  tree: ConceptTree; tokens: ChartTokens; lang: Lang; onSelect: Select; wide: boolean;
}) {
  const top = useMemo(() => topOutcomes(tree, CONCEPT_TOP_OUTCOMES), [tree]);
  const option = useMemo(() => conceptOption(top.tree, tokens, lang), [top, tokens, lang]);
  const note = tree.byDirection ? L(lang, G.asRead) : null;
  const cut = top.shown < top.total ? L(lang, G.conceptCut(top.shown, top.total)) : null;
  return (
    <Figure key={wide ? "wide" : "narrow"} lang={lang} defaultTable={!wide} label={L(lang, G.conceptMap)}
      caption={<>{L(lang, G.conceptCaption)}{note && <> · {note}</>}{cut && <> · <span data-concept-cut>{cut}</span></>}</>}
      chart={
        <div className="@container overflow-x-auto rounded-sm border border-rule" tabIndex={0} role="region" aria-label={L(lang, G.conceptScroll)}>
          {/* Fills the column; only a container narrower than 600px keeps a 720px canvas and scrolls inside this region. */}
          <div className="@max-[600px]:min-w-[720px]">
            {/* 64px per drawn row: a label above its node may wrap to two lines without touching the row above */}
            <EChart option={option} height={Math.max(300, top.tree.drawnLeaves * 64)}
              label={L(lang, G.conceptAria(top.tree.leaves))}
              onItemClick={(d) => { const x = d as { ref?: string }; if (x?.ref) onSelect(x.ref); }} />
          </div>
        </div>
      }
      table={
        <ul aria-label={L(lang, G.conceptOutline)} className="grid list-none gap-1 text-[0.9rem]">
          <ConceptOutline node={tree.root} lang={lang} onSelect={onSelect} />
        </ul>
      }
    />
  );
}

// --- Citation network (Plan 14b) -------------------------------------------------------------------------------------

export const DESIGN_GROUP_LABEL = G.group as Record<DesignGroup, Pair>;

/** A pointy-top hexagon: no direction marker uses it (lib/glyphs.ts: circle, diamond, flat bar, half circle, dashed ring). */
export const HEXAGON_PATH = "path://M50 0L93.3 25L93.3 75L50 100L6.7 75L6.7 25Z";

/**
 * Neutral fills per design group (direction colours mean a direction and stay out of this view), each with its own
 * shape so tone is never the only cue: trials a circle, observational and other a hexagon, reviews a rounded square.
 */
export function groupStyle(g: DesignGroup, t: ChartTokens): { fill: string; stroke: string; symbol: string } {
  if (g === "trial") return { fill: t.ink, stroke: t.ink, symbol: "circle" };
  if (g === "review") return { fill: t.hatch, stroke: t.ink, symbol: "roundRect" };
  return { fill: t.muted, stroke: t.muted, symbol: HEXAGON_PATH };
}

/** Pixels per year column, so neighbouring years never overlap (the region scrolls when the column is narrower). */
const PX_PER_COLUMN = 64;
const LANE_PX = 46;
const GRID = { left: 20, right: 44, top: 22, bottom: 30 };
/** The reading column is about this wide on a desktop; narrower screens draw at minWidth and scroll. */
const TYPICAL_WIDTH = 600;

interface CitationLayout { minWidth: number; height: number; grid: typeof GRID; curves: EdgeCurve[] }

/** Drawing size and arc bends: every column gets PX_PER_COLUMN, and the grid grows to hold the arcs that bulge out. */
function citationLayout(net: CitationNetwork): CitationLayout {
  const range = net.xMax - net.xMin || 1;
  const xs = [...new Set(net.nodes.map((n) => n.x))].sort((a, b) => a - b);
  const minGap = xs.slice(1).reduce((m, x, i) => Math.min(m, x - xs[i]), Infinity);
  // On the linear year axis the closest pair of columns sets the scale; never fewer px than one per column.
  const steps = Math.max(net.columns, Number.isFinite(minGap) ? range / minGap : 1);
  const minWidth = Math.min(2600, Math.ceil(steps * PX_PER_COLUMN)) + 80;
  const pxPerYear = (Math.max(minWidth, TYPICAL_WIDTH) - GRID.left - GRID.right) / range;
  const curves = edgeCurves(net, pxPerYear, LANE_PX);
  // Arcs start at a marker's centre: what bulges past the outer lanes' half-lane of room needs extra margin.
  const room = LANE_PX * 0.6;
  const below = Math.max(0, ...curves.filter((c) => c.side === "below").map((c) => c.peak - room));
  const above = Math.max(0, ...curves.filter((c) => c.side === "above").map((c) => c.peak - room));
  const grid = { ...GRID, top: GRID.top + Math.ceil(above), bottom: GRID.bottom + Math.ceil(below) };
  return { minWidth, height: Math.max(150, net.lanes * LANE_PX + grid.top + grid.bottom), grid, curves };
}

function citationOption(net: CitationNetwork, layout: CitationLayout, t: ChartTokens, lang: Lang): EChartsOption {
  const unknownLabel = L(lang, G.yearUnknown);
  const byRef = new Map(net.nodes.map((n) => [n.ref, n]));
  const countText = (n: NetNode) => n.citedBy == null ? L(lang, G.noData)
    : `${n.citedBy.toLocaleString("en-US")} (${n.citedBySource ? SOURCE_LABEL[n.citedBySource] : L(lang, G.sourceUnknown)})`;
  return {
    animation: !t.reducedMotion,
    animationDuration: 400,
    aria: { enabled: false },
    grid: layout.grid,
    tooltip: {
      trigger: "item", backgroundColor: t.surface, borderColor: t.rule, textStyle: { color: t.ink, fontFamily: t.fontDisplay },
      formatter: (p: { dataType?: string; data: { ref?: string; source?: string; target?: string } }) => {
        if (p.dataType === "edge") {
          return encodeHTML(L(lang, G.cites(String(p.data.source), String(p.data.target))));
        }
        const n = p.data.ref ? byRef.get(p.data.ref) : undefined;
        if (!n) return "";
        const cov = n.coverage ? SOURCE_LABEL[n.coverage] : L(lang, G.noCoverage);
        return `<b>${encodeHTML(n.ref)}</b> · ${encodeHTML(n.year ?? unknownLabel)} · ${encodeHTML(n.designText)}`
          + `<br/><span style="color:${t.muted}">${encodeHTML(n.title)}</span>`
          + `<br/>${encodeHTML(L(lang, G.citedByAll))}: ${encodeHTML(countText(n))}`
          + `<br/>${encodeHTML(L(lang, G.referenceList))}: ${encodeHTML(cov)}`;
      },
    },
    xAxis: {
      type: "value", min: net.xMin, max: net.xMax,
      axisLine: { onZero: false, lineStyle: { color: t.rule } }, splitLine: { show: false },
      axisTick: { customValues: net.ticks, lineStyle: { color: t.rule } },
      axisLabel: {
        customValues: net.ticks, color: t.muted, fontFamily: t.fontDisplay, fontSize: 11,
        formatter: (v: number) => (v === net.unknownX ? unknownLabel : String(v)),
      },
    },
    yAxis: { type: "value", inverse: true, show: false, min: -0.6, max: net.lanes - 0.4 },
    series: [
      ...(net.unknownX != null && net.minYear != null ? [{
        // A dashed rule between the unknown-year column and the years: that column is not on the year scale.
        type: "scatter", data: [], silent: true,
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: t.rule, width: 1, type: "dashed" },
          data: [{ xAxis: (net.unknownX + net.minYear) / 2 }] },
      }] : []),
      {
        type: "graph", coordinateSystem: "cartesian2d", layout: "none", roam: false, cursor: "pointer",
        edgeSymbol: ["none", "arrow"], edgeSymbolSize: [0, 7],
        lineStyle: { color: t.muted, width: 1.2, opacity: 0.85 },
        label: { show: true, position: "right", distance: 4, color: t.ink, fontFamily: t.fontDisplay, fontSize: 11, formatter: "{b}",
          backgroundColor: t.surface, padding: [1, 2] },
        emphasis: { focus: "adjacency", lineStyle: { width: 2 } },
        data: net.nodes.map((n) => {
          const s = groupStyle(n.group, t);
          return {
            name: n.ref, ref: n.ref, value: [n.x, n.lane], symbol: s.symbol, symbolSize: n.size, symbolKeepAspect: true,
            // No reference data: hollow with a dashed outline ("no data", not "cites nothing").
            itemStyle: n.coverage
              ? { color: s.fill, borderColor: n.group === "review" ? s.stroke : t.surface, borderWidth: n.group === "review" ? 1.5 : 1 }
              : { color: t.surface, borderColor: s.stroke, borderWidth: 1.5, borderType: "dashed" },
          };
        }),
        // Each arc bends just enough to clear the markers it passes (edgeCurves).
        links: layout.curves.map((c) => ({ source: c.from, target: c.to, lineStyle: { curveness: Number(c.curveness.toFixed(3)) } })),
      },
    ],
  };
}

function Swatch({ group, hollow = false }: { group: DesignGroup; hollow?: boolean }) {
  const fill = hollow ? "var(--surface)" : group === "trial" ? "var(--ink)" : group === "review" ? "var(--hatch)" : "var(--muted)";
  const stroke = group === "observational" ? "var(--muted)" : "var(--ink)";
  const dash = hollow ? "2.5 2" : undefined;
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" className="shrink-0" data-shape={group}>
      {group === "review"
        ? <rect x="1.75" y="1.75" width="10.5" height="10.5" rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" strokeDasharray={dash} />
        : group === "observational"
          ? <polygon points="7,1 12.2,4 12.2,10 7,13 1.8,10 1.8,4" fill={fill} stroke={hollow ? stroke : "none"} strokeWidth="1.5" strokeDasharray={dash} />
          : <circle cx="7" cy="7" r="5.5" fill={fill} stroke={hollow ? stroke : "none"} strokeWidth="1.5" strokeDasharray={dash} />}
    </svg>
  );
}

const refsText = (refs: string[]) => (refs.length ? refs.join(", ") : "–");

/** The citation network: papers by year (lanes by design), arrows citing -> cited, with a table twin. */
export function CitationNetworkFigure({ net, tokens, lang, onSelect }: {
  net: CitationNetwork; tokens: ChartTokens; lang: Lang; onSelect: Select;
}) {
  const layout = useMemo(() => citationLayout(net), [net]);
  const option = useMemo(() => citationOption(net, layout, tokens, lang), [net, layout, tokens, lang]);
  const groups = (["trial", "observational", "review"] as const).filter((g) => net.nodes.some((n) => n.group === g));
  const hasHollow = net.nodes.some((n) => !n.coverage);
  const { minWidth, height } = layout;
  const label = L(lang, G.networkAria(net.total, net.edges.length));
  return (
    <Figure lang={lang}
      title={L(lang, G.networkTitle)}
      caption={
        <div className="grid gap-1">
          <p>{L(lang, G.networkLinks)}{" · "}{L(lang, G.arrows)}</p>
          <p><b className="font-display font-semibold text-ink">{L(lang, G.noDataNotNone)}</b>{" · "}{L(lang, G.mayCite)}</p>
          <p>{L(lang, G.markerCount)}</p>
          {net.partial && <p>{L(lang, G.partial)}</p>}
        </div>
      }
      chart={
        <div className="grid gap-2">
          {net.covered === 0 ? (
            <p className="text-[0.9rem]">{L(lang, G.noLists)}</p>
          ) : net.edges.length === 0 && (
            <p className="text-[0.9rem]">{L(lang, G.noCitations)}</p>
          )}
          <div className="overflow-x-auto rounded-sm border border-rule" tabIndex={0} role="region"
            aria-label={L(lang, G.networkScroll)}>
            <div style={{ minWidth }}>
              <EChart option={option} height={height} label={label}
                onItemClick={(d) => { const x = d as { ref?: string }; if (x?.ref) onSelect(x.ref); }} />
            </div>
          </div>
          <ul aria-label={L(lang, G.legend)} className="flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-muted">
            {groups.map((g) => (
              <li key={g} className="inline-flex items-center gap-1.5"><Swatch group={g} />{L(lang, DESIGN_GROUP_LABEL[g])}</li>
            ))}
            {hasHollow && (
              <li className="inline-flex items-center gap-1.5"><Swatch group="trial" hollow />
                {L(lang, G.dashed)}</li>
            )}
          </ul>
        </div>
      }
      table={
        <table aria-label={L(lang, G.citationTable)} className="w-full min-w-[640px] border-collapse text-[0.88rem]">
          <thead><tr className="border-b border-rule text-left">
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, G.study)}</th>
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, G.year)}</th>
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, G.citesIn)}</th>
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, G.citedByIn)}</th>
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, G.citedByAll)}</th>
            <th scope="col" className="py-1.5 label">{L(lang, G.referenceData)}</th>
          </tr></thead>
          <tbody>
            {net.nodes.map((n) => (
              <tr key={n.ref} className="border-b border-rule align-top">
                <th scope="row" className="py-1 pr-3 text-left font-normal">
                  <button type="button" onClick={() => onSelect(n.ref)} title={n.title} aria-label={`${n.ref} ${n.title}`}
                    className="inline-flex min-h-11 min-w-11 flex-col items-start justify-center text-left">
                    <span className="font-display font-semibold text-primary underline underline-offset-2">{n.ref}</span>
                    <span className="text-[0.75rem] text-muted">{n.designText}</span>
                  </button>
                </th>
                <td className="py-2 pr-3 font-display tabular-nums">{n.year ?? L(lang, G.unknown)}</td>
                <td className="py-2 pr-3 font-display">{n.coverage ? refsText(n.cites) : <span className="text-muted">{L(lang, G.noData)}</span>}</td>
                <td className="py-2 pr-3 font-display">{refsText(n.citedByIn)}</td>
                <td className="py-2 pr-3">
                  {n.citedBy == null ? <span className="text-muted" title={L(lang, G.noDataCap)}>–</span> : (
                    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-display tabular-nums">{n.citedBy.toLocaleString("en-US")}</span>
                      {n.citedBySource && <span className="text-[0.75rem] text-muted">{SOURCE_LABEL[n.citedBySource]}</span>}
                    </span>
                  )}
                </td>
                <td className="py-2">{n.coverage ? SOURCE_LABEL[n.coverage] : <span className="text-muted">{L(lang, G.noDataCap)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}
