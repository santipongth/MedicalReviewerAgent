"use client";

import { useEffect, useState } from "react";
import { getStatus } from "@/lib/api";
import type { ServiceStatus } from "@/lib/types";

const UNIT: Record<string, string> = { second: "วินาที", minute: "นาที", hour: "ชั่วโมง", day: "วัน" };

/** "5/hour" → "5 รีวิวต่อชั่วโมง" (limits strings come from the API, never hard-coded here). */
function perPeriod(limit: string, what: string): string {
  const [n, unit] = limit.split("/");
  return `${n} ${what}ต่อ${UNIT[unit?.trim()] ?? unit}`;
}

/** The limits the running service enforces, read live from GET /api/v1/status. */
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
    <ul className="grid max-w-[65ch] list-disc gap-1.5 pl-5">
      <li>ไม่ใช้ API key: {perPeriod(l.review_rate_limit, "รีวิว")} ต่อ IP · มี API key: {perPeriod(l.api_key_rate_limit, "รีวิว")} ต่อ key (และโควตารายวันของ key)</li>
      <li>ค้นงานวิจัย: {perPeriod(l.paper_search_rate_limit, "ครั้ง")}</li>
      <li>จำนวนงานวิจัยที่วิเคราะห์ต่อรีวิว {l.max_papers.min}–{l.max_papers.max} ฉบับ (ค่าเริ่มต้น {l.max_papers.default}) จากผู้สมัคร {l.candidate_limit.min}–{l.candidate_limit.max} ฉบับ (ค่าเริ่มต้น {l.candidate_limit.default})</li>
      <li>ตอนนี้: คิวรอ {status.queue_depth} · กำลังทำ {status.running} · {status.accepting ? "เปิดรับรีวิวใหม่" : "ปิดรับรีวิวใหม่ชั่วคราว"} (คิวรับได้สูงสุด {l.max_queued_reviews})</li>
    </ul>
  );
}
