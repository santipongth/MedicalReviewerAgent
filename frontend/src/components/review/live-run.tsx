import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { CopyLinkButton } from "@/components/ui/copy-link";
import { Term } from "@/components/ui/term";
import { UncertainFlag } from "@/components/ui/evidence";
import type { Scene } from "@/lib/agent-scene";
import { READING_OR_QUEUED, TYPICAL_DURATION_TH } from "@/lib/copy";
import { readCounts, STEPS, type RunState, type StepKey } from "@/lib/progress";
import type { Connection } from "@/lib/use-review";
import { MilestoneStatus } from "./stage/milestone-status";
import { StageLocalize, StagePlaceholder } from "./stage/stage-placeholder";
import { TraceLog } from "./stage/trace-log";

// Client-only chunk (motion lives here); the placeholder reserves the stage's aspect so nothing shifts on load.
// LiveRun renders after the review (and so its language) has loaded, so the placeholder knows whether localize shows.
const AgentStage = dynamic(() => import("./stage/agent-stage").then((m) => m.AgentStage), {
  ssr: false,
  loading: () => <StagePlaceholder />,
});

const STEP_LABEL: Record<StepKey, string> = {
  queue: "รอคิว",
  refine: "ตีความคำถาม",
  search: "ค้น PubMed, arXiv และฐานข้อมูลอื่น",
  screen: "คัดกรองงานวิจัย",
  read: "อ่านและตรวจตัวเลขกับต้นฉบับ",
  synthesize: "สังเคราะห์และสรุปผล",
  done: "เสร็จแล้ว",
};

const SHOWN_QUERIES = 3;

