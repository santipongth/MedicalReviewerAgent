"use client";

import { useMemo, useState, type ReactNode } from "react";
import { forestAxis, type ForestData, type ForestGroup, type Stage, type StudyPoint } from "@/lib/charts-data";
import { DIRECTION_LABEL, type Lang } from "@/lib/i18n";
import { L } from "../review/text";
import { Glyph, VerifiedNumber } from "../ui/evidence";
import { EChart, encodeHTML, type EChartsOption } from "./echart";
import { SYMBOL, type ChartTokens } from "./tokens";

type Select = (ref: string, outcome?: string) => void;

/** A figure with a title, the chart, and a table-view twin (the accessible equivalent). */
function Figure({ title, caption, lang, chart, table }: {
  title: string; caption?: ReactNode; lang: Lang; chart: ReactNode; table: ReactNode;
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
      axisLabel: { color: t.muted, fontFamily: t.fontNum, fontSize: 11, formatter: (v: number) => String(Number(v.toPrecision(2))) },
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
        cursor: "pointer",
        data: rows.map((r, i) => ({
          value: [r.value, i], ref: r.ref, outcome: r.outcomeKey, symbol: SYMBOL[r.direction],
          itemStyle: { color: t.direction[r.direction], borderColor: t.surface, borderWidth: 2 },
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
          caption={<>{MEASURE_NOTE[g.family][lang === "th" ? 0 : 1]}{gi === 0 && unverifiedNote}</>}
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

export function PrismaFigure({ stages, tokens, lang }: { stages: Stage[]; tokens: ChartTokens; lang: Lang }) {
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
      label: { show: true, position: "right", color: tokens.ink, fontFamily: tokens.fontNum, fontSize: 12 },
    }],
  }), [stages, tokens]);
  if (!stages.length) return null;
  return (
    <Figure lang={lang} title={L(lang, "ขั้นตอนการคัดเลือก (PRISMA)", "Selection flow (PRISMA)")}
      caption={L(lang, "จำนวนงานวิจัยในแต่ละขั้นของรีวิวนี้", "Number of records at each step of this review")}
      chart={<EChart option={option} height={stages.length * 34 + 16} label={stages.map((s) => `${s.label} ${s.value}`).join(", ")} />}
      table={
        <table className="w-full border-collapse text-[0.88rem]"><tbody>
          {stages.map((s) => <tr key={s.key} className="border-b border-rule"><td className="py-1.5 pr-3">{s.label}</td><td className="py-1.5 font-num">{s.value}</td></tr>)}
        </tbody></table>
      }
    />
  );
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
        axisLabel: { color: tokens.muted, fontFamily: tokens.fontNum, fontSize: 11, formatter: (v: number) => String(v) },
        axisLine: { lineStyle: { color: tokens.rule } }, splitLine: { show: false } },
      yAxis: { type: "log", logBase: 10,
        axisLabel: { color: tokens.muted, fontFamily: tokens.fontNum, fontSize: 11 }, splitLine: { lineStyle: { color: tokens.rule, opacity: 0.6 } } },
      series: [{
        type: "scatter", symbolSize: 14, cursor: "pointer",
        data: points.map((p, idx) => ({ value: [p.year, p.n], idx, ref: p.ref, symbol: SYMBOL[p.direction],
          itemStyle: { color: tokens.direction[p.direction], borderColor: tokens.surface, borderWidth: 2 } })),
        label: { show: true, formatter: (p: { data: { ref: string } }) => p.data.ref, position: "right", color: tokens.ink, fontFamily: tokens.fontNum, fontSize: 11 },
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
              <td className="py-1.5 pr-3 font-num">{p.ref}</td><td className="py-1.5 pr-3">{p.year}</td>
              <td className="py-1.5 pr-3">n = <VerifiedNumber value={p.nText} /></td><td className="py-1.5 pr-3">{p.design}</td>
              <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><Glyph direction={p.direction} lang={lang} />{DIRECTION_LABEL[lang][p.direction]}</span></td>
            </tr>
          ))}
        </tbody></table>
      }
    />
  );
}
