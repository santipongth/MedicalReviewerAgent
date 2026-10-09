import { useId, useState } from "react";
import { Glyph, FLAG_PATHS } from "@/components/ui/evidence";
import { Term } from "@/components/ui/term";
import { PACKET_CAP, type Scene } from "@/lib/agent-scene";
import { AS_READ_TH, POOLED_OVERLAP_TH } from "@/lib/copy";
import { DESIGN_LABEL, DIRECTION_LABEL } from "@/lib/i18n";
import { DIRECTION_ORDER, liveTally } from "@/lib/live-evidence";

const DISAGREE_TH = "สองโมเดลอ่านต่างกัน";

function Flag() {
  return (
    <span className="inline-flex flex-none items-center text-warn">
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <path d={FLAG_PATHS[0]} />
        <path d={FLAG_PATHS[1]} />
      </svg>
      <span className="sr-only">{DISAGREE_TH}</span>
    </span>
  );
}

/**
 * Per-paper directions as the agent read them, straight from finished `extracted` events. Fixed order, no ranking,
 * no percentages, no conclusion; the report's synthesis is the only conclusion. Not a live region.
 */
export function EvidenceBoard({ scene }: { scene: Scene }) {
  const [mountSeq] = useState(scene.lastSeq);
  const [open, setOpen] = useState(false);
  const detailId = useId();
  if (scene.slots.length === 0) return null;
  const tally = liveTally(scene);
  const read = tally.counted + tally.noDirection + tally.failed;
  const fresh = new Set(
    DIRECTION_ORDER.flatMap((d) => tally.groups[d]).map((it) => it.key).filter((k) => k > mountSeq).sort((a, b) => b - a).slice(0, PACKET_CAP),
  );
  const synthesizing = scene.agents.synth === "active" || scene.agents.synth === "working";
  const empty = tally.counted === 0 && tally.noDirection === 0 && tally.failed === 0;
  return (
    <section aria-labelledby="h-evidence" className="grid gap-3 rounded-sm border border-rule bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="grid gap-1">
          <h2 id="h-evidence" className="label">กระดานหลักฐานสด</h2>
          <p className="text-sm text-muted"><Term k="directionTally">ทิศทางผล</Term>{AS_READ_TH} · ยังไม่ใช่ข้อสรุป</p>
        </div>
        <span className="font-display tabular-nums text-sm">อ่านเสร็จ {read}/{tally.total}</span>
      </div>

      {empty && <p className="text-sm text-muted">ยังไม่มีงานที่อ่านเสร็จ</p>}

      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {DIRECTION_ORDER.map((d) => {
          const n = tally.groups[d].length;
          return (
            <li key={d} data-evidence-dir={d} data-count={n} className={`flex items-center gap-1.5 ${n === 0 ? "text-muted" : ""}`}>
              <Glyph direction={d} lang="th" />
              <span>{DIRECTION_LABEL.th[d]}</span>
              <span className="font-display font-semibold tabular-nums">{n}</span>
            </li>
          );
        })}
      </ul>

      {!empty && (
        <>
          <button type="button" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((v) => !v)}
            className="min-h-11 w-fit cursor-pointer rounded-sm border border-rule px-3 text-sm lg:hidden">
            {open ? "ซ่อนรายฉบับ" : "ดูรายฉบับ"}
          </button>
          <div id={detailId} className={`${open ? "grid" : "hidden lg:grid"} gap-4 sm:grid-cols-2 lg:grid-cols-5`}>
            {DIRECTION_ORDER.map((d) => (
              <div key={d} className="flex min-w-0 flex-wrap content-start gap-1.5">
                {tally.groups[d].map((it) => (
                  <span key={it.ref} data-evidence-chip={it.ref}
                    className={`inline-flex items-center gap-1 rounded-sm border border-rule px-1.5 py-0.5 ${fresh.has(it.key) ? "motion-safe:animate-[evidence-in_200ms_ease-out] motion-reduce:animate-none" : ""}`}>
                    <Glyph direction={d} lang="th" />
                    <span className="font-code text-xs">{it.ref}</span>
                    {it.design && <span className="text-xs text-muted">{DESIGN_LABEL.th[it.design]}</span>}
                    {it.uncertain && <Flag />}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {(tally.pooled > 0 || tally.noDirection > 0 || tally.failed > 0 || tally.uncertain > 0 || synthesizing) && (
        <div className="grid gap-1 text-[0.82rem] text-muted">
          {tally.pooled > 0 && <p>{POOLED_OVERLAP_TH}</p>}
          {tally.noDirection > 0 && <p>อีก {tally.noDirection} ฉบับอ่านเสร็จแต่ไม่มีข้อมูลทิศทาง</p>}
          {tally.failed > 0 && <p>อ่านไม่สำเร็จ {tally.failed} ฉบับ (ไม่นับ)</p>}
          {tally.uncertain > 0 && <p>มี {tally.uncertain} ฉบับที่<Term k="uncertain">{DISAGREE_TH}</Term></p>}
          {synthesizing && <p>เอเจนต์กำลังเทียบผลเหล่านี้ ผลสรุปจะอยู่ในรายงาน</p>}
        </div>
      )}
    </section>
  );
}