/** What the agent is doing right now: the agent stage, and a text ledger of steps, counts and each paper read. */
export function LiveRun({ run, scene, topic, connection, queuePosition, startedAt }: {
  run: RunState; scene: Scene; topic: string; connection: Connection; queuePosition?: number | null; startedAt?: string | null;
}) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const started = startedAt ? Date.parse(startedAt) : NaN;
  const elapsed = Number.isFinite(started) ? Math.max(0, (clock - started) / 1000) : run.elapsed;
  const waiting = run.status === "connecting" || run.status === "queued";
  const activeIdx = STEPS.indexOf(waiting ? "queue" : run.step);
  const counts = readCounts(run);
  const shownQueries = run.queries.slice(0, SHOWN_QUERIES);
  const moreQueries = run.queries.slice(SHOWN_QUERIES);
  return (
    <section aria-labelledby="h-live" className="grid gap-8 pt-10">
      <div className="grid gap-2">
        <span className="label">กำลังทบทวน</span>
        <h1 id="h-live" className="text-[clamp(1.6rem,3vw,2.25rem)] font-bold break-words">{topic}</h1>
        <p className="text-sm text-muted" aria-live="polite">
          {run.status === "connecting"
            ? "กำลังเชื่อมต่อ…"
            : run.status === "queued"
              ? (queuePosition ? `อยู่ในคิวลำดับที่ ${queuePosition} จะเริ่มเมื่อถึงคิว` : "อยู่ในคิว จะเริ่มในไม่ช้า")
              : `ผ่านไป ${Math.round(elapsed)} วินาที · ${TYPICAL_DURATION_TH}`}
        </p>
        {(connection === "reconnecting" || connection === "polling") && (
          <p role="status" className="w-fit rounded-sm bg-warn-bg px-3 py-1.5 text-sm text-ink">
            {connection === "reconnecting" ? "การเชื่อมต่อหลุด กำลังเชื่อมต่อใหม่…" : "ตรวจสถานะทุกไม่กี่วินาที (การเชื่อมต่อสดใช้ไม่ได้)"}
          </p>
        )}
      </div>

      <div className="grid gap-3">
        <StageLocalize.Provider value={scene.expectLocalize}>
          <AgentStage scene={scene} connection={connection} />
        </StageLocalize.Provider>
        <MilestoneStatus scene={scene} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="grid content-start gap-6">
          <h2 className="label">ความคืบหน้าแบบข้อความ</h2>
          <ol className="grid gap-2 text-[0.95rem]">
            {STEPS.map((s, i) => {
              const done = run.step === "done" || i < activeIdx;
              const now = i === activeIdx;
              return (
                <li key={s} aria-current={now ? "step" : undefined}
                  className={`flex items-baseline gap-2.5 ${now ? "font-semibold" : done ? "" : "text-muted"}`}>
                  <span aria-hidden="true" className={`size-2 flex-none translate-y-[-1px] border ${done ? "border-ink bg-ink" : now ? "border-primary bg-primary" : "border-muted"}`} />
                  <span className="min-w-0">
                    {STEP_LABEL[s]}
                    {s === "search" && (done || now) && run.queries.length > 0 && (
                      <span className="mt-1 grid gap-0.5 font-code text-xs font-normal text-muted">
                        {shownQueries.map((q) => <span key={q} className="break-words">{q}</span>)}
                        {moreQueries.length > 0 && (
                          <details>
                            <summary className="cursor-pointer">และอีก {moreQueries.length} คำค้น</summary>
                            {moreQueries.map((q) => <span key={q} className="block break-words">{q}</span>)}
                          </details>
                        )}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="grid gap-3">
            <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {([
                ["ค้นเจอ", counts.found],
                ["มีบทคัดย่อ", counts.candidates],
                ["ผ่านคัดกรอง", counts.kept],
                ["อ่านแล้ว", `${counts.read}/${counts.kept}`],
              ] as const).map(([label, value]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-display font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="grid content-start gap-6">
          {run.question?.refined_question && (
            <div className="grid gap-2 rounded-sm border border-rule bg-surface p-5">
              <span className="label">เอเจนต์เข้าใจคำถามของคุณว่า</span>
              <p className="font-display text-lg font-semibold leading-snug">{run.question.refined_question}</p>
              {run.question.interpretation && <p className="text-[0.92rem] text-muted">{run.question.interpretation}</p>}
              {!!run.question.sub_questions?.length && (
                <ul className="list-disc pl-5 text-[0.92rem]">
                  {run.question.sub_questions.map((q) => <li key={q}>{q}</li>)}
                </ul>
              )}
              {!!run.question.assumptions?.length && (
                <p className="text-[0.85rem] text-muted">สมมติฐานที่เลือกเอง: {run.question.assumptions.join(" · ")}</p>
              )}
            </div>
          )}
          <TraceLog rows={scene.trace} />
          {run.reading.length > 0 && (
            <div>
              <span className="label">กำลังอ่าน</span>
              <ul className="mt-2 border-t border-rule">
                {run.reading.map((r) => (
                  <li key={r.ref} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-rule py-2 text-[0.92rem]">
                    <span className="font-code font-medium">{r.ref}</span>
                    <span className="min-w-0 break-words">{r.title}</span>
                    <span className={r.state === "failed" ? "text-err" : r.state === "ok" ? "text-ok" : "text-muted"}>
                      {r.state === "reading" ? READING_OR_QUEUED : r.state === "failed" ? "อ่านไม่สำเร็จ" : r.uncertain ? (
                        <>เสร็จ · <Term k="uncertain"><UncertainFlag /></Term></>
                      ) : "เสร็จ"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-2 rounded-sm bg-info-bg p-4 text-[0.92rem]">
            <p>ปิดแท็บนี้ได้ รีวิวยังทำงานต่อบนเซิร์ฟเวอร์ เก็บลิงก์ไว้เพื่อกลับมาดูผล</p>
            <CopyLinkButton />
          </div>
          {run.externalLookup && <p className="text-[0.85rem] text-muted">กำลังปรึกษาเครื่องมือภายนอกที่ผู้ดูแลระบบตั้งไว้</p>}
        </div>
      </div>
    </section>
  );
}
