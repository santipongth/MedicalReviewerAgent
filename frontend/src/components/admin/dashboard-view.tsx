"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { EChart } from "@/components/charts/echart";
import { DisclosureChevron } from "@/components/ui/disclosure-chevron";
import { useTheme } from "@/components/theme-toggle";
import { adminApi } from "@/lib/admin-api";
import { STATUS_LABEL, STATUS_ORDER, formatUsd, refusalText } from "@/lib/admin-copy";
import { dashboardChartOption, readStatusColors } from "@/lib/admin-dashboard-view";
import type { Dashboard } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { INPUT, TABLE_REGION, TD, TH } from "./ui";

const RANGES = [7, 30, 90] as const;

/** The backend's "unknown" synthesizer bucket: only finished reviews record their models, so errors, guard
 * rejections, cancellations and reviews still in flight all land there. */
const UNRECORDED_MODEL = "unknown";
const UNRECORDED_MODEL_TEXT = "ไม่ได้บันทึกโมเดล (รีวิวที่ไม่เสร็จ เช่น ผิดพลาด ถูกปฏิเสธ หรือยกเลิก)";

function percent(x: number | null): string {
  return x === null ? "—" : `${(x * 100).toFixed(1)}%`;
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid content-start gap-1 border-t border-rule py-3 sm:pr-6">
      <dt className="label">{label}</dt>
      <dd className="font-display text-[1.25rem] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function DashboardView() {
  const { fail } = useAdmin();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = useTheme();

  useEffect(() => {
    let alive = true;
    adminApi.dashboard(days)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [days, fail]);

  // The colours are read from the active theme, so the chart is rebuilt (and EChart redraws) when the theme is toggled.
  const option = useMemo(() => (data && theme ? dashboardChartOption(data, readStatusColors()) : null), [data, theme]);
  const shown = data ? STATUS_ORDER.filter((s) => (data.totals.by_status[s] ?? 0) > 0) : [];

  return (
    <section aria-labelledby="dash-title" className="py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 id="dash-title" className="font-display text-2xl font-semibold">Dashboard</h1>
        <label className="grid gap-1">
          <span className="label">ช่วงเวลา</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={INPUT}>
            {RANGES.map((n) => <option key={n} value={n}>{n} วันล่าสุด</option>)}
          </select>
        </label>
      </div>
      <p className="mt-2 text-sm text-muted">นับวันตามเวลา UTC เหมือนเพดานรายวันของระบบ</p>
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-3">{error}</p>}
      {!data && !error && <p role="status" className="mt-6 text-muted">กำลังโหลด…</p>}
      {data && (
        <>
          <div className={`mt-6 rounded-sm px-4 py-3 ${data.capacity.accepting ? "bg-info-bg" : "bg-warn-bg"}`}>
            <p className="font-display font-semibold">
              {data.capacity.accepting ? "รับรีวิวใหม่อยู่" : `ไม่รับรีวิวใหม่ตอนนี้: ${refusalText(data.capacity.reason)}`}
            </p>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="inline">คิว </dt><dd className="inline tabular-nums">{`${data.capacity.queued} / ${data.capacity.max_queued_reviews}`}</dd></div>
              <div><dt className="inline">กำลังทำ </dt><dd className="inline tabular-nums">{data.capacity.running}</dd></div>
              <div><dt className="inline">รีวิววันนี้ </dt><dd className="inline tabular-nums">{`${data.capacity.reviews_today} / ${data.capacity.max_reviews_per_day}`}</dd></div>
              <div><dt className="inline">ค่าใช้จ่ายวันนี้ </dt><dd className="inline tabular-nums">{`${formatUsd(data.capacity.usd_today)} / ${formatUsd(data.capacity.max_usd_per_day)}`}</dd></div>
            </dl>
          </div>

          <dl className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="รีวิวทั้งหมด" value={data.totals.reviews} />
            <Stat label="ค่าใช้จ่ายรวม" value={formatUsd(data.totals.cost_usd)} />
            <Stat label="เฉลี่ยต่อรีวิวที่เสร็จ" value={data.totals.avg_cost_done_usd === null ? "—" : formatUsd(data.totals.avg_cost_done_usd)} />
            <Stat label="Error rate 7 วัน" value={percent(data.error_rate_7d)} />
          </dl>

          {option && (
            <figure className="mt-8">
              <figcaption className="label">รีวิวต่อวันแยกตามสถานะ และค่าใช้จ่ายต่อวัน</figcaption>
              <EChart option={option} height={280} label="จำนวนรีวิวต่อวันแยกตามสถานะ และค่าใช้จ่ายต่อวัน (USD)" />
            </figure>
          )}

          <details className="group mt-3">
            <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-display font-semibold">
              <DisclosureChevron />
              ดูเป็นตาราง
            </summary>
            <div className={TABLE_REGION} role="region" aria-label="ตารางรายวัน" tabIndex={0}>
              <table className="w-full border-collapse text-sm tabular-nums">
                <caption className="sr-only">รีวิวและค่าใช้จ่ายรายวัน (UTC)</caption>
                <thead><tr><th scope="col" className={TH}>วันที่</th>
                  {shown.map((s) => <th key={s} scope="col" className={TH}>{STATUS_LABEL[s]}</th>)}
                  <th scope="col" className={TH}>ค่าใช้จ่าย</th></tr></thead>
                <tbody>{data.per_day.map((p) => (
                  <tr key={p.date}><th scope="row" className={TD}>{p.date}</th>
                    {shown.map((s) => <td key={s} className={TD}>{p.by_status[s] ?? 0}</td>)}
                    <td className={TD}>{formatUsd(p.cost_usd)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>

          <div className={TABLE_REGION} role="region" aria-label="ค่าใช้จ่ายแยกตามโมเดล" tabIndex={0}>
            <table className="w-full border-collapse text-sm">
              <caption className="px-3 py-2 text-left text-muted">
                ค่าใช้จ่ายของรีวิว แยกตามโมเดล synthesizer (ระบบบันทึกค่าใช้จ่ายต่อรีวิว ไม่ได้แยกต่อโมเดล)
              </caption>
              <thead><tr><th scope="col" className={TH}>โมเดล</th><th scope="col" className={TH}>รีวิว</th>
                <th scope="col" className={TH}>ค่าใช้จ่าย</th></tr></thead>
              <tbody>{data.by_model.map((m) => (
                <tr key={m.synthesizer}>
                  <th scope="row" className={`${TD} font-normal ${m.synthesizer === UNRECORDED_MODEL ? "text-muted" : "break-all"}`}>
                    {m.synthesizer === UNRECORDED_MODEL ? UNRECORDED_MODEL_TEXT : m.synthesizer}
                  </th>
                  <td className={`${TD} tabular-nums`}>{m.reviews}</td><td className={`${TD} tabular-nums`}>{formatUsd(m.cost_usd)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
