"use client";

import Link from "next/link";
import { useReview } from "@/lib/use-review";
import { LiveRun } from "./live-run";
import { Report } from "./report";
import { TerminalState } from "./terminal-state";

export function ReviewScreen({ id }: { id: string }) {
  const { review, run, phase, connection } = useReview(id);
  const topic = review?.topic ?? "";

  if (phase === "loading") {
    return <p className="pt-12 text-muted" aria-live="polite">กำลังโหลดรีวิว…</p>;
  }
  if (phase === "notfound") {
    return (
      <section className="grid max-w-[65ch] gap-4 pt-12">
        <h1 className="text-3xl font-bold">ไม่พบรีวิวนี้</h1>
        <p>ลิงก์อาจพิมพ์ผิด หรือรีวิวถูกลบไปแล้ว</p>
        <Link href="/" className="text-primary">กลับไปหน้าแรก</Link>
      </section>
    );
  }
  if (phase === "unavailable") {
    return (
      <section className="grid max-w-[65ch] gap-4 pt-12">
        <h1 className="text-3xl font-bold">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้</h1>
        <p>ลองโหลดหน้านี้ใหม่อีกครั้งในอีกสักครู่ รีวิวที่ส่งไปแล้วยังทำงานต่อบนเซิร์ฟเวอร์</p>
      </section>
    );
  }
  if (phase === "terminal" && (run.status === "rejected" || run.status === "error" || run.status === "cancelled")) {
    return <TerminalState status={run.status} message={run.message ?? review?.error} topic={topic} />;
  }
  if (phase === "report" && review) {
    return <Report review={review} />;
  }
  return <LiveRun run={run} topic={topic} connection={connection} />;
}
