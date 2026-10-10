"use client";

import { useMemo, useState, type ReactNode } from "react";
import { edgeCurves, SOURCE_LABEL, type CitationNetwork, type DesignGroup, type EdgeCurve, type NetNode } from "@/lib/citation-network";
import type { ConceptTree, MapNode } from "@/lib/concept-map";
import { forestAxis, type exclusionRows, type ForestData, type ForestGroup, type Stage, type StudyPoint } from "@/lib/charts-data";
import type { TermKey } from "@/lib/glossary";
import { haloWidth } from "@/lib/glyphs";
import { DIRECTION_LABEL, type Lang } from "@/lib/i18n";
import type { MetaPoolView } from "@/lib/meta-view";
import { L } from "../review/text";
import { ComputedNumber, Glyph, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { EChart, encodeHTML, type EChartsOption } from "./echart";
import { SYMBOL, type ChartTokens } from "./tokens";

type Select = (ref: string, outcome?: string) => void;

/** A figure with a title, the chart, and a table-view twin (the accessible equivalent). */
function Figure({ title, caption, lang, chart, table }: {
  title: ReactNode; caption?: ReactNode; lang: Lang; chart: ReactNode; table: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <figcaption className="font-display text-base font-semibold">{title}</figcaption>
        <button type="button" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}
          className="rounded-sm border border-rule px-2.5 py-0.5 font-display text-[0.8rem] hover:border-ink">
          {asTable ? L(lang, "ดูเป็นแผนภาพ", "Show chart") : L(lang, "ดูเป็นตาราง", "Show table")}
        </button>
      </div>
      {asTable ? <div className="overflow-x-auto">{table}</div> : chart}
      {caption && <div className="text-[0.82rem] text-muted">{caption}</div>}
    </figure>
  );
}

const MEASURE_NOTE: Record<string, [string, string]> = {
  ratio: ["อัตราส่วน (HR, OR, RR) บนสเกล log · เส้นตั้งที่ 1 = ไม่มีผล · ซ้ายของ 1 = ความเสี่ยงต่ำลง", "Ratios (HR, OR, RR) on a log scale · line at 1 = no effect · left of 1 = lower risk"],
  difference: ["ผลต่าง (MD, SMD, RD) · เส้นตั้งที่ 0 = ไม่มีผล", "Differences (MD, SMD, RD) · line at 0 = no effect"],
  correlation: ["สหสัมพันธ์ (r) · เส้นตั้งที่ 0 = ไม่มีความสัมพันธ์", "Correlation (r) · line at 0 = no association"],
};

const MEASURE_TERM: Record<string, TermKey> = { HR: "hr", OR: "or", RR: "rr", MD: "md", SMD: "smd", RD: "rd" };

function MeasureGlossary({ measures, lang }: { measures: string[]; lang: Lang }) {
  const known = measures.filter((m) => MEASURE_TERM[m]);
  if (!known.length) return null;
  return (
    <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <dt className="label">{L(lang, "คำย่อในแผนภาพ", "Abbreviations in the chart")}</dt>
      {known.map((m) => <dd key={m}><Term k={MEASURE_TERM[m]} lang={lang}>{m}</Term></dd>)}
    </dl>
  );
}

