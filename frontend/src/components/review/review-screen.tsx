"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getReview } from "@/lib/api";
import { useReview } from "@/lib/use-review";
import { LiveRun } from "./live-run";
import { Report } from "./report";
import { TerminalState } from "./terminal-state";

export function ReviewScreen({ id }: { id: string }) {
  const { review, run, phase, connection, retry } = useReview(id);
  const topic = review?.topic ?? "";
  const [polledPosition, setPolledPosition] = useState<number | null | undefined>(undefined);
  const knownTopic = review?.topic;
  const waiting = phase === "live" && run.status !== "running";

  // While the review waits in the queue (no events yet), refresh its place every few seconds.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      getReview(id).then((r) => setPolledPosition(r.queue_position ?? null)).catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [id, waiting]);
  // Name the tab after the question once it is known (effect only: no hydration mismatch).
  useEffect(() => {
    if (knownTopic) document.title = knownTopic;
  }, [knownTopic]);
  const queuePosition = polledPosition === undefined ? review?.queue_position : polledPosition;

  if (phase === "loading") {
    return <p className="pt-12 text-muted" aria-live="polite">กำลังโหลดรีวิว…</p>;
  }
  if (phase === "notfound") {
    return (
      <section className="grid max-w-[65ch] gap-4 pt-12">
        <h1 className="text-3xl font-bold">ไม่พบรีวิวนี้</h1>
        <p>ลิงก์อาจพิมพ์ผิด หรือรีวิวถูกลบไปแล้ว</p>
        <Link href="/" className="text-primary underline underline-offset-2">กลับไปหน้าแรก</Link>
      </section>
    );
  }
  if (phase === "unavailable") {
    return (
      <section className="grid max-w-[65ch] gap-4 pt-12">
        <h1 className="text-3xl font-bold">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้</h1>
        <p>ลองโหลดหน้านี้ใหม่อีกครั้งในอีกสักครู่ รีวิวที่ส่งไปแล้วยังทำงานต่อบนเซิร์ฟเวอร์</p>
        <button
          type="button"
          onClick={retry}
          className="w-fit rounded-sm border border-primary bg-primary px-4 py-2 font-display font-semibold text-on-primary hover:brightness-110"
        >
          ลองอีกครั้ง
        </button>
      </section>
    );
  }
  if (phase === "terminal" && (run.status === "rejected" || run.status === "error" || run.status === "cancelled")) {
    return <TerminalState status={run.status} message={run.message ?? review?.error} topic={topic} />;
  }
  if (phase === "report" && review) {
    return <Report review={review} />;
  }
  return <LiveRun run={run} topic={topic} connection={connection} queuePosition={queuePosition} startedAt={review?.started_at} />;
}
