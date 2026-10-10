"use client";

// Per-outcome forest panels and the diagnostic-accuracy panels (Plan 20 Task 5). Drawn in the DOM, one grid row per
// study (label · plot · numbers), so the numeric column lines up with its row, labels wrap as text on word boundaries
// (Thai included) and every number is a VerifiedNumber, a Hole or a ComputedNumber. Markers are the shared glyph paths
// (lib/glyphs.ts) in the direction colours; positions come from lib/charts-data.ts axes. Offline-safe (no next/*).
import { Fragment, type ReactNode } from "react";
import { armLabels, axisFraction, niceAxis, tickText, type Axis, type DtaData, type DtaMetric, type DtaValue } from "@/lib/charts-data";
import { GLYPH_PATH, glyphSize, haloWidth } from "@/lib/glyphs";
import { DIRECTION_LABEL, type Lang } from "@/lib/i18n";
import { plural } from "@/lib/plural";
import type { ForestPanelView, ForestRowView } from "@/lib/report-view";
import type { Direction } from "@/lib/types";
import { ScrollRegion } from "../review/scroll-region";
import { L } from "../review/text";
import { ComputedNumber, Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { Figure } from "./figure";

type Select = (ref: string, outcome?: string) => void;

const COLOR: Record<Direction, string> = { positive: "var(--sup)", negative: "var(--harm)", null: "var(--none)", mixed: "var(--mixed)", unclear: "var(--unclear)" };

/** Axis titles per measure (the panel's measure name, never a number). */
export const MEASURE_NAME: Record<string, [string, string]> = {
  HR: ["อัตราส่วนอันตราย (HR)", "Hazard ratio (HR)"],
  OR: ["อัตราส่วนออดส์ (OR)", "Odds ratio (OR)"],
  RR: ["อัตราส่วนความเสี่ยง (RR)", "Risk ratio (RR)"],
  MD: ["ผลต่างค่าเฉลี่ย (MD)", "Mean difference (MD)"],
  SMD: ["ผลต่างค่าเฉลี่ยมาตรฐาน (SMD)", "Standardised mean difference (SMD)"],
  RD: ["ผลต่างความเสี่ยง (RD)", "Risk difference (RD)"],
  r: ["สหสัมพันธ์ (r)", "Correlation (r)"],
};

const pct = (f: number) => `${(f * 100).toFixed(3)}%`;

/** A direction marker: the shared glyph path at its own aspect, with the surface outline where the glyph has one. */
function Marker({ direction, at, size = 12 }: { direction: Direction; at: number; size?: number }) {
  const w = glyphSize(direction, size);
  const flat = direction === "null";
  return (
    <svg aria-hidden="true" width={w} height={flat ? Math.round(w * 0.36) : w} viewBox={flat ? "0 0 100 36" : "0 0 100 100"}
      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible" style={{ left: pct(at) }} data-marker={direction}>
      <path d={GLYPH_PATH[direction]} fill={COLOR[direction]} stroke={haloWidth(direction) ? "var(--surface)" : "none"}
        strokeWidth={haloWidth(direction)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The plot cell's frame: dashed tick lines in `rule` and the null line in `ink` (one per row, so they read as one line). */
function Frame({ axis, children }: { axis: Axis; children?: ReactNode }) {
  return (
    <div aria-hidden="true" className="relative min-h-9" style={{ gridArea: "plot" }}>
      {axis.ticks.filter((t) => t !== axis.nullValue).map((t) => (
        <span key={t} className="absolute inset-y-0 border-l border-dashed border-rule" style={{ left: pct(axisFraction(t, axis)) }} />
      ))}
      {axis.nullValue != null && <span className="absolute inset-y-0 border-l border-ink" style={{ left: pct(axisFraction(axis.nullValue, axis)) }} data-null-line />}
      {children}
    </div>
  );
}

/** A study's estimate and interval; a missing interval draws the marker only. */
function Estimate({ axis, lo, hi, color, marker }: {
  axis: Axis; lo: number | null; hi: number | null; color: string; marker: ReactNode;
}) {
  const a = lo != null && hi != null ? axisFraction(lo, axis) : null;
  const b = lo != null && hi != null ? axisFraction(hi, axis) : null;
  return (
    <>
      {a != null && b != null && (
        <span className="absolute top-1/2 h-0.5 -translate-y-1/2" style={{ left: pct(a), width: pct(b - a), background: color }} data-ci />
      )}
      {marker}
    </>
  );
}

/** The pooled estimate: an outlined lozenge (stroke only, never the solid harm ◆) spanning the pooled interval. */
function Lozenge({ axis, est, lo, hi }: { axis: Axis; est: number; lo: number; hi: number }) {
  const a = axisFraction(lo, axis);
  const b = axisFraction(hi, axis);
  const mid = b > a ? ((axisFraction(est, axis) - a) / (b - a)) * 100 : 50;
  return (
    <svg aria-hidden="true" viewBox="0 0 100 16" preserveAspectRatio="none" className="absolute top-1/2 h-4 -translate-y-1/2 overflow-visible"
      style={{ left: pct(a), width: pct(Math.max(b - a, 0.004)) }} data-lozenge>
      <polygon points={`0,8 ${mid},1 100,8 ${mid},15`} fill="none" stroke="var(--ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="miter" />
    </svg>
  );
}

const ROW = "forest-row border-t border-rule/60 first:border-t-0";
const LABEL_CELL = "min-w-0 py-1.5 pr-2";
const NUM_CELL = "forest-num py-1.5 pl-2 text-[0.85rem]";

/** The label of a study row: a button that opens the paper in the rail (its full title in the title attribute). */
function StudyButton({ row, onSelect, extra }: { row: { ref: string; label: string; title: string; outcomeKey: string }; onSelect: Select; extra?: string }) {
  return (
    <button type="button" onClick={() => onSelect(row.ref, row.outcomeKey)} title={row.title}
      className="inline-flex min-h-8 max-w-full items-center text-left text-[0.88rem] text-ink underline decoration-rule underline-offset-2 hover:decoration-ink">
      <span className="line-clamp-2 break-words">{row.label}{extra ? <span className="text-muted"> · {extra}</span> : null}</span>
    </button>
  );
}

function AxisRows({ axis, title, arms }: { axis: Axis; title: string; arms: [string, string] | null }) {
  // only a crowded axis (more than 5 ticks) drops every other label in a narrow panel; 1 always stays
  const thin = axis.ticks.length > 5;
  const nullAt = axis.nullValue != null ? axisFraction(axis.nullValue, axis) : null;
  const one = axis.nullValue != null ? axis.ticks.indexOf(axis.nullValue) : 0;
  return (
    <>
      <div className="forest-row" aria-hidden="true">
        <div style={{ gridArea: "plot" }} className="relative h-6 border-t border-ink">
          {axis.ticks.map((t, i) => (
            // the end ticks sit inside the frame (left- or right-aligned to their mark), so a narrow panel never clips them
            <span key={t} className={`absolute top-0 pt-1 font-display text-[0.75rem] tabular-nums text-muted ${
              i === 0 ? "" : i === axis.ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"} ${thin && (i - one) % 2 ? "forest-tick-minor" : ""}`}
              style={{ left: pct(axisFraction(t, axis)) }}>
              <span className={`absolute -top-1 h-1 border-l border-ink ${i === 0 ? "left-0" : i === axis.ticks.length - 1 ? "right-0" : "left-1/2"}`} />
              {tickText(t)}
            </span>
          ))}
        </div>
      </div>
      <div className="forest-row">
        <div style={{ gridArea: "plot" }} className="grid gap-0.5 pt-1 text-center">
          <span className="font-display text-[0.8rem] font-semibold text-ink" data-axis-title>{title}</span>
          {arms && nullAt != null && (
            // the sides in measure terms only (lower / higher with the intervention), never which is better
            <span className="forest-favours flex font-display text-[0.75rem] text-muted" data-arms>
              <span className="pr-1.5 text-right" style={{ width: pct(nullAt) }}>← {arms[0]}</span>
              <span className="pl-1.5 text-left" style={{ width: pct(1 - nullAt) }}>{arms[1]} →</span>
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function HeadRow({ label, num }: { label: string; num: string }) {
  return (
    <div className="forest-row border-b border-ink pb-1" aria-hidden="true">
      <span className="label self-end" style={{ gridArea: "label" }}>{label}</span>
      <span className="forest-num label self-end whitespace-nowrap pl-2" style={{ gridArea: "num" }}>{num}</span>
    </div>
  );
}

/** The intervention/exposure named by the refined question (for the axis sides), or null. */
export interface Arms { intervention: string | null }

/** A block heading row inside a panel (a pool's studies, the rows not pooled, the systematic reviews). */
function GroupHead({ axis, text, ...data }: { axis: Axis; text: string } & Record<`data-${string}`, string | boolean>) {
  return (
    <div className={ROW} {...data}>
      <span className={`${LABEL_CELL} self-center font-display text-[0.8rem] font-semibold text-muted`} style={{ gridArea: "label" }}>{text}</span>
      <Frame axis={axis} />
    </div>
  );
}

function PooledRow({ pool, axis, lang }: { pool: ForestPanelView["pools"][number]; axis: Axis; lang: Lang }) {
  return (
    <div className={`${ROW} border-t-ink`} data-pooled-row>
      <span className={`${LABEL_CELL} self-center font-display text-[0.88rem] font-semibold`} style={{ gridArea: "label" }}>
        {L(lang, "ค่ารวม (คำนวณ)", "Pooled (computed)")}<span className="block text-[0.75rem] font-normal text-muted">{pool.group} · k = {pool.k}</span>
      </span>
      <Frame axis={axis}><Lozenge axis={axis} est={pool.est} lo={pool.lo} hi={pool.hi} /></Frame>
      <div className={NUM_CELL} style={{ gridArea: "num" }}>
        <span className="inline-flex flex-wrap items-baseline gap-x-1">
          <ComputedNumber value={pool.estText} lang={lang} tag={false} />
          <span className="whitespace-nowrap">(<ComputedNumber value={pool.ciText} lang={lang} tag={false} />)</span>
        </span>
      </div>
    </div>
  );
}

const poolHeading = (pool: ForestPanelView["pools"][number], lang: Lang) =>
  L(lang, `ค่ารวม: ${pool.group} · ${pool.refs.join(", ")}`, `Pooled: ${pool.group} · ${pool.refs.join(", ")}`);

const MEASURE_TERM: Record<string, "hr" | "or" | "rr" | "md" | "smd" | "rd"> = { HR: "hr", OR: "or", RR: "rr", MD: "md", SMD: "smd", RD: "rd" };

function StudyRows({ rows, axis, lang, onSelect }: { rows: ForestRowView[]; axis: Axis; lang: Lang; onSelect: Select }) {
  return rows.map((r) => (
    <div key={r.ref + r.outcomeKey} className={ROW} data-forest-row={r.ref}>
      <div className={LABEL_CELL} style={{ gridArea: "label" }}><StudyButton row={r} onSelect={onSelect} /></div>
      <Frame axis={axis}>
        <Estimate axis={axis} lo={r.lo} hi={r.hi} color={COLOR[r.direction]}
          marker={<Marker direction={r.direction} at={axisFraction(r.value, axis)} />} />
      </Frame>
      <div className={NUM_CELL} style={{ gridArea: "num" }}>
        <span className="inline-flex flex-wrap items-baseline gap-x-1">
          <VerifiedNumber value={r.num} onSelect={() => onSelect(r.ref, r.outcomeKey)} title={DIRECTION_LABEL[lang][r.direction]} />
          {r.ci && <span className="whitespace-nowrap">(<VerifiedNumber value={r.ci} />)</span>}
        </span>
      </div>
    </div>
  ));
}

/** One outcome × measure: primary studies, the pooled row(s), then systematic reviews in their own block. */
export function ForestPanel({ panel, arms, lang, onSelect }: { panel: ForestPanelView; arms: Arms; lang: Lang; onSelect: Select }) {
  const all = [...panel.primary, ...panel.reviews];
  const kind = panel.family === "ratio" ? "ratio" : "difference";
  const axis = niceAxis([...all.flatMap((r) => [r.value, r.lo ?? r.value, r.hi ?? r.value]),
    ...panel.pools.flatMap((p) => [p.est, p.lo, p.hi])], kind);
  const name = MEASURE_NAME[panel.measure] ?? [panel.measure, panel.measure];
  const title = `${L(lang, ...name)}${panel.family === "ratio" ? L(lang, " · สเกล log", " · log scale") : ""}`;
  const sides = armLabels(panel.family, arms.intervention, lang);
  const numHead = `${panel.measure} (95% CI)`;
  const reviewsLabel = L(lang, "การทบทวนอย่างเป็นระบบ", "Systematic reviews");
  const notPooled = L(lang, "ไม่ได้รวมผล", "Not pooled");
  const pooled = panel.pools.length > 0;
  const k = all.length;
  const colgroup = (text: string) => (
    <tr className="border-b border-rule"><th scope="colgroup" colSpan={4} className="pt-3 pb-1 text-left label">{text}</th></tr>
  );
  const table = (
    <table className="w-full min-w-[420px] border-collapse text-[0.88rem]">
      <caption className="pb-1 text-left font-display text-[0.85rem] font-semibold">
        {panel.outcome} · {numHead}
      </caption>
      <thead><tr className="border-b border-rule text-left">
        <th scope="col" className="py-1.5 pr-3 label">{L(lang, "งานวิจัย", "Study")}</th>
        <th scope="col" className="py-1.5 pr-3 label">{panel.measure}</th>
        <th scope="col" className="py-1.5 pr-3 label">95% CI</th>
        <th scope="col" className="py-1.5 label">{L(lang, "ทิศทาง", "Direction")}</th>
      </tr></thead>
      <tbody>
        {panel.groups.map((g) => (
          <Fragment key={g.pool?.key ?? "rest"}>
            {g.pool ? colgroup(poolHeading(g.pool, lang)) : pooled && (g.rows.length > 0 || panel.blanked.some((b) => !b.review)) && colgroup(notPooled)}
            {g.rows.map((r) => <TwinRow key={r.ref} r={r} lang={lang} onSelect={onSelect} />)}
            {g.pool && (
              <tr className="border-b border-rule">
                <th scope="row" className="py-1.5 pr-3 text-left font-display font-semibold">{L(lang, `ค่ารวม ${g.pool.group} (คำนวณ)`, `Pooled, ${g.pool.group} (computed)`)}</th>
                <td className="py-1.5 pr-3"><ComputedNumber value={g.pool.estText} lang={lang} /></td>
                <td className="py-1.5 pr-3"><ComputedNumber value={g.pool.ciText} lang={lang} tag={false} /></td>
                <td className="py-1.5 text-muted">–</td>
              </tr>
            )}
            {!g.pool && panel.blanked.filter((b) => !b.review).map((b) => <BlankTwin key={`b${b.ref}`} label={b.label} lang={lang} />)}
          </Fragment>
        ))}
        {(panel.reviews.length > 0 || panel.blanked.some((b) => b.review)) && colgroup(reviewsLabel)}
        {panel.reviews.map((r) => <TwinRow key={r.ref} r={r} lang={lang} onSelect={onSelect} />)}
        {panel.blanked.filter((b) => b.review).map((b) => <BlankTwin key={`b${b.ref}`} label={b.label} lang={lang} />)}
      </tbody>
    </table>
  );
  const chart = (
    <div className="forest grid grid-cols-[minmax(0,1fr)]" role="group" data-forest-panel={panel.measure}
      aria-label={L(lang, `Forest plot: ${panel.outcome}, ${panel.measure}, ${k} ผลการศึกษา`, `Forest plot: ${panel.outcome}, ${panel.measure}, ${k} ${plural(k, "effect", "effects")}`)}>
      <HeadRow label={L(lang, "งานวิจัย", "Study")} num={numHead} />
      {panel.groups.map((g) => g.pool ? (
        // a pool is its own block: exactly the studies it combined, its lozenge directly under them
        <div key={g.pool.key} className="grid grid-cols-[minmax(0,1fr)]" data-pool-block>
          <GroupHead axis={axis} text={poolHeading(g.pool, lang)} data-pool-heading />
          <StudyRows rows={g.rows} axis={axis} lang={lang} onSelect={onSelect} />
          <PooledRow pool={g.pool} axis={axis} lang={lang} />
        </div>
      ) : (
        <div key="rest" className="grid grid-cols-[minmax(0,1fr)]" {...(pooled ? { "data-not-pooled": true } : {})}>
          {pooled && (g.rows.length > 0 || panel.blanked.some((b) => !b.review)) && <GroupHead axis={axis} text={notPooled} data-block="not-pooled" />}
          <StudyRows rows={g.rows} axis={axis} lang={lang} onSelect={onSelect} />
          {panel.blanked.filter((b) => !b.review).map((b) => <BlankRow key={`b${b.ref}`} b={b} axis={axis} lang={lang} onSelect={onSelect} />)}
        </div>
      ))}
      {(panel.reviews.length > 0 || panel.blanked.some((b) => b.review)) && <GroupHead axis={axis} text={reviewsLabel} data-block="reviews" />}
      <StudyRows rows={panel.reviews} axis={axis} lang={lang} onSelect={onSelect} />
      {panel.blanked.filter((b) => b.review).map((b) => <BlankRow key={`b${b.ref}`} b={b} axis={axis} lang={lang} onSelect={onSelect} />)}
      <AxisRows axis={axis} title={title} arms={sides} />
    </div>
  );
  return (
    <Figure lang={lang} title={<>{panel.outcome} <span className="font-normal text-muted">· {panel.measure}</span></>}
      chart={chart} table={table}
      caption={<div className="grid gap-1">
        {panel.pools.map((p) => <PoolLine key={p.key} pool={p} lang={lang} />)}
        <p>
          {panel.family === "ratio" ? L(lang, "เส้นตั้งที่ 1 = ไม่มีผล", "Line at 1 = no effect")
            : panel.family === "correlation" ? L(lang, "เส้นตั้งที่ 0 = ไม่มีความสัมพันธ์", "Line at 0 = no association")
              : L(lang, "เส้นตั้งที่ 0 = ไม่มีผล", "Line at 0 = no effect")}
          {sides && <>{" · "}{L(lang, "สองด้านของแกนบอกเพียงว่าค่าต่ำหรือสูงกว่าในกลุ่มที่ได้รับการรักษา/สัมผัส ไม่ได้บอกว่าด้านใดดีกว่า",
            "The two sides say only whether the value is lower or higher with the intervention, not which is better")}</>}
          {pooled && <>{" · "}{L(lang, "ค่ารวมแต่ละค่ารวมเฉพาะงานที่อยู่ในกรอบของมัน", "Each pooled estimate combines only the studies in its own block")}</>}
          {panel.reviews.length > 0 && <>{" · "}{L(lang, "งานทบทวนอย่างเป็นระบบแสดงแยกและไม่นำมารวมกับงานวิจัยหลัก", "Systematic reviews are shown apart and never combined with the primary studies")}</>}
          {panel.family === "ratio" && <> (<Term k="logScale" lang={lang}>{L(lang, "สเกล log คืออะไร", "what is a log scale")}</Term>)</>}
          {MEASURE_TERM[panel.measure] && <> · <Term k={MEASURE_TERM[panel.measure]} lang={lang}>{panel.measure}</Term></>}
        </p>
      </div>} />
  );
}

function TwinRow({ r, lang, onSelect }: { r: ForestRowView; lang: Lang; onSelect: Select }) {
  return (
    <tr className="border-b border-rule">
      <th scope="row" className="py-1.5 pr-3 text-left font-normal break-words">{r.label}</th>
      <td className="py-1.5 pr-3"><VerifiedNumber value={r.num} onSelect={() => onSelect(r.ref, r.outcomeKey)} /></td>
      <td className="py-1.5 pr-3">{r.ci ? <VerifiedNumber value={r.ci} /> : "–"}</td>
      <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><Glyph direction={r.direction} lang={lang} />{DIRECTION_LABEL[lang][r.direction]}</span></td>
    </tr>
  );
}

function BlankTwin({ label, lang }: { label: string; lang: Lang }) {
  return (
    <tr className="border-b border-rule">
      <th scope="row" className="py-1.5 pr-3 text-left font-normal break-words">{label}</th>
      <td colSpan={3} className="py-1.5"><Hole lang={lang} /></td>
    </tr>
  );
}

function BlankRow({ b, axis, lang, onSelect }: { b: ForestPanelView["blanked"][number]; axis: Axis; lang: Lang; onSelect: Select }) {
  return (
    <div className={ROW} data-forest-row={b.ref} data-blanked>
      <div className={LABEL_CELL} style={{ gridArea: "label" }}><StudyButton row={b} onSelect={onSelect} /></div>
      <Frame axis={axis} />
      <div className={NUM_CELL} style={{ gridArea: "num" }}><Hole lang={lang} /></div>
    </div>
  );
}

/** k, I², τ², Q of a pooled row: computed numbers only (no prediction interval: the result carries none). */
function PoolLine({ pool, lang }: { pool: ForestPanelView["pools"][number]; lang: Lang }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display tabular-nums text-ink" data-pool-stats>
      <span className="font-semibold">{L(lang, `ค่ารวม ${pool.group}`, `Pooled, ${pool.group}`)}</span>
      <span>k = {pool.k}</span>
      <span>I² <ComputedNumber value={pool.i2Text} lang={lang} tag={false} /></span>
      <span>τ² <ComputedNumber value={pool.tau2Text} lang={lang} tag={false} /></span>
      <span>Q <ComputedNumber value={pool.qText} lang={lang} tag={false} /> (df {pool.df}, p {pool.pText.startsWith("<") ? "" : "= "}<ComputedNumber value={pool.pText} lang={lang} tag={false} />)</span>
      <a href="#h-meta" className="font-normal text-primary underline underline-offset-2">{L(lang, "วิธีคำนวณ", "How it was computed")}</a>
    </p>
  );
}

// --- Diagnostic accuracy ------------------------------------------------------------------------------------------------

const DTA_NAME: Record<DtaMetric, [string, string]> = {
  sens: ["ความไว (sensitivity)", "Sensitivity"], spec: ["ความจำเพาะ (specificity)", "Specificity"], auc: ["AUC", "AUC"],
};

function DtaNumber({ v, lang, onSelect, ref_ }: { v: DtaValue; lang: Lang; onSelect: Select; ref_: string }) {
  if (v.kind === "blanked") return <Hole lang={lang} />;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span className="whitespace-nowrap"><VerifiedNumber value={v.text} onSelect={() => onSelect(ref_, v.outcomeKey)} />{v.percent ? "%" : ""}</span>
      {v.ci && <span className="whitespace-nowrap">(<VerifiedNumber value={v.ci} />)</span>}
    </span>
  );
}

/** A neutral square: a reported accuracy value has no effect direction, so it never takes a direction glyph or colour. */
function DtaMarker({ at }: { at: number }) {
  return <span aria-hidden="true" className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 bg-ink" style={{ left: pct(at) }} data-marker="value" />;
}

function DtaPanel({ data, metric, lang, onSelect }: { data: DtaData; metric: "sens" | "spec"; lang: Lang; onSelect: Select }) {
  const axis = niceAxis([], "proportion");
  const name = L(lang, ...DTA_NAME[metric]);
  const rows = data.studies.flatMap((s) => s[metric].map((v, i) => ({ s, v, i, many: s[metric].length > 1 })));
  return (
    <div className="forest grid min-w-0 grid-cols-[minmax(0,1fr)]" role="group" data-dta-panel={metric}
      aria-label={L(lang, `${name}: ${rows.length} ค่า`, `${name}: ${rows.length} values`)}>
      <p className="pb-1 font-display text-[0.9rem] font-semibold">{name}</p>
      <HeadRow label={L(lang, "งานวิจัย", "Study")} num={L(lang, "ค่า (95% CI)", "Value (95% CI)")} />
      {rows.map(({ s, v, i, many }) => (
        <div key={`${s.ref}${i}`} className={ROW} data-forest-row={s.ref}>
          <div className={LABEL_CELL} style={{ gridArea: "label" }}>
            <StudyButton row={{ ref: s.ref, label: s.label, title: s.title, outcomeKey: v.outcomeKey }} onSelect={onSelect} extra={many ? v.outcome : undefined} />
          </div>
          <Frame axis={axis}>
            {v.kind === "verified" && (
              <Estimate axis={axis} lo={v.lo} hi={v.hi} color="var(--muted)" marker={<DtaMarker at={axisFraction(v.pos, axis)} />} />
            )}
          </Frame>
          <div className={NUM_CELL} style={{ gridArea: "num" }}><DtaNumber v={v} lang={lang} onSelect={onSelect} ref_={s.ref} /></div>
        </div>
      ))}
      <AxisRows axis={axis} title={`${name} (%)`} arms={null} />
    </div>
  );
}

/** Paired sensitivity and specificity panels and a DTA table (study, sensitivity, specificity, AUC, n). */
export function DtaFigure({ data, lang, onSelect }: { data: DtaData; lang: Lang; onSelect: Select }) {
  const cell = (s: DtaData["studies"][number], m: DtaMetric) => s[m].length
    ? <span className="grid gap-1">{s[m].map((v, i) => (
      <span key={i}>{s[m].length > 1 && <span className="text-[0.78rem] text-muted">{v.outcome}: </span>}<DtaNumber v={v} lang={lang} onSelect={onSelect} ref_={s.ref} /></span>
    ))}</span>
    : <span className="text-muted">–</span>;
  const table = (
    <table className="w-full min-w-[520px] border-collapse text-[0.88rem]">
      <caption className="pb-1 text-left font-display text-[0.85rem] font-semibold">
        {L(lang, "ความแม่นยำในการวินิจฉัยตามที่แต่ละงานรายงาน", "Diagnostic accuracy as each study reported it")}
      </caption>
      <thead><tr className="border-b border-rule text-left">
        <th scope="col" className="py-1.5 pr-3 label">{L(lang, "งานวิจัย", "Study")}</th>
        <th scope="col" className="py-1.5 pr-3 label">{L(lang, ...DTA_NAME.sens)}</th>
        <th scope="col" className="py-1.5 pr-3 label">{L(lang, ...DTA_NAME.spec)}</th>
        <th scope="col" className="py-1.5 pr-3 label">AUC</th>
        <th scope="col" className="py-1.5 label">n</th>
      </tr></thead>
      <tbody>
        {data.studies.map((s) => (
          <tr key={s.ref} className="border-b border-rule align-top">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal">
              <button type="button" onClick={() => onSelect(s.ref)} title={s.title} className="text-left text-primary underline underline-offset-2">{s.label}</button>
              {s.review && <span className="block text-[0.75rem] text-muted"><Term k="srma" lang={lang}>SR/MA</Term></span>}
            </th>
            <td className="py-1.5 pr-3">{cell(s, "sens")}</td>
            <td className="py-1.5 pr-3">{cell(s, "spec")}</td>
            <td className="py-1.5 pr-3">{cell(s, "auc")}</td>
            <td className="py-1.5">{s.n.kind === "value" ? <VerifiedNumber value={s.n.text} /> : s.n.kind === "blanked" ? <Hole lang={lang} /> : <span className="text-muted">–</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const panels = (["sens", "spec"] as const).filter((m) => data.has[m]);
  // The DTA table is always shown: it is the panels' table twin and the only place AUC and n appear.
  return (
    <figure className="@container grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4" data-dta>
      <figcaption className="font-display text-base font-semibold">{L(lang, "ความแม่นยำในการวินิจฉัย", "Diagnostic accuracy")}</figcaption>
      {panels.length > 0 && (
        <div className="grid gap-6 @[44rem]:grid-cols-2">{panels.map((m) => <DtaPanel key={m} data={data} metric={m} lang={lang} onSelect={onSelect} />)}</div>
      )}
      {/* AUC and n are only in this table: on a phone it scrolls inside its region, with the edge cue */}
      <ScrollRegion lang={lang} bordered={false} label={L(lang, "ตารางความแม่นยำในการวินิจฉัย (เลื่อนดูได้)", "Diagnostic accuracy table (scrollable)")}>
        {table}
      </ScrollRegion>
      <p className="text-[0.82rem] text-muted">
        {L(lang, "ค่าที่แต่ละงานรายงาน (ตรวจกับบทคัดย่อแล้ว) ไม่ได้รวมผลหรือคำนวณค่าอื่นเพิ่ม เช่น PPV หรือความไวรวม · ■ = ค่าที่รายงาน · เส้น = ช่วงความเชื่อมั่น 95%",
          "Values as each study reported them (checked against the abstract); nothing is pooled or derived, such as PPV or a pooled sensitivity · ■ = reported value · line = 95% CI")}
      </p>
    </figure>
  );
}
