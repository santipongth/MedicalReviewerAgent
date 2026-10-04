"use client";

import { useId } from "react";
import { designKey, designLabel, emptyFilters, isFiltered, type Filters } from "@/lib/charts-data";
import { ROB_LABEL, type Lang } from "@/lib/i18n";
import type { Paper, RiskOfBias } from "@/lib/types";
import { L } from "./text";

const RISKS: RiskOfBias[] = ["low", "moderate", "high", "unclear"];

/** One row of filters above everything it scopes (matrix, charts, paper list). */
export function FilterBar({ papers, filters, onChange, shown, lang }: {
  papers: Paper[]; filters: Filters; onChange: (f: Filters) => void; shown: number; lang: Lang;
}) {
  const id = useId();
  const years = papers.map((p) => p.year).filter((y): y is number => typeof y === "number");
  const minYear = years.length ? Math.min(...years) : null;
  const maxYear = years.length ? Math.max(...years) : null;
  const designs = [...new Set(papers.map((p) => { const c = p.card_en ?? p.card; return c ? designKey(c) : null; })
    .filter((d): d is string => !!d))].sort();
  const yearOptions = minYear != null && maxYear != null ? Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i) : [];
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div role="group" aria-label={L(lang, "ตัวกรอง", "Filters")}
      className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-sm border border-rule bg-ground px-4 py-3 text-[0.88rem]">
      <div className="grid gap-1">
        <label htmlFor={`${id}-rel`} className="label">{L(lang, "ความเกี่ยวข้องขั้นต่ำ", "Minimum relevance")}: <span className="text-ink">{filters.minRelevance}</span></label>
        <input id={`${id}-rel`} type="range" min={0} max={100} step={5} value={filters.minRelevance}
          onChange={(e) => onChange({ ...filters, minRelevance: Number(e.target.value) })} className="w-36 accent-primary" />
      </div>
      {yearOptions.length > 1 && (
        <div className="flex items-end gap-2">
          <div className="grid gap-1">
            <label htmlFor={`${id}-from`} className="label">{L(lang, "ตั้งแต่ปี", "From")}</label>
            <select id={`${id}-from`} value={filters.yearFrom ?? ""} onChange={(e) => onChange({ ...filters, yearFrom: e.target.value ? Number(e.target.value) : null })}
              className="rounded-sm border border-rule bg-surface px-2 py-1 text-ink">
              <option value="">{L(lang, "ทั้งหมด", "Any")}</option>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor={`${id}-to`} className="label">{L(lang, "ถึงปี", "To")}</label>
            <select id={`${id}-to`} value={filters.yearTo ?? ""} onChange={(e) => onChange({ ...filters, yearTo: e.target.value ? Number(e.target.value) : null })}
              className="rounded-sm border border-rule bg-surface px-2 py-1 text-ink">
              <option value="">{L(lang, "ทั้งหมด", "Any")}</option>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      )}
      <fieldset className="grid gap-1">
        <legend className="label">{L(lang, "ความเสี่ยงอคติ", "Risk of bias")}</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {RISKS.map((r) => (
            <label key={r} className="flex items-center gap-1.5">
              <input type="checkbox" checked={filters.risk.includes(r)} onChange={() => onChange({ ...filters, risk: toggle(filters.risk, r) })} className="size-4 accent-primary" />
              {ROB_LABEL[lang][r]}
            </label>
          ))}
        </div>
      </fieldset>
      {designs.length > 1 && (
        <fieldset className="grid gap-1">
          <legend className="label">{L(lang, "รูปแบบการศึกษา", "Study design")}</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {designs.map((d) => (
              <label key={d} className="flex items-center gap-1.5">
                <input type="checkbox" checked={filters.designs.includes(d)} onChange={() => onChange({ ...filters, designs: toggle(filters.designs, d) })} className="size-4 accent-primary" />
                {designLabel(d, lang)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="ml-auto flex items-center gap-3">
        <span aria-live="polite" className="text-muted">{L(lang, `แสดง ${shown} จาก ${papers.length} ฉบับ`, `Showing ${shown} of ${papers.length} studies`)}</span>
        {isFiltered(filters) && (
          <button type="button" onClick={() => onChange(emptyFilters())} className="rounded-sm border border-rule px-2.5 py-0.5 font-display hover:border-ink">
            {L(lang, "ล้างตัวกรอง", "Clear filters")}
          </button>
        )}
      </div>
    </div>
  );
}
