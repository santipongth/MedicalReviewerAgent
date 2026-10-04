"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getReview, listRecent } from "@/lib/api";
import { findReported, pickReceipt, type Receipt, type Reported } from "@/lib/evidence";
import type { ReviewSummary } from "@/lib/types";
import { VerifiedNumber } from "../ui/evidence";

type Loaded = { recent: ReviewSummary[]; receipt: Receipt | null; receiptId: string | null };

/** The verbatim quote with the verified number marked at its exact position (never inside another number). */
export function HighlightedQuote({ quote, number }: { quote: string; number: Reported | null }) {
  if (!number) return <>&ldquo;{quote}&rdquo;</>;
  const { index, text } = number;
  return (
    <>
      &ldquo;{quote.slice(0, index)}
      <mark className="bg-highlight px-0.5 text-[var(--highlight-ink)]">{text}</mark>
      {quote.slice(index + text.length)}&rdquo;
    </>
  );
}

/** Instead of a logo wall: one real verified number from a public review, with the sentence it came from. */
export function ReceiptPanel() {
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let recent: ReviewSummary[] = [];
      try {
        recent = (await listRecent(10)).filter((r) => r.status === "done");
      } catch {
        recent = [];
      }
      let receipt: Receipt | null = null;
      let receiptId: string | null = null;
      for (const r of recent.slice(0, 3)) {
        try {
          receipt = pickReceipt((await getReview(r.id)).result);
        } catch {
          receipt = null;
        }
        if (receipt) {
          receiptId = r.id;
          break;
        }
      }
      if (alive) setData({ recent, receipt, receiptId });
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <aside aria-label="หลักฐานจากรีวิวล่าสุด" className="grid content-start gap-4 rounded-sm border border-rule bg-rail p-6">
      <span className="label">หลักฐานจากรีวิวล่าสุด</span>
      {data === null ? (
        <p className="text-sm text-muted">กำลังโหลดรีวิวล่าสุด…</p>
      ) : data.receipt ? (
        <>
          <div className="text-[2.4rem] leading-none"><VerifiedNumber value={data.receipt.display} /></div>
          <p className="font-quote text-[1.05rem] leading-relaxed">
            <HighlightedQuote quote={data.receipt.quote} number={findReported(data.receipt.value, data.receipt.quote)} />
          </p>
          <p className="text-[0.85rem] text-muted">
            {data.receipt.design}
            {data.receipt.sampleSize ? <> · n = <VerifiedNumber value={data.receipt.sampleSize} /></> : null}
            {" · "}ประโยคนี้พบในบทความต้นฉบับตรงทุกตัวอักษร{" "}
            {data.receiptId && <Link href={`/r/${data.receiptId}`} className="text-primary underline underline-offset-2">ดูรายงาน</Link>}
          </p>
        </>
      ) : (
        <p className="text-[0.92rem] text-muted">
          ยังไม่มีรีวิวสาธารณะที่เสร็จแล้ว ทุกตัวเลขในรายงานจะถูกตรวจกับประโยคต้นฉบับก่อนแสดง
          ตัวเลขที่ตรวจผ่านจะมีเส้นใต้ลายทแยงแบบเทปฆ่าเชื้อ และค่าที่ตรวจไม่ผ่านจะแสดงเป็นช่องว่าง “ไม่ยืนยัน”
        </p>
      )}
      {data && data.recent.length > 0 && (
        <div>
          <span className="label">รีวิวล่าสุด · สัดส่วนตัวเลขที่ตรวจผ่าน</span>
          <ul className="mt-2 border-t border-rule">
            {data.recent.map((r) => (
              <li key={r.id} className="border-b border-rule">
                <Link href={`/r/${r.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2.5 text-ink hover:text-primary">
                  <span className="min-w-0 break-words">{r.topic}</span>
                  {r.verification_rate != null ? (
                    <span className="font-num text-[0.9rem] [font-stretch:87.5%]">{`${Math.round(r.verification_rate * 100)}%`}</span>
                  ) : (
                    <span className="text-sm text-muted">–</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