function forestOption(g: ForestGroup, t: ChartTokens, lang: Lang): EChartsOption {
  const [min, max] = forestAxis(g);
  const nullValue = g.family === "ratio" ? 1 : 0;
  const rows = g.rows;
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
      formatter: (p: { dataIndex: number }) => {
        const r = rows[p.dataIndex];
        if (!r) return "";
        const ci = r.ciText ? ` <span style="color:${t.muted}">95% CI</span> ${encodeHTML(r.ciText)}` : "";
        return `<b style="font-family:${t.fontNum}">${encodeHTML(r.valueText)}</b>${ci}<br/><span style="color:${t.muted}">${encodeHTML(r.label)} · ${encodeHTML(DIRECTION_LABEL[lang][r.direction])}</span>`;
      },
    },
    xAxis: {
      type: g.family === "ratio" ? "log" : "value", min, max, logBase: 10,
      axisLine: { lineStyle: { color: t.rule } }, splitLine: { lineStyle: { color: t.rule, type: "solid", opacity: 0.6 } },
      // Ticks are axis positions, not paper numbers: display face (tabular figures), never the verified face.
      axisLabel: { color: t.muted, fontFamily: t.fontDisplay, fontSize: 11, formatter: (v: number) => String(Number(v.toPrecision(2))) },
    },
    yAxis: {
      type: "category", inverse: true, data: rows.map((r) => r.label),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.ink, fontFamily: t.fontDisplay, fontSize: 12, width: 220, overflow: "truncate" },
    },
    series: [
      {
        type: "custom",
        data: rows.map((r, i) => [r.lo ?? r.value, r.hi ?? r.value, i]),
        encode: { x: [0, 1], y: 2 },
        silent: true,
        z: 1,
        renderItem: (params: { dataIndex: number }, api: { value: (i: number) => number; coord: (v: [number, number]) => number[] }) => {
          const a = api.coord([api.value(0), api.value(2)]);
          const b = api.coord([api.value(1), api.value(2)]);
          return { type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] },
            style: { stroke: t.direction[rows[params.dataIndex].direction], lineWidth: 2, lineCap: "round" } };
        },
      },
      {
        type: "scatter",
        z: 2,
        symbolSize: 12,
        symbolKeepAspect: true,
        cursor: "pointer",
        data: rows.map((r, i) => ({
          value: [r.value, i], ref: r.ref, outcome: r.outcomeKey, symbol: SYMBOL[r.direction],
          itemStyle: { color: t.direction[r.direction], borderColor: t.surface, borderWidth: haloWidth(r.direction) },
        })),
        emphasis: { scale: 1.3 },
        markLine: {
          silent: true, symbol: "none", label: { show: false },
          lineStyle: { color: t.ink, width: 1, type: "solid" }, data: [{ xAxis: nullValue }],
        },
      },
    ],
  };
}

