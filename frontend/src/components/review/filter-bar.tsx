"use client";

import { useId, useState } from "react";
import { designKey, designLabel, emptyFilters, isFiltered, type Filters } from "@/lib/charts-data";
import { ROB_LABEL, type Lang } from "@/lib/i18n";
import type { Paper, RiskOfBias } from "@/lib/types";
import { Term } from "../ui/term";
import { L } from "./text";

const RISKS: RiskOfBias[] = ["low", "moderate", "high", "unclear"];

/** One-line reminder above the charts and the paper list when filters hide some papers. */
export function FilterStatus({ filters, onChange, shown, total, lang }: {
  filters: Filters; onChange: (f: Filters) => void; shown: number; total: number; lang: Lang;
}) {
  if (!isFiltered(filters)) return null;
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm bg-info-bg px-3 py-2 text-[0.88rem]">
      <span>{L(lang, `กำลังกรอง: แสดง ${shown} จาก ${total} ฉบับ`, `Filtering: showing ${shown} of ${total} studies`)}</span>
      <button type="button" onClick={() => onChange(emptyFilters())} className="min-h-11 font-display font-semibold text-primary underline underline-offset-2 md:min-h-0">
        {L(lang, "ล้างตัวกรอง", "Clear filters")}
      </button>
    </p>
  );
}

/** A folded set of filters directly above the matrix; they also scope the charts and the paper list. */
export function FilterBar({ papers, filters, onChange, shown, lang }: {
  papers: Paper[]; filters: Filters; onChange: (f: Filters) => void; shown: number; lang: Lang;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const years = papers.map((p) => p.year).filter((y): y is number => typeof y === "number");
  const minYear = years.length ? Math.min(...years) : null;
  const maxYear = years.length ? Math.max(...years) : null;
  const designs = [...new Set(papers.map((p) => { const c = p.card_en ?? p.card; return c ? designKey(c) : null; })
    .filter((d): d is string => !!d))].sort();
  const yearOptions = minYear != null && maxYear != null ? Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i) : [];
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="grid gap-2">
    <button type="button" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(!open)}
      className="min-h-11 w-fit rounded-sm border border-rule px-3 font-display text-[0.9rem] hover:border-ink md:min-h-0 md:py-1.5">
      {L(lang, `กรอง (แสดง ${shown} จาก ${papers.length} ฉบับ)`, `Filter (showing ${shown} of ${papers.length} studies)`)}
    </button>
    {open && (
    <div id={`${id}-panel`} role="group" aria-label={L(lang, "ตัวกรอง", "Filters")}
      className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-sm border border-rule bg-ground px-4 py-3 text-[0.88rem]">
      <div className="grid gap-1">
        <label htmlFor={`${id}-rel`} className="label">{L(lang, "ความเกี่ยวข้องขั้นต่ำ", "Minimum relevance")}: <span className="text-ink">{filters.minRelevance}</span></label>
        <input id={`${id}-rel`} type="range" min={0} max={100} step={5} value={filters.minRelevance}
          onChange={(e) => onChange({ ...filters, minRelevance: Number(e.target.value) })} className="w-36 accent-primary" />
        <p className="max-w-[16rem] text-[0.8rem] text-muted">
          {L(lang, "ซ่อนงานวิจัยที่เกี่ยวกับคำถามน้อยกว่าค่านี้ ", "Hide studies that relate less to your question than this. ")}
          <Term k="relevance" lang={lang} />
        </p>
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
        <legend className="label"><Term k="riskOfBias" lang={lang}>{L(lang, "ความเสี่ยงอคติ", "Risk of bias")}</Term></legend>
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
          <legend className="label"><Term k="studyDesign" lang={lang}>{L(lang, "รูปแบบการศึกษา", "Study design")}</Term></legend>
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
        {isFiltered(filters) && (
          <button type="button" onClick={() => onChange(emptyFilters())} className="rounded-sm border border-rule px-2.5 py-0.5 font-display hover:border-ink">
            {L(lang, "ล้างตัวกรอง", "Clear filters")}
          </button>
        )}
      </div>
    </div>
    )}
    </div>
  );
}
