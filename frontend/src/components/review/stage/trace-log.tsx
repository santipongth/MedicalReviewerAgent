"use client";
import { useEffect, useRef, useState } from "react";
import { formatElapsed, type Scene } from "@/lib/agent-scene";
import { timelineGroups, type TimelineGroup } from "@/lib/agent-timeline";
import { ICON } from "./icons";
import { StatusMark } from "./status-mark";

const NEAR_PX = 48;
const READ_TAIL = 6;

/** True when the scroll container is (almost) at its bottom. Pure. */
export function nearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, slack = NEAR_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}

/** Right-hand label of a step header: real span values only, no running counter. */
function timeLabel(g: TimelineGroup): string | null {
  if (g.status === "skipped") return "ข้าม";
  if (g.durationS !== null) return `ใช้เวลา ${formatElapsed(g.durationS)}`;
  if (g.status === "active" || g.status === "working") {
    return g.startS !== null ? `กำลังทำ · เริ่ม ${formatElapsed(g.startS)}` : "กำลังทำ";
  }
  return null;
}

function GroupRows({ g, expanded, all, onAll }: { g: TimelineGroup; expanded: boolean; all: boolean; onAll: () => void }) {
  const clip = g.agent === "read" && expanded && !all && g.rows.length > READ_TAIL;
  const rows = clip ? g.rows.slice(-READ_TAIL) : g.rows;
  return (
    <ol id={`trace-${g.id}`} hidden={!expanded} className="border-t border-rule">
      {clip && (
        <li className="px-2 py-1">
          <button type="button" onClick={onAll} className="label min-h-11 md:min-h-0 underline">
            ดูทั้งหมด {g.rows.length} รายการ
          </button>
        </li>
      )}
      {rows.map((r) => (
        <li
          key={r.key}
          data-trace-row
          data-type={r.type}
          className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2 border-b border-rule px-2 py-1 last:border-b-0"
        >
          <span className="font-display tabular-nums text-muted">{formatElapsed(r.elapsed)}</span>
          <span>
            {r.text}
            {r.repeat > 1 && <span className="font-display tabular-nums text-muted"> ×{r.repeat}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function TraceLog({ scene }: { scene: Scene }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // updated on scroll: was the reader near the bottom?
  const [open, setOpen] = useState<Record<string, boolean>>({}); // user choice per group id; absent = default
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  const groups = timelineGroups(scene);
  const lastGroup = groups.length ? groups[groups.length - 1] : null;
  const lastRow = lastGroup ? lastGroup.rows[lastGroup.rows.length - 1] : null;
  useEffect(() => {
    const el = box.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight; // instant: no programmatic scroll events can unstick the log
  }, [lastGroup?.id, lastRow?.key, lastRow?.repeat, lastGroup?.rows.length]);

  return (
    <section aria-labelledby="h-trace">
      <h2 className="label" id="h-trace">บันทึกการทำงาน</h2>
      <div
        ref={box}
        tabIndex={0}
        aria-labelledby="h-trace"
        onScroll={(e) => { stick.current = nearBottom(e.currentTarget); }}
        className="mt-2 max-h-72 overflow-y-auto border border-rule"
      >
        <ul>
          {groups.map((g) => {
            if (!g.agent) {
              return (
                <li key={g.id} data-trace-group="status" className="border-b border-rule text-sm text-muted last:border-b-0">
                  {g.rows.map((row) => (
                    <div key={row.key} data-trace-row data-type={row.type} className="flex items-baseline gap-2 px-2 py-1">
                      <span className="w-16 shrink-0 font-display tabular-nums">{formatElapsed(row.elapsed)}</span>
                      <span>
                        {row.text}
                        {row.repeat > 1 && <span className="font-display tabular-nums"> ×{row.repeat}</span>}
                      </span>
                    </div>
                  ))}
                </li>
              );
            }
            const expanded = open[g.id] ?? g.current;
            const label = timeLabel(g);
            return (
              <li key={g.id} data-trace-group={g.agent} className="border-b border-rule last:border-b-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5">
                  <StatusMark status={g.status} />
                  <svg aria-hidden="true" width={14} height={14} viewBox="-8 -8 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d={ICON[g.agent]} />
                  </svg>
                  <span className="font-display font-semibold">{g.title}</span>
                  {g.summary && <span className="text-sm text-muted">{g.summary}</span>}
                  <span className="ml-auto flex items-center gap-2">
                    {label && <span className="font-display tabular-nums text-xs text-muted">{label}</span>}
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`trace-${g.id}`}
                      onClick={() => setOpen((o) => ({ ...o, [g.id]: !expanded }))}
                      className="label min-h-11 md:min-h-0 px-1 underline"
                    >
                      {expanded ? "ซ่อนรายการ" : `ดู ${g.rows.length} รายการ`}
                    </button>
                  </span>
                </div>
                <GroupRows g={g} expanded={expanded} all={showAll[g.id] ?? false} onAll={() => setShowAll((o) => ({ ...o, [g.id]: true }))} />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
