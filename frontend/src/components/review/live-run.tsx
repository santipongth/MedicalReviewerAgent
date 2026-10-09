import { useEffect, useId, useMemo, useState } from "react";
import { CopyLinkButton } from "@/components/ui/copy-link";
import { Term } from "@/components/ui/term";
import { Glyph, UncertainFlag } from "@/components/ui/evidence";
import { DESIGN_LABEL } from "@/lib/i18n";
import { EvidenceBoard } from "./evidence-board";
import { formatElapsed, type Scene } from "@/lib/agent-scene";
import { isReviewType, showsDirection } from "@/lib/review-type";
import { AS_READ_TH, READING_OR_QUEUED, TYPICAL_DURATION_TH } from "@/lib/copy";
import { readCounts, STEPS, type RunState, type StepKey } from "@/lib/progress";
import type { Connection } from "@/lib/use-review";
import { MilestoneStatus } from "./stage/milestone-status";
import { StageLocalize } from "./stage/stage-placeholder";
import { StageView } from "./stage-view";
import { ThoughtCard } from "./thought-card";
import { TraceLog } from "./stage/trace-log";

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
/** A review never runs this long; a larger local clock means a bad `startedAt` or a skewed device clock. */
const MAX_CLOCK_S = 6 * 60 * 60;

/** Seconds since `startedAt` on the local clock, or the last event's `elapsed` when `startedAt` is missing or implausible. */
export function clockElapsed(startedAt: string | null | undefined, now: number, fallback: number): number {
  const started = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(started)) return fallback;
  const s = (now - started) / 1000;
  return s >= 0 && s <= MAX_CLOCK_S ? s : fallback;
}

/** What the agent is doing right now: the agent stage, and a text ledger of steps, counts and each paper read. */
export function LiveRun({ run, scene, topic, connection, queuePosition, startedAt, reviewType }: {
  run: RunState; scene: Scene; topic: string; connection: Connection; queuePosition?: number | null; startedAt?: string | null;
  reviewType?: unknown; // review.options.review_type (unvalidated JSON)
}) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const [readingOpen, setReadingOpen] = useState(false);
  const readingId = useId();
  const elapsed = clockElapsed(startedAt, clock, run.elapsed);
  const waiting = run.status === "connecting" || run.status === "queued";
  const pending = run.reading.filter((r) => r.state === "reading").length;
  // A scoping review never shows a direction: not on the board, the ledger, the thought card or the 3D piles.
  const directions = showsDirection(isReviewType(reviewType) ? reviewType : "legacy");
  const anyDirection = directions && run.reading.some((r) => r.state === "ok" && r.direction);
  const viewScene = useMemo<Scene>(
    () => (directions ? scene : { ...scene, directionless: true, slots: scene.slots.map((sl) => (sl.direction ? { ...sl, direction: null } : sl)) }),
    [scene, directions],
  );
  const activeIdx = STEPS.indexOf(waiting ? "queue" : run.step);
  const counts = readCounts(run);
  const shownQueries = run.queries.slice(0, SHOWN_QUERIES);
  const moreQueries = run.queries.slice(SHOWN_QUERIES);
  return (
    <section aria-labelledby="h-live" className="grid gap-8 pt-10">
      <div className="grid gap-6">
        <div className="grid gap-2">
          <span className="label">กำลังทบทวน</span>
          <h1 id="h-live" className="text-[clamp(1.6rem,3vw,2.25rem)] font-bold break-words">{topic}</h1>
          {/* Only the connecting/queue text is announced; the 1s clock sits outside the live region. */}
          <p className="text-sm text-muted">
            <span aria-live="polite">
              {run.status === "connecting"
                ? "กำลังเชื่อมต่อ…"
                : run.status === "queued"
                  ? (queuePosition ? `อยู่ในคิวลำดับที่ ${queuePosition} จะเริ่มเมื่อถึงคิว` : "อยู่ในคิว จะเริ่มในไม่ช้า")
                  : null}
            </span>
            {!waiting && <>ผ่านไป <span className="font-display tabular-nums">{formatElapsed(elapsed)}</span> · {TYPICAL_DURATION_TH}</>}
          </p>
          {(connection === "reconnecting" || connection === "polling") && (
            <p role="status" className="w-fit rounded-sm bg-warn-bg px-3 py-1.5 text-sm text-ink">
              {connection === "reconnecting" ? "การเชื่อมต่อหลุด กำลังเชื่อมต่อใหม่…" : "ตรวจสถานะทุกไม่กี่วินาที (การเชื่อมต่อสดใช้ไม่ได้)"}
            </p>
          )}
        </div>

        <section aria-labelledby="h-stage" className="grid gap-4 rounded-sm md:border md:border-rule md:bg-surface md:p-4 xl:p-5">
          <StageLocalize.Provider value={scene.expectLocalize}>
            <StageView
              scene={viewScene} connection={connection}
              heading={<h2 id="h-stage" className="label">เวทีเอเจนต์</h2>}
              lead={<ThoughtCard scene={viewScene} framework={reviewType === "scoping" ? "PCC" : "PICO"} />}
            />
          </StageLocalize.Provider>
          <MilestoneStatus scene={scene} />
        </section>

        {directions && <EvidenceBoard scene={scene} />}
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
          <TraceLog scene={scene} />
          {run.reading.length > 0 && (
            <div>
              <span className="label">กำลังอ่าน</span>
              {anyDirection && (
                <p className="mt-1 text-sm text-muted"><Term k="directionTally">ทิศทางผล</Term>{AS_READ_TH}</p>
              )}
              <ul id={readingId} className="mt-2 border-t border-rule">
                {run.reading.map((r) => (
                  // Below lg, unfinished rows fold behind the summary toggle (CSS only, so no hydration shift).
                  <li key={r.ref} data-reading-state={r.state}
                    className={`${r.state === "reading" && !readingOpen ? "hidden lg:grid" : "grid"} grid-cols-[3rem_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-rule py-2 text-[0.92rem]`}>
                    <span className="font-code font-medium">{r.ref}</span>
                    <span className="min-w-0 break-words">{r.title}</span>
                    <span className={`max-w-[9.5rem] text-right sm:max-w-none ${r.state === "failed" ? "text-err" : r.state === "ok" ? "text-ok" : "text-muted"}`}>
                      {r.state === "reading" ? READING_OR_QUEUED : r.state === "failed" ? "อ่านไม่สำเร็จ" : (directions && r.direction) || r.uncertain || (!directions && r.design) ? (
                        <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5">
                          {directions && r.direction && <Glyph direction={r.direction} lang="th" />}
                          {r.design && <span className="hidden text-xs text-muted sm:inline">{DESIGN_LABEL.th[r.design]}</span>}
                          เสร็จ
                          {r.uncertain && <><span aria-hidden="true">·</span><span className="whitespace-nowrap"><Term k="uncertain"><UncertainFlag /></Term></span></>}
                        </span>
                      ) : "เสร็จ"}
                    </span>
                  </li>
                ))}
              </ul>
              {pending > 0 && (
                <button type="button" aria-expanded={readingOpen} aria-controls={readingId}
                  onClick={() => setReadingOpen((v) => !v)}
                  className="mt-2 min-h-11 w-full cursor-pointer rounded-sm border border-rule px-3 text-left text-sm lg:hidden">
                  {readingOpen ? "ซ่อนฉบับที่ยังไม่เสร็จ" : <>อีก <span className="font-display tabular-nums">{pending}</span> ฉบับ{READING_OR_QUEUED}</>}
                </button>
              )}
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
