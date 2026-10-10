"use client";

import { useMemo } from "react";
import type { Lang } from "@/lib/i18n";
import { flowRows, prismaFlow, UNKNOWN_COUNT, type FlowBox, type FlowCount } from "@/lib/prisma-flow";
import type { ReviewTypeOrLegacy } from "@/lib/review-type";
import type { ReviewMethods, Stats } from "@/lib/types";
import { Term } from "../ui/term";
import { L } from "./text";

const COUNT = new Intl.NumberFormat("en-US");
// From a 34rem container (the @[34rem] variants, written out so Tailwind sees them) the flow is the PRISMA 2020 layout:
// stage band, main column, exclusions to the right; narrower, one column with each exclusion box indented under it.

/** A system count (display face, tabular figures), or "unknown" when the result does not record it. */
function Count({ value, lang, n = false }: { value: FlowCount; lang: Lang; n?: boolean }) {
  if (value == null) return <span className="font-display whitespace-nowrap text-muted" data-unknown>{UNKNOWN_COUNT[lang]}</span>;
  return <span className="font-display whitespace-nowrap tabular-nums">{n && "n = "}{COUNT.format(value)}</span>;
}

function Box({ box, lang, side }: { box: FlowBox; lang: Lang; side: boolean }) {
  return (
    <div data-flow-box={box.key}
      className={`grid min-w-0 content-start gap-1.5 rounded-sm border px-3 py-2.5 ${side ? "border-rule bg-ground" : "border-muted bg-surface"}`}>
      <p className="font-display text-[0.88rem] leading-snug font-semibold break-words">{box.title}</p>
      {box.value !== undefined && <p className="text-[1.15rem] leading-tight font-semibold"><Count value={box.value} lang={lang} n /></p>}
      {box.lines.length > 0 && (
        <ul className="grid">
          {box.lines.map((l) => (
            <li key={l.key} data-flow-line={l.key}
              className="flex items-baseline justify-between gap-3 border-t border-rule py-1 text-[0.86rem] first:border-t-0">
              <span className="min-w-0 break-words">
                {l.label}
                {l.note && <span className="block text-[0.76rem] text-muted">{l.note}</span>}
              </span>
              <Count value={l.value} lang={lang} />
            </li>
          ))}
        </ul>
      )}
      {box.notes.map((n) => <p key={n} className="text-[0.76rem] leading-snug text-muted">{n}</p>)}
    </div>
  );
}

function ArrowDown() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 28" className="mx-auto h-7 w-3 text-muted">
      <path d="M6 0V25" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M1.5 20.5L6 26.5L10.5 20.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

/** Narrow layout: the exclusion box hangs off its stage (down, then right). */
function ArrowCorner({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 24" className={`h-6 w-5 shrink-0 text-muted ${className}`}>
      <path d="M3 0V18H17" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M12.5 13.5L18.5 18L12.5 22.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 12" className={`h-3 w-7 text-muted ${className}`}>
      <path d="M0 6H25" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M20.5 1.5L26.5 6L20.5 10.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

/**
 * Study selection (Plan 20 Task 4): a PRISMA 2020 flow (PRISMA-ScR wording for scoping reviews) of ruled boxes built
 * only from result.stats and the per-source counts in result.methods; "unknown" where the result has no count. The
 * same flow is a captioned table behind a "show as table" disclosure.
 */
export function PrismaFlow({ stats, methods, options, type, lang }: {
  stats: Stats | undefined; methods?: ReviewMethods; options?: Record<string, unknown> | null; type: ReviewTypeOrLegacy; lang: Lang;
}) {
  const view = useMemo(() => prismaFlow({ stats, methods, options, type, lang }), [stats, methods, options, type, lang]);
  if (!view) return null;
  const title = L(lang, "แผนภาพการคัดเลือกงานวิจัย", "Study selection flow");
  const rows = flowRows(view);
  const last = view.stages.length - 1;
  return (
    <figure className="@container grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" data-prisma-flow={view.framework}>
      <figcaption className="font-display text-base font-semibold">
        {title} <span className="whitespace-nowrap">(<Term k="prisma" lang={lang}>{view.framework}</Term>)</span>
      </figcaption>
      <ol className="grid min-w-0 grid-cols-[minmax(0,1fr)]" aria-label={`${title} ${view.framework}`}>
        {view.stages.map((st, i) => (
          <li key={st.key} data-flow-stage={st.key}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 @[34rem]:grid-cols-[6.5rem_minmax(0,1fr)_2.25rem_minmax(0,1fr)] @[34rem]:gap-x-0 @[34rem]:gap-y-0">
            <p className={`label @[34rem]:row-span-2 @[34rem]:mr-3 @[34rem]:border-r @[34rem]:border-rule @[34rem]:pt-2.5 @[34rem]:pr-3 ${i === last ? "" : "@[34rem]:pb-7"}`}>
              {st.label}
            </p>
            {/* a short box keeps its own height beside a taller exclusion box; the connector line fills the rest */}
            <div className="flex min-w-0 flex-col">
              <Box box={st.main} lang={lang} side={false} />
              {i < last && <span aria-hidden="true" className="mx-auto hidden w-[1.5px] flex-1 bg-muted @[34rem]:block" />}
            </div>
            {st.side && (
              <>
                <span className="hidden @[34rem]:flex @[34rem]:justify-center @[34rem]:pt-4"><ArrowRight /></span>
                <div className="flex min-w-0 items-start gap-1.5 pl-2 @[34rem]:pl-0">
                  <ArrowCorner className="@[34rem]:hidden" />
                  <div className="grid min-w-0 flex-1"><Box box={st.side} lang={lang} side /></div>
                </div>
              </>
            )}
            {i < last && <span className="@[34rem]:col-start-2"><ArrowDown /></span>}
          </li>
        ))}
      </ol>
      <details className="text-[0.88rem]">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-display font-semibold md:min-h-0">
          {L(lang, "ดูแผนภาพนี้เป็นตาราง", "Show the flow as a table")}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse" data-prisma-table>
            <caption className="pb-1 text-left label">{`${title} (${view.framework})`}</caption>
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="py-1.5 pr-3 text-left label">{L(lang, "ขั้น", "Stage")}</th>
                <th scope="col" className="py-1.5 pr-3 text-left label">{L(lang, "รายการ", "Item")}</th>
                <th scope="col" className="py-1.5 text-right label">{L(lang, "จำนวน", "Count")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-rule align-top">
                  <td className="py-1.5 pr-3 text-muted">{r.stage}</td>
                  <th scope="row" className={`py-1.5 pr-3 text-left break-words ${r.note ? "pl-4 text-[0.82rem] font-normal text-muted" : r.depth ? "pl-4 font-normal" : "font-semibold"}`}>
                    {r.label}
                    {r.detail && <span className="block text-[0.78rem] font-normal text-muted">{r.detail}</span>}
                  </th>
                  <td className="py-1.5 text-right">
                    {r.value !== undefined ? <Count value={r.value} lang={lang} />
                      : <span className="sr-only">{r.note ? L(lang, "หมายเหตุ ไม่มีจำนวน", "note, no count") : L(lang, "ไม่มีจำนวนรวม", "no total")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
