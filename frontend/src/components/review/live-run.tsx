import { STEPS, type RunState, type StepKey } from "@/lib/progress";
import type { Connection } from "@/lib/use-review";

const STEP_LABEL: Record<StepKey, string> = {
  queue: "รอคิว",
  refine: "ตีความคำถาม",
  search: "ค้น PubMed, arXiv และฐานข้อมูลอื่น",
  screen: "คัดกรองงานวิจัย",
  read: "อ่านและตรวจตัวเลขกับต้นฉบับ",
  synthesize: "สังเคราะห์และสรุปผล",
  done: "เสร็จแล้ว",
};

const WELL_CLASS = {
  empty: "border-rule bg-surface",
  found: "border-muted bg-rail",
  out: "border-dashed border-rule bg-transparent",
  cap: "border-primary bg-primary shadow-[inset_0_0_0_4px_var(--surface)]",
} as const;

/** What the agent is doing right now: steps, the specimen tray (20 candidates → 8 capped) and each paper read. */
export function LiveRun({ run, topic, connection, queuePosition }: {
  run: RunState; topic: string; connection: Connection; queuePosition?: number | null;
}) {
  const activeIdx = STEPS.indexOf(run.step);
  return (
    <section aria-labelledby="h-live" className="grid gap-8 pt-10">
      <div className="grid gap-2">
        <span className="label">กำลังทบทวน</span>
        <h1 id="h-live" className="text-[clamp(1.6rem,3vw,2.25rem)] font-bold break-words">{topic}</h1>
        <p className="text-sm text-muted" aria-live="polite">
          {run.status === "queued"
            ? (queuePosition ? `อยู่ในคิวลำดับที่ ${queuePosition} จะเริ่มเมื่อถึงคิว` : "อยู่ในคิว จะเริ่มในไม่ช้า")
            : `ผ่านไป ${Math.round(run.elapsed)} วินาที`}
        </p>
        {(connection === "reconnecting" || connection === "polling") && (
          <p role="status" className="w-fit rounded-sm bg-warn-bg px-3 py-1.5 text-sm text-ink">
            {connection === "reconnecting" ? "การเชื่อมต่อหลุด กำลังเชื่อมต่อใหม่…" : "ตรวจสถานะทุกไม่กี่วินาที (การเชื่อมต่อสดใช้ไม่ได้)"}
          </p>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          <ol className="grid gap-2 text-[0.95rem]">
            {STEPS.map((s, i) => {
              const done = run.step === "done" || i < activeIdx;
              const now = i === activeIdx;
              return (
                <li key={s} aria-current={now ? "step" : undefined}
                  className={`flex items-baseline gap-2.5 ${now ? "font-semibold" : done ? "" : "text-muted"}`}>
                  <span aria-hidden="true" className={`size-2 flex-none translate-y-[-1px] border ${done ? "border-ink bg-ink" : now ? "border-primary bg-primary" : "border-muted"}`} />
                  {STEP_LABEL[s]}
                </li>
              );
            })}
          </ol>
          <div>
            <div className="grid w-fit grid-cols-10 gap-1.5" aria-label={`งานวิจัยที่มีบทคัดย่อ ${run.candidates} ฉบับ เลือกวิเคราะห์ ${run.kept} ฉบับ`} role="img">
              {run.wells.map((w, i) => (
                <span key={i} data-testid={`well-${w}`}
                  className={`size-5 rounded-full border transition-[background,border-color] duration-200 ${WELL_CLASS[w]}`} />
              ))}
            </div>
            <p className="mt-3 text-[0.85rem] text-muted">
              หลุมละหนึ่งงานวิจัยที่มีบทคัดย่อ: เติมเมื่อค้นเจอ ว่างเมื่อถูกคัดออก ปิดฝาเมื่อเป็นฉบับที่เลือกวิเคราะห์
              {run.found > 0 && ` · ค้นเจอทั้งหมด ${run.found} รายการก่อนตัดซ้ำ`}
            </p>
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
          {run.reading.length > 0 && (
            <div>
              <span className="label">กำลังอ่าน</span>
              <ul className="mt-2 border-t border-rule">
                {run.reading.map((r) => (
                  <li key={r.ref} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-rule py-2 text-[0.92rem]">
                    <span className="num-verified !font-medium after:hidden">{r.ref}</span>
                    <span className="min-w-0 break-words">{r.title}</span>
                    <span className={r.state === "failed" ? "text-err" : r.state === "ok" ? "text-ok" : "text-muted"}>
                      {r.state === "reading" ? "กำลังอ่าน…" : r.state === "failed" ? "อ่านไม่สำเร็จ" : r.uncertain ? "เสร็จ · ไม่แน่นอน" : "เสร็จ"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {run.externalLookup && <p className="text-[0.85rem] text-muted">กำลังปรึกษาเครื่องมือภายนอกที่ผู้ดูแลระบบตั้งไว้</p>}
        </div>
      </div>
    </section>
  );
}
