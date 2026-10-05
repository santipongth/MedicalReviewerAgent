"use client";

import { forestAxis, type ForestGroup, type ForestRow } from "@/lib/charts-data";
import { DIRECTION_LABEL } from "@/lib/i18n";
import { Glyph, VerifiedNumber } from "../ui/evidence";

export const rowKey = (r: ForestRow) => `${r.ref}|${r.outcomeKey}`;

// Axis ticks are positions on the scale, not values from a paper.
const TICKS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/**
 * A light forest plot for the landing page: one button per verified row on one log scale, the null line at 1.
 * Positions come from charts-data rows only; every printed value is the paper's own spelling.
 */
export function MiniForest({ group, selected, onSelect, sub }: {
  group: ForestGroup;
  selected: string | null;
  onSelect: (key: string) => void;
  sub: (ref: string) => string;
}) {
  const [lo, hi] = forestAxis(group);
  const x = (v: number) => ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * 100;
  const ticks = TICKS.filter((t) => x(t) >= 4 && x(t) <= 94); // keep labels inside the plot
  const tracks = "grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 sm:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,11rem)]";
  const cols = `grid ${tracks}`;

  return (
    <div>
      <ul className="border-t border-rule">
        {group.rows.map((r) => {
          const key = rowKey(r);
          const on = key === selected;
          const left = x(r.lo ?? r.value);
          const right = x(r.hi ?? r.value);
          const name = `${r.ref} ${r.valueText}${r.ciText ? ` 95% CI ${r.ciText}` : ""}, ${DIRECTION_LABEL.th[r.direction]}`;
          return (
            <li key={key} className="border-b border-rule">
              <button type="button" aria-pressed={on} aria-label={name} onClick={() => onSelect(key)}
                className={`${cols} w-full items-center px-2 py-2 text-left transition-colors duration-150 hover:bg-rail ${on ? "bg-rail outline outline-1 -outline-offset-1 outline-ink" : ""}`}>
                <span className="grid min-w-0 leading-tight">
                  <b className="font-display text-[0.95rem]">{r.ref}</b>
                  <span className="text-[0.78rem] text-muted">{sub(r.ref)}</span>
                  <span className="mt-1 text-[0.8rem] sm:hidden"><VerifiedNumber value={r.valueText} /></span>
                </span>
                <span aria-hidden="true" className="relative h-7">
                  <span data-testid="null-line" className="absolute -inset-y-2 w-px bg-ink" style={{ left: `${x(1)}%` }} />
                  <span data-part="ci" className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-muted"
                    style={{ left: `${left}%`, width: `${Math.max(right - left, 0)}%` }} />
                  <span data-part="point" className="absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center"
                    style={{ left: `${x(r.value)}%` }}>
                    <Glyph direction={r.direction} lang="th" />
                  </span>
                </span>
                <span className="hidden min-w-0 text-[0.8rem] sm:block">
                  <VerifiedNumber value={r.valueText} />
                  {r.ciText && <> <span className="text-muted">(</span><VerifiedNumber value={r.ciText} /><span className="text-muted">)</span></>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className={`${cols} px-2 pt-1`} aria-hidden="true">
        <span />
        <span className="relative h-5 font-display text-[0.75rem] tabular-nums text-muted">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${x(t)}%` }}>{t}</span>
          ))}
        </span>
      </div>
      <div className={`hidden ${tracks} px-2 text-[0.78rem] text-muted sm:grid`} aria-hidden="true">
        <span />
        <span className="relative h-5 whitespace-nowrap">
          <span className="absolute pr-1.5" style={{ right: `${100 - x(1)}%` }}>← น้อยลง</span>
          <span className="absolute right-0">มากขึ้น →</span>
        </span>
      </div>
      <p className="mt-1 px-2 text-[0.8rem] text-muted">อัตราส่วนต่ำกว่า 1 แปลว่าเกิดเหตุการณ์น้อยลงในกลุ่มที่ได้ colchicine</p>
    </div>
  );
}
