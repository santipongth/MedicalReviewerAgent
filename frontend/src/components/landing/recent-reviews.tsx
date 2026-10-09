"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listRecent } from "@/lib/api";
import type { ReviewSummary } from "@/lib/types";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ok"; rows: ReviewSummary[] };

const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_4rem_7rem_3.5rem]";
const rtf = new Intl.RelativeTimeFormat("th", { numeric: "auto" });

function ago(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Number.isNaN(minutes)) return "";
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  if (Math.abs(minutes) < 60 * 24) return rtf.format(Math.round(minutes / 60), "hour");
  return rtf.format(Math.round(minutes / (60 * 24)), "day");
}

/** Finished public reviews; the right-hand figure is the share of numbers that passed verification. */
export function RecentReviews() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      let next: State;
      try {
        next = { kind: "ok", rows: (await listRecent(10)).filter((r) => r.status === "done").slice(0, 8) };
      } catch {
        next = { kind: "error" };
      }
      if (alive) setState(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section aria-labelledby="h-recent" className="grid gap-6 border-t border-rule pt-10">
      <div className="grid max-w-[65ch] gap-3">
        <h2 id="h-recent" className="text-[1.75rem] font-bold">รีวิวสาธารณะล่าสุด</h2>
        <p className="text-muted">ทุกฉบับเปิดอ่านได้ ตัวเลขทางขวาคือสัดส่วนตัวเลขที่ตรวจผ่าน ที่เหลือแสดงเป็นช่องว่าง</p>
      </div>
      {state.kind === "loading" && <p className="text-[0.92rem] text-muted">กำลังโหลดรีวิวล่าสุด…</p>}
      {state.kind === "error" && (
        <p className="text-[0.92rem] text-muted">โหลดรายการไม่ได้ตอนนี้ ส่วนอื่นของหน้ายังใช้ได้ตามปกติ</p>
      )}
      {state.kind === "ok" && state.rows.length === 0 && (
        <p className="text-[0.92rem] text-muted">ยังไม่มีรีวิวสาธารณะที่เสร็จแล้ว รีวิวแรกของคุณจะปรากฏที่นี่</p>
      )}
      {state.kind === "ok" && state.rows.length > 0 && (
        <>
        <div aria-hidden="true" className={`${ROW} label border-t border-rule pt-3`}>
          <span className="hidden sm:inline">หัวข้อ</span>
          <span className="text-right sm:order-last"><span className="sm:hidden">ตรวจผ่าน</span><span className="hidden sm:inline">ตัวเลขตรวจผ่าน</span></span>
          <span className="hidden sm:inline">ภาษา</span>
          <span className="hidden sm:inline">เมื่อ</span>
        </div>
        <ul>
          {state.rows.map((r) => (
            <li key={r.id} className="border-b border-rule">
              <Link href={`/r/${r.id}`}
                className={`${ROW} py-3 text-ink hover:text-primary`}>
                <span className="min-w-0 break-words font-display font-medium">{r.topic}</span>
                <span className="text-right font-display tabular-nums sm:order-last">
                  {r.verification_rate != null
                    ? <><span data-testid="share">{Math.round(r.verification_rate * 100)}%</span><span className="sr-only"> ตัวเลขตรวจผ่าน</span></>
                    : <span className="text-muted">–</span>}
                </span>
                <span className="text-[0.8rem] text-muted">{r.language === "th" ? "ไทย" : "English"}</span>
                <span className="text-[0.8rem] text-muted">{ago(r.finished_at ?? r.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  );
}