export function ForestFigure({ data, tokens, lang, onSelect }: { data: ForestData; tokens: ChartTokens; lang: Lang; onSelect: Select }) {
  const options = useMemo(() => data.groups.map((g) => forestOption(g, tokens, lang)), [data, tokens, lang]);
  if (!data.groups.length && !data.unverified.length) return null;
  const unverifiedNote = data.unverified.length ? (
    <p>
      <span className="hole mr-2">{L(lang, "ไม่ยืนยัน", "not verified")}</span>
      {L(lang, "ไม่แสดงในกราฟเพราะตรวจกับต้นฉบับไม่ผ่าน:", "Left out because they failed verification:")}{" "}
      {data.unverified.map((u) => `${u.ref} (${u.outcome})`).join(", ")}
    </p>
  ) : null;
  if (!data.groups.length) {
    return (
      <div className="grid gap-2">
        <h3 className="font-display text-base font-semibold">{L(lang, "ขนาดผล (forest plot)", "Effect sizes (forest plot)")}</h3>
        <p className="text-[0.9rem] text-muted">{L(lang, "ไม่มีขนาดผลที่ตรวจกับต้นฉบับผ่านสำหรับวาดกราฟ", "No verified effect sizes to plot")}</p>
        <div className="text-[0.82rem] text-muted">{unverifiedNote}</div>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      {data.groups.map((g, gi) => (
        <Figure key={g.family} lang={lang}
          title={`${L(lang, "ขนาดผล", "Effect sizes")} · ${g.measures.join(", ")}`}
          caption={<>
            {MEASURE_NOTE[g.family][lang === "th" ? 0 : 1]}
            {g.family === "ratio" && <> (<Term k="logScale" lang={lang}>{L(lang, "สเกล log คืออะไร", "what is a log scale")}</Term>)</>}
            <MeasureGlossary measures={g.measures} lang={lang} />
            {gi === 0 && unverifiedNote}
          </>}
          chart={
            <EChart option={options[gi]} height={Math.max(160, g.rows.length * 34 + 56)}
              label={L(lang, `Forest plot ของ ${g.rows.length} ผลลัพธ์`, `Forest plot of ${g.rows.length} effects`)}
              onItemClick={(d) => { const x = d as { ref?: string; outcome?: string }; if (x?.ref) onSelect(x.ref, x.outcome); }} />
          }
          table={
            <table className="w-full min-w-[480px] border-collapse text-[0.88rem]">
              <thead><tr className="border-b border-rule text-left">
                <th className="py-1.5 label">{L(lang, "งานวิจัย · ผลลัพธ์", "Study · outcome")}</th>
                <th className="py-1.5 label">{L(lang, "ขนาดผล", "Effect")}</th><th className="py-1.5 label">95% CI</th>
                <th className="py-1.5 label">{L(lang, "ทิศทาง", "Direction")}</th>
              </tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.label} className="border-b border-rule">
                    <td className="py-1.5 pr-3 break-words">{r.label}</td>
                    <td className="py-1.5 pr-3"><VerifiedNumber value={r.valueText} onSelect={() => onSelect(r.ref, r.outcomeKey)} /></td>
                    <td className="py-1.5 pr-3">{r.ciText ? <VerifiedNumber value={r.ciText} /> : "–"}</td>
                    <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><Glyph direction={r.direction} lang={lang} />{DIRECTION_LABEL[lang][r.direction]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      ))}
    </div>
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
  const pooledLabel = L(lang, "ค่ารวม (คำนวณ)", "Pooled (computed)");
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
          return `<b>${encodeHTML(`${pool.measure} ${pool.estText}`)}</b> <span style="color:${t.muted}">95% CI</span> ${encodeHTML(pool.ciText)}<br/><span style="color:${t.muted}">${encodeHTML(L(lang, "ค่ารวมที่ระบบคำนวณ ไม่ใช่ผลจากงานวิจัยฉบับใด", "Computed by the system, not a result of any single study"))}</span>`;
        }
        const s = pool.studies[p.dataIndex];
        if (!s) return "";
        return `<b style="font-family:${t.fontNum}">${encodeHTML(`${pool.measure} ${s.effectText}`)}</b> <span style="color:${t.muted}">95% CI</span> ${encodeHTML(s.ciText)}<br/><span style="color:${t.muted}">${encodeHTML(s.label)} · ${encodeHTML(L(lang, "น้ำหนัก", "weight"))} ${encodeHTML(s.weightText)} · ${encodeHTML(DIRECTION_LABEL[lang][s.direction])}</span>`;
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
          symbolSize: Math.round(8 + 8 * Math.sqrt(s.weight / maxW)),
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
      title={`${L(lang, "แผนภาพค่ารวม", "Pooled forest plot")} · ${pool.measure}`}
      caption={<>
        {MEASURE_NOTE[family][lang === "th" ? 0 : 1]}
        {pool.ratio && <> (<Term k="logScale" lang={lang}>{L(lang, "สเกล log คืออะไร", "what is a log scale")}</Term>)</>}
        {" · "}{L(lang, "ขนาดสัญลักษณ์ตามน้ำหนัก · รูปข้าวหลามตัดแบบเส้นขอบ = ค่ารวมที่ระบบคำนวณ", "Marker size follows weight · outlined lozenge = the computed pooled estimate")}
        <MeasureGlossary measures={[pool.measure]} lang={lang} />
      </>}
      chart={
        <EChart option={option} height={Math.max(160, (pool.studies.length + 1) * 34 + 56)}
          label={L(lang, `Forest plot ค่ารวมของ ${pool.k} งานวิจัย (${pool.outcome})`, `Pooled forest plot of ${pool.k} studies (${pool.outcome})`)}
          onItemClick={(d) => { const x = d as { ref?: string; outcome?: string }; if (x?.ref) onSelect(x.ref, x.outcome); }} />
      }
      table={
        <table className="w-full min-w-[480px] border-collapse text-[0.88rem]">
          <thead><tr className="border-b border-rule text-left">
            <th scope="col" className="py-1.5 label">{L(lang, "งานวิจัย", "Study")}</th>
            <th scope="col" className="py-1.5 label">{L(lang, "ขนาดผล", "Effect")}</th>
            <th scope="col" className="py-1.5 label">95% CI</th>
            <th scope="col" className="py-1.5 label">{L(lang, "น้ำหนัก (คำนวณ)", "Weight (computed)")}</th>
            <th scope="col" className="py-1.5 label">{L(lang, "ทิศทาง", "Direction")}</th>
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
              <th scope="row" className="py-1.5 pr-3 text-left font-display font-semibold">{L(lang, "ค่ารวม", "Pooled")}</th>
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

/** Why records were left out: reason labels with plain counts (not paper numbers). */
function ExclusionTable({ data, lang }: { data: NonNullable<ReturnType<typeof exclusionRows>>; lang: Lang }) {
  const rows = [...data.reasons, ...data.extra];
  return (
    <div className="grid gap-1.5">
      <div className="overflow-x-auto">
        <table aria-label={L(lang, "เหตุผลที่คัดออก", "Reasons for exclusion")} className="w-full border-collapse text-[0.88rem]">
          <caption className="pb-1 text-left label">{L(lang, "เหตุผลที่คัดออก", "Reasons for exclusion")}</caption>
          <thead><tr>
            <th scope="col"><span className="sr-only">{L(lang, "เหตุผล", "Reason")}</span></th>
            <th scope="col"><span className="sr-only">{L(lang, "จำนวน", "Count")}</span></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-rule">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal break-words">{r.label}</th>
                <td className="py-1.5 font-display tabular-nums">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.reasons.length > 0 && (
        <p className="text-[0.82rem] text-muted">
          {L(lang, "นับเฉพาะบทความที่ระบบบันทึกเหตุผลไว้ ผลรวมอาจน้อยกว่าจำนวนที่ไม่ได้เลือก", "Counts only records with a recorded reason; the sum may be below the number not selected")}
        </p>
      )}
    </div>
  );
}

export function PrismaFigure({ stages, tokens, lang, exclusions = null, scoping = false }: {
  stages: Stage[]; tokens: ChartTokens; lang: Lang; exclusions?: ReturnType<typeof exclusionRows>; scoping?: boolean;
}) {
  const option = useMemo<EChartsOption>(() => ({
    animation: !tokens.reducedMotion,
    animationDuration: 600,
    animationDelay: (i: number) => i * 120,
    aria: { enabled: false },
    grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value", show: false, max: Math.max(...stages.map((s) => s.value), 1) },
    yAxis: { type: "category", inverse: true, data: stages.map((s) => s.label), axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: tokens.ink, fontFamily: tokens.fontDisplay, fontSize: 12 } },
    series: [{
      type: "bar", barWidth: 18, data: stages.map((s) => s.value), itemStyle: { color: tokens.muted, borderRadius: [0, 4, 4, 0] },
      // Record counts, not paper numbers: display face with tabular figures, never the verified face.
      label: { show: true, position: "right", color: tokens.ink, fontFamily: tokens.fontDisplay, fontSize: 12 },
    }],
  }), [stages, tokens]);
  if (!stages.length) return null;
  const figure = (
    <Figure lang={lang} title={<>{L(lang, "ขั้นตอนการคัดเลือก", "Selection flow")} (<Term k="prisma" lang={lang}>{scoping ? "PRISMA-ScR" : "PRISMA"}</Term>)</>}
      caption={L(lang, "จำนวนงานวิจัยในแต่ละขั้นของรีวิวนี้", "Number of records at each step of this review")}
      chart={<EChart option={option} height={stages.length * 34 + 16} label={stages.map((s) => `${s.label} ${s.value}`).join(", ")} />}
      table={
        <table aria-label={L(lang, "ขั้นตอนการคัดเลือก", "Selection flow")} className="w-full border-collapse text-[0.88rem]">
          <thead><tr>
            <th scope="col"><span className="sr-only">{L(lang, "ขั้นตอน", "Step")}</span></th>
            <th scope="col"><span className="sr-only">{L(lang, "จำนวน", "Count")}</span></th>
          </tr></thead>
          <tbody>
            {stages.map((s) => <tr key={s.key} className="border-b border-rule"><th scope="row" className="py-1.5 pr-3 text-left font-normal">{s.label}</th><td className="py-1.5 font-display tabular-nums">{s.value}</td></tr>)}
          </tbody>
        </table>
      }
    />
  );
  if (!exclusions) return figure;
  return <div className="grid min-w-0 gap-4">{figure}<ExclusionTable data={exclusions} lang={lang} /></div>;
}

export function StudyMapFigure({ points, missing, tokens, lang, onSelect }: {
  points: StudyPoint[]; missing: number; tokens: ChartTokens; lang: Lang; onSelect: Select;
}) {
  const option = useMemo<EChartsOption>(() => {
    const years = points.map((p) => p.year);
    return {
      animation: !tokens.reducedMotion,
      aria: { enabled: false },
      grid: { left: 8, right: 24, top: 16, bottom: 28, containLabel: true },
      tooltip: {
        trigger: "item", backgroundColor: tokens.surface, borderColor: tokens.rule, textStyle: { color: tokens.ink, fontFamily: tokens.fontDisplay },
        formatter: (p: { data: { idx: number } }) => {
          const s = points[p.data.idx];
          return `<b style="font-family:${tokens.fontNum}">n = ${encodeHTML(s.nText)}</b> · ${s.year}<br/>${encodeHTML(s.ref)} · ${encodeHTML(s.design)}<br/><span style="color:${tokens.muted}">${encodeHTML(s.title)}</span>`;
        },
      },
      xAxis: { type: "value", min: Math.min(...years) - 1, max: Math.max(...years) + 1, minInterval: 1,
        axisLabel: { color: tokens.muted, fontFamily: tokens.fontDisplay, fontSize: 11, formatter: (v: number) => String(v) },
        axisLine: { lineStyle: { color: tokens.rule } }, splitLine: { show: false } },
      yAxis: { type: "log", logBase: 10,
        axisLabel: { color: tokens.muted, fontFamily: tokens.fontDisplay, fontSize: 11 }, splitLine: { lineStyle: { color: tokens.rule, opacity: 0.6 } } },
      series: [{
        type: "scatter", symbolSize: 14, symbolKeepAspect: true, cursor: "pointer",
        data: points.map((p, idx) => ({ value: [p.year, p.n], idx, ref: p.ref, symbol: SYMBOL[p.direction],
          itemStyle: { color: tokens.direction[p.direction], borderColor: tokens.surface, borderWidth: haloWidth(p.direction) } })),
        label: { show: true, formatter: (p: { data: { ref: string } }) => p.data.ref, position: "right", color: tokens.ink, fontFamily: tokens.fontDisplay, fontSize: 11 },
        emphasis: { scale: 1.3 },
      }],
    };
  }, [points, tokens]);
  if (!points.length) return null;
  return (
    <Figure lang={lang} title={L(lang, "แผนที่งานวิจัย: ปี × ขนาดตัวอย่าง × ทิศทางผล", "Study map: year × sample size × direction")}
      caption={missing ? L(lang, `ไม่ได้แสดง ${missing} ฉบับที่ไม่มีปีหรือจำนวนผู้เข้าร่วมที่ตรวจผ่าน`, `${missing} studies without a year or a verified sample size are not shown`) : undefined}
      chart={<EChart option={option} height={280} label={L(lang, `แผนที่ ${points.length} งานวิจัย`, `Map of ${points.length} studies`)}
        onItemClick={(d) => { const x = d as { ref?: string }; if (x?.ref) onSelect(x.ref); }} />}
      table={
        <table className="w-full min-w-[420px] border-collapse text-[0.88rem]"><tbody>
          {points.map((p) => (
            <tr key={p.ref} className="border-b border-rule">
              <td className="py-1.5 pr-3 font-display">{p.ref}</td><td className="py-1.5 pr-3">{p.year}</td>
              <td className="py-1.5 pr-3">n = <VerifiedNumber value={p.nText} /></td><td className="py-1.5 pr-3">{p.design}</td>
              <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><Glyph direction={p.direction} lang={lang} />{DIRECTION_LABEL[lang][p.direction]}</span></td>
            </tr>
          ))}
        </tbody></table>
      }
    />
  );
}

const CONCEPT_CAPTION = ["เส้นเชื่อมมาจากตารางผลแต่ละการศึกษาเท่านั้น ไม่ได้แสดงตัวแปรคั่นกลาง (mediator)",
  "Links come only from the per-study results table; no mediating variables (mediators) are shown"];

type TreeDatum = { name: string; ref?: string; value: string; tip?: string; symbol: string; symbolSize: number; symbolKeepAspect: boolean; itemStyle: Record<string, unknown>; label?: Record<string, unknown>; children?: TreeDatum[] };

function treeData(n: MapNode, t: ChartTokens, lang: Lang): TreeDatum {
  const leaf = n.kind === "group";
  const colour = leaf && n.direction ? t.direction[n.direction] : t.muted;
  return {
    name: n.kind === "root" ? L(lang, "คำถาม", "Question") : n.label, value: n.text, ref: n.refs?.[0],
    tip: leaf && n.refs?.length ? L(lang, `คลิกเพื่อเปิด ${n.refs[0]} · ดูทั้งหมดในโครงร่าง`, `Click to open ${n.refs[0]} · see all in the outline`) : undefined,
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

const CONCEPT_LABEL_TOP = { position: "top", distance: 6, verticalAlign: "bottom", align: "center", fontSize: 12, width: 150, overflow: "truncate", padding: [1, 3] };

function conceptOption(tree: ConceptTree, t: ChartTokens, lang: Lang): EChartsOption {
  const label = { color: t.ink, fontFamily: t.fontDisplay, fontSize: 12, overflow: "truncate", backgroundColor: t.surface, padding: [1, 3] };
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
      label: { ...label, position: "top", distance: 6, verticalAlign: "bottom", align: "center", width: 150 },
      leaves: { label: { ...label, position: "right", distance: 8, verticalAlign: "middle", align: "left", width: 180 } },
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

export function ConceptMapFigure({ tree, tokens, lang, onSelect }: { tree: ConceptTree; tokens: ChartTokens; lang: Lang; onSelect: Select }) {
  const option = useMemo(() => conceptOption(tree, tokens, lang), [tree, tokens, lang]);
  const note = tree.byDirection ? L(lang, "ทิศทางตามที่เอเจนต์อ่านจากบทคัดย่อ", "Directions as the agent read them in the abstracts") : null;
  return (
    <Figure lang={lang} title={L(lang, "แผนที่ความรู้: คำถาม ผลลัพธ์ และงานวิจัยที่รายงาน", "Concept map: question, outcomes and the studies that report them")}
      caption={<>{L(lang, CONCEPT_CAPTION[0], CONCEPT_CAPTION[1])}{note && <> · {note}</>}</>}
      chart={
        <div className="@container overflow-x-auto rounded-sm border border-rule" tabIndex={0} role="region" aria-label={L(lang, "แผนที่ความรู้ (เลื่อนดูได้)", "Concept map (scrollable)")}>
          {/* Fills the column; only a container narrower than 600px keeps a 720px canvas and scrolls inside this region. */}
          <div className="@max-[600px]:min-w-[720px]">
            <EChart option={option} height={Math.max(260, tree.drawnLeaves * 34)}
              label={L(lang, `แผนที่ความรู้ ${tree.leaves} กลุ่มงานวิจัย`, `Concept map with ${tree.leaves} study groups`)}
              onItemClick={(d) => { const x = d as { ref?: string }; if (x?.ref) onSelect(x.ref); }} />
          </div>
        </div>
      }
      table={
        <ul aria-label={L(lang, "โครงร่างแผนที่ความรู้", "Concept map outline")} className="grid list-none gap-1 text-[0.9rem]">
          <ConceptOutline node={tree.root} lang={lang} onSelect={onSelect} />
        </ul>
      }
    />
  );
}

// --- Citation network (Plan 14b) -------------------------------------------------------------------------------------

export const DESIGN_GROUP_LABEL: Record<DesignGroup, [string, string]> = {
  trial: ["การทดลอง (RCT, ไม่สุ่ม)", "Trials (RCT, non-randomised)"],
  observational: ["เชิงสังเกตและอื่น ๆ", "Observational and other"],
  review: ["การทบทวน (SR/MA, บทความทบทวน)", "Reviews (SR/MA, narrative)"],
};

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
  const unknownLabel = L(lang, "ไม่ทราบปี", "Year unknown");
  const byRef = new Map(net.nodes.map((n) => [n.ref, n]));
  const countText = (n: NetNode) => n.citedBy == null ? L(lang, "ไม่มีข้อมูล", "no data")
    : `${n.citedBy.toLocaleString("en-US")} (${n.citedBySource ? SOURCE_LABEL[n.citedBySource] : L(lang, "ไม่ทราบแหล่ง", "source unknown")})`;
  return {
    animation: !t.reducedMotion,
    animationDuration: 400,
    aria: { enabled: false },
    grid: layout.grid,
    tooltip: {
      trigger: "item", backgroundColor: t.surface, borderColor: t.rule, textStyle: { color: t.ink, fontFamily: t.fontDisplay },
      formatter: (p: { dataType?: string; data: { ref?: string; source?: string; target?: string } }) => {
        if (p.dataType === "edge") {
          return encodeHTML(L(lang, `${p.data.source} อ้างอิง ${p.data.target}`, `${p.data.source} cites ${p.data.target}`));
        }
        const n = p.data.ref ? byRef.get(p.data.ref) : undefined;
        if (!n) return "";
        const cov = n.coverage ? SOURCE_LABEL[n.coverage] : L(lang, "ไม่มีข้อมูล (ไม่ใช่ว่าไม่อ้างอิง)", "no data (not \"cites nothing\")");
        return `<b>${encodeHTML(n.ref)}</b> · ${encodeHTML(n.year ?? unknownLabel)} · ${encodeHTML(n.designText)}`
          + `<br/><span style="color:${t.muted}">${encodeHTML(n.title)}</span>`
          + `<br/>${encodeHTML(L(lang, "ถูกอ้างอิงทั้งหมด", "Cited by (all)"))}: ${encodeHTML(countText(n))}`
          + `<br/>${encodeHTML(L(lang, "รายการอ้างอิง", "Reference list"))}: ${encodeHTML(cov)}`;
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
  const label = L(lang, `เครือข่ายการอ้างอิง ${net.total} งานวิจัย ${net.edges.length} เส้นเชื่อม`,
    `Citation network of ${net.total} studies with ${net.edges.length} links`);
  return (
    <Figure lang={lang}
      title={L(lang, "การอ้างอิงกันระหว่างงานในรีวิวนี้ ตามปีที่ตีพิมพ์", "Citations between the studies in this review, by year")}
      caption={
        <div className="grid gap-1">
          <p>{L(lang, "เส้นเชื่อมแสดงการอ้างอิงระหว่างงานในรีวิวนี้เท่านั้น ข้อมูลจาก OpenAlex/Europe PMC",
            "Links show citations between studies in this review only. Data from OpenAlex/Europe PMC")}
          {" · "}{L(lang, "ลูกศรชี้จากงานที่อ้างไปยังงานที่ถูกอ้าง", "Arrows point from the citing study to the cited one")}</p>
          <p><b className="font-display font-semibold text-ink">{L(lang, "ไม่มีข้อมูล ≠ ไม่อ้างอิง", "No data ≠ cites nothing")}</b>
            {" · "}{L(lang, "งานที่ไม่มีข้อมูลรายการอ้างอิงอาจอ้างงานอื่นในรีวิวนี้โดยไม่มีเส้นแสดง",
              "a study without reference data may cite others in this review without a link being drawn")}</p>
          <p>{L(lang, "ขนาดจุดตามจำนวนครั้งที่ถูกอ้างอิงทั้งหมด (OpenAlex และ Europe PMC นับต่างกัน)",
            "Marker size follows the total cited-by count (OpenAlex and Europe PMC count differently)")}</p>
          {net.partial && <p>{L(lang, "ข้อมูลไม่ครบ: การดึงข้อมูลการอ้างอิงหมดเวลา จึงแสดงเท่าที่ได้รับ",
            "Partial: the citation lookup timed out, so only the data received is shown")}</p>}
        </div>
      }
      chart={
        <div className="grid gap-2">
          {net.covered === 0 ? (
            <p className="text-[0.9rem]">{L(lang, "ไม่มีข้อมูลรายการอ้างอิงของงานใดในรีวิวนี้ จึงไม่มีเส้นเชื่อม แสดงเฉพาะจำนวนครั้งที่ถูกอ้างอิง",
              "No study in this review has reference-list data, so no links are drawn; only cited-by counts are shown")}</p>
          ) : net.edges.length === 0 && (
            <p className="text-[0.9rem]">{L(lang, "ไม่พบการอ้างอิงกันระหว่างงานในรีวิวนี้", "No citations were found between the studies in this review")}</p>
          )}
          <div className="overflow-x-auto rounded-sm border border-rule" tabIndex={0} role="region"
            aria-label={L(lang, "เครือข่ายการอ้างอิง (เลื่อนดูได้)", "Citation network (scrollable)")}>
            <div style={{ minWidth }}>
              <EChart option={option} height={height} label={label}
                onItemClick={(d) => { const x = d as { ref?: string }; if (x?.ref) onSelect(x.ref); }} />
            </div>
          </div>
          <ul aria-label={L(lang, "คำอธิบายสัญลักษณ์", "Legend")} className="flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-muted">
            {groups.map((g) => (
              <li key={g} className="inline-flex items-center gap-1.5"><Swatch group={g} />{L(lang, ...DESIGN_GROUP_LABEL[g])}</li>
            ))}
            {hasHollow && (
              <li className="inline-flex items-center gap-1.5"><Swatch group="trial" hollow />
                {L(lang, "เส้นประ = ไม่มีข้อมูลการอ้างอิง", "Dashed = no citation data")}</li>
            )}
          </ul>
        </div>
      }
      table={
        <table aria-label={L(lang, "ตารางการอ้างอิง", "Citation table")} className="w-full min-w-[640px] border-collapse text-[0.88rem]">
          <thead><tr className="border-b border-rule text-left">
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, "งานวิจัย", "Study")}</th>
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, "ปี", "Year")}</th>
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, "อ้างอิงงานในรีวิว", "Cites (in review)")}</th>
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, "ถูกอ้างโดยงานในรีวิว", "Cited by (in review)")}</th>
            <th scope="col" className="py-1.5 pr-3 label">{L(lang, "ถูกอ้างอิงทั้งหมด", "Cited by (all)")}</th>
            <th scope="col" className="py-1.5 label">{L(lang, "ข้อมูลรายการอ้างอิง", "Reference data")}</th>
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
                <td className="py-2 pr-3 font-display tabular-nums">{n.year ?? L(lang, "ไม่ทราบ", "unknown")}</td>
                <td className="py-2 pr-3 font-display">{n.coverage ? refsText(n.cites) : <span className="text-muted">{L(lang, "ไม่มีข้อมูล", "no data")}</span>}</td>
                <td className="py-2 pr-3 font-display">{refsText(n.citedByIn)}</td>
                <td className="py-2 pr-3">
                  {n.citedBy == null ? <span className="text-muted" title={L(lang, "ไม่มีข้อมูล", "No data")}>–</span> : (
                    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-display tabular-nums">{n.citedBy.toLocaleString("en-US")}</span>
                      {n.citedBySource && <span className="text-[0.75rem] text-muted">{SOURCE_LABEL[n.citedBySource]}</span>}
                    </span>
                  )}
                </td>
                <td className="py-2">{n.coverage ? SOURCE_LABEL[n.coverage] : <span className="text-muted">{L(lang, "ไม่มีข้อมูล", "No data")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}
