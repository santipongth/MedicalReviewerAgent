"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getReview } from "@/lib/api";
import { isQuickReview } from "@/lib/quick";
import { FALLBACK_TITLE, isPersonalRefusal } from "@/lib/title";
import { readAudience, saveAudience } from "@/lib/use-audience";
import { useReview } from "@/lib/use-review";
import { LiveRun } from "./live-run";
import { QuickAnswer } from "./quick-answer";
import { Report } from "./report";
import { TerminalState } from "./terminal-state";

export function ReviewScreen({ id }: { id: string }) {
  const { review, run, scene, phase, connection, retry } = useReview(id);
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
  // Plan 26: not for a personal medical refusal, whose page shows no topic (nor the tab, history or previews).
  const personalRefusal = phase === "terminal" && run.status === "rejected"
    && isPersonalRefusal(run.code ?? review?.refusal_code, run.message ?? review?.error);
  useEffect(() => {
    if (personalRefusal) document.title = FALLBACK_TITLE;
    else if (knownTopic) document.title = knownTopic;
  }, [knownTopic, personalRefusal]);
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
    return <TerminalState status={run.status} message={run.message ?? review?.error} topic={topic}
      code={run.code ?? review?.refusal_code} />;
  }
  if (phase === "report" && review && isQuickReview(review)) {
    return <QuickAnswer review={review} />; // Plan 27: the short answer with numbered references
  }
  if (phase === "report" && review) {
    // Plan 26: the view comes from ?view= or the stored choice; a change is stored and put in the address
    return <Report review={review} initialAudience={readAudience()} onAudience={saveAudience} />;
  }
  return <LiveRun run={run} scene={scene} topic={topic} connection={connection} queuePosition={queuePosition} startedAt={review?.started_at}
    reviewType={review?.options?.review_type} />;
}
