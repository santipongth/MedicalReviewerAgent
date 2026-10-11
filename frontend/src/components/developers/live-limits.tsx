"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getStatus } from "@/lib/api";
import type { ServiceStatus } from "@/lib/types";

const UNIT: Record<string, string> = { second: "วินาที", minute: "นาที", hour: "ชั่วโมง", day: "วัน" };

/** "5/hour" → "5 รีวิวต่อชั่วโมง" (limits strings come from the API, never hard-coded here). */
function perPeriod(limit: string, what: string): string {
  const [n, unit] = limit.split("/");
  return `${n} ${what}ต่อ${UNIT[unit?.trim()] ?? unit}`;
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note: ReactNode }) {
  return (
    <div className="grid content-start gap-1 border-t border-rule py-4 sm:pr-6">
      <dt className="label">{label}</dt>
      <dd className="font-display text-[1.25rem] font-semibold leading-snug tabular-nums">{value}</dd>
      <dd className="text-[0.9rem] leading-[1.6] text-muted">{note}</dd>
    </div>
  );
}

/** The limits the running service enforces, read live from GET /api/v1/status: service counts, not numbers from a paper. */
export function LiveLimits() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getStatus().then((s) => alive && setStatus(s)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  if (failed) return <p className="text-muted">อ่านขีดจำกัดปัจจุบันไม่ได้ ดูได้ที่ GET /api/v1/status</p>;
  if (!status) return <p className="text-muted">กำลังอ่านขีดจำกัดปัจจุบัน…</p>;
  const l = status.limits;
  return (
    <div className="grid gap-3">
      <dl data-testid="live-limits" className="grid sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="ไม่ใช้ API key" value={perPeriod(l.review_rate_limit, "รีวิว")} note="ต่อ IP" />
        <Tile label="มี API key" value={perPeriod(l.api_key_rate_limit, "รีวิว")} note="ต่อ key และโควตารายวันของแต่ละ key" />
        <Tile label="งานวิจัยต่อรีวิว" value={`${l.max_papers.min}–${l.max_papers.max} ฉบับ`}
          note={`ค่าเริ่มต้น ${l.max_papers.default} · คัดกรองจากผู้สมัคร ${l.candidate_limit.min}–${l.candidate_limit.max} ฉบับ (ค่าเริ่มต้น ${l.candidate_limit.default})`} />
        <Tile label="ตอนนี้" value={status.accepting ? "เปิดรับรีวิวใหม่" : "ปิดรับรีวิวใหม่ชั่วคราว"}
          note={`คิวรอ ${status.queue_depth} · กำลังทำ ${status.running} · คิวรับได้สูงสุด ${l.max_queued_reviews}`} />
      </dl>
      <p className="text-[0.9rem] text-muted">
        ค้นงานวิจัย: {perPeriod(l.paper_search_rate_limit, "ครั้ง")}
        {l.sse_max_per_ip != null && ` · สตรีมสดพร้อมกันได้ ${l.sse_max_per_ip} รายการต่อผู้ใช้`}
      </p>
    </div>
  );
}
