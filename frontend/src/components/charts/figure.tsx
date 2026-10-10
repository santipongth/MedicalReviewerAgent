"use client";

import { useState, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import { RC } from "@/lib/i18n-report";
import { L } from "../review/text";

/**
 * A figure with an optional title, the chart, and its table-view twin (the accessible equivalent). With no title the
 * section heading above names it (no caption that repeats the heading).
 */
export function Figure({ title, caption, lang, chart, table, defaultTable = false, label }: {
  title?: ReactNode; caption?: ReactNode; lang: Lang; chart: ReactNode; table: ReactNode; defaultTable?: boolean; label?: string;
}) {
  const [asTable, setAsTable] = useState(defaultTable);
  return (
    <figure className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" aria-label={title ? undefined : label}>
      <div className={`flex flex-wrap items-baseline gap-2 ${title ? "justify-between" : "justify-end"}`}>
        {title && <figcaption className="min-w-0 font-display text-base font-semibold break-words">{title}</figcaption>}
        <button type="button" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}
          className="inline-flex min-h-11 items-center rounded-sm border border-rule px-2.5 py-0.5 font-display text-[0.8rem] hover:border-ink md:min-h-0 print:hidden">
          {L(lang, asTable ? RC.charts.showChart : RC.charts.showTable)}
        </button>
      </div>
      {asTable ? <div className="overflow-x-auto">{table}</div> : chart}
      {caption && <div className="text-[0.82rem] text-muted">{caption}</div>}
    </figure>
  );
}
