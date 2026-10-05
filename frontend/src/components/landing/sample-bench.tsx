"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { designKey, designLabel, forestData, type ForestRow } from "@/lib/charts-data";
import { asReported, findReported, isBlankedEffect, isBlankedSampleSize, safeHref } from "@/lib/evidence";
import { DIRECTION_LABEL } from "@/lib/i18n";
import { SAMPLE, SAMPLE_OUTCOME } from "@/lib/landing-sample";
import type { Direction, Paper } from "@/lib/types";
import { Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { HighlightedQuote } from "../ui/quote";
import { MiniForest, rowKey } from "./mini-forest";

const CAPTURED = new Date(SAMPLE.capturedAt).toLocaleDateString("th-TH-u-ca-gregory", {
  day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok",
});

// How a direction reads inside a sentence about MACE (the chips elsewhere use DIRECTION_LABEL).
const FOUND: Partial<Record<Direction, string>> = { positive: "พบเหตุการณ์ลดลง", null: "ไม่พบความแตกต่าง", negative: "พบเหตุการณ์เพิ่มขึ้น" };

const byRef = new Map(SAMPLE.papers.map((p) => [p.ref, p]));
const paperOf = (r: ForestRow) => byRef.get(r.ref) as Paper;
const isPooled = (p: Paper) => (p.card_en?.design_category ?? "").startsWith("sr_ma");
const sub = (ref: string) => {
  const p = byRef.get(ref);
  return p?.card_en ? `${p.year ?? ""} · ${designLabel(designKey(p.card_en), "th")}` : "";
};

function SampleSize({ paper, onSelect }: { paper: Paper; onSelect?: () => void }) {
  const card = paper.card_en;
  if (card?.sample_size == null) return isBlankedSampleSize(paper) ? <Hole lang="th" /> : <span className="text-muted">ไม่ได้รายงาน</span>;
  return <VerifiedNumber value={asReported(card.sample_size, card.sample_size_quote)} onSelect={onSelect} />;
}

/** The landing page's evidence: a real review's MACE rows; tapping a row or a number shows the sentence behind it. */
export function SampleBench() {
  const group = useMemo(() => forestData(SAMPLE.papers, "th").groups[0], []);
  const [selected, setSelected] = useState(() => rowKey(group.rows[0]));
  const row = group.rows.find((r) => rowKey(r) === selected) ?? group.rows[0];
  const select = (r: ForestRow) => () => setSelected(rowKey(r));

  const trials = group.rows.filter((r) => !isPooled(paperOf(r)));
  const pooled = group.rows.filter((r) => isPooled(paperOf(r))).sort((a, b) => a.value - b.value);
  const unplotted = SAMPLE.papers.filter((p) =>
    (p.card_en?.outcomes ?? []).some((o) => o.outcome.startsWith(SAMPLE_OUTCOME) && isBlankedEffect(p, o.outcome)));
  const verifiedPct = Math.round(SAMPLE.quality.verification_rate * 100);

  const summary: ReactNode[] = trials.map((r, i) => (
    <Fragment key={r.ref}>
      {i > 0 && " ขณะที่ "}
      {r.ref} ({paperOf(r).year}, n = <SampleSize paper={paperOf(r)} onSelect={select(r)} />) {FOUND[r.direction] ?? DIRECTION_LABEL.th[r.direction]}{" "}
      <VerifiedNumber value={r.valueText} onSelect={select(r)} />
      {r.ciText && <> (95% CI <VerifiedNumber value={r.ciText} onSelect={select(r)} />)</>}
    </Fragment>
  ));

  return (
    <section aria-labelledby="h-sample" className="grid border border-rule lg:grid-cols-12">
      <div className="grid min-w-0 content-start gap-6 bg-surface p-4 sm:p-6 lg:col-span-7">
        <p className="label flex flex-wrap gap-x-3 gap-y-1">
          <span>รายงาน · ตัวอย่างจากรีวิวจริง · {CAPTURED}</span>
          <span className="font-display tabular-nums">วิเคราะห์ {SAMPLE.stats.extracted} บทคัดย่อ · ตัวเลขตรวจผ่าน {verifiedPct}%</span>
        </p>
        <div className="grid gap-2">
          <h2 id="h-sample" className="text-[1.35rem] font-bold">โคลชิซินหลังกล้ามเนื้อหัวใจตายเฉียบพลัน</h2>
          <p className="max-w-[65ch] text-[0.95rem] text-muted">{SAMPLE.question}</p>
        </div>
        <p data-testid="sample-summary" className="max-w-[65ch] text-[1.02rem] leading-[1.9]">
          การทดลองแบบสุ่ม {trials.length} ฉบับ: {summary} ส่วนการวิเคราะห์อภิมาน {pooled.length} ฉบับรายงานค่ารวมตั้งแต่{" "}
          <VerifiedNumber value={pooled[0].valueText} onSelect={select(pooled[0])} /> ถึง{" "}
          <VerifiedNumber value={pooled[pooled.length - 1].valueText} onSelect={select(pooled[pooled.length - 1])} />
        </p>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[1.02rem] font-semibold">MACE · อัตราส่วน (log scale)</h3>
            <span className="label">แตะแถวเพื่อดูประโยคต้นฉบับ</span>
          </div>
          <MiniForest group={group} selected={selected} onSelect={setSelected} sub={sub} />
          {unplotted.length > 0 && (
            <p data-testid="unplotted" className="flex flex-wrap items-center gap-2 text-[0.85rem] text-muted">
              {unplotted.map((p) => <span key={p.ref} className="flex items-center gap-2"><b className="font-display text-ink">{p.ref}</b><Hole lang="th" /></span>)}
              <span>ค่าที่ตรวจกับบทคัดย่อไม่ผ่าน จึงไม่วาด ไม่ประมาณ</span>
            </p>
          )}
        </div>
      </div>
      <SourcePane row={row} />
    </section>
  );
}

function SourcePane({ row }: { row: ForestRow }) {
  const paper = paperOf(row);
  const en = paper.card_en?.outcomes ?? [];
  const index = en.findIndex((o) => o.outcome === row.outcomeKey);
  const outcome = en[index];
  const shownName = paper.card?.outcomes[index]?.outcome ?? row.outcome;
  const quote = outcome?.evidence_quote ?? "";
  const href = safeHref(paper.url) ?? (paper.doi ? `https://doi.org/${paper.doi}` : null);
  return (
    <aside className="min-w-0 border-t border-rule bg-rail lg:col-span-5 lg:border-l lg:border-t-0">
      <div role="region" aria-label="แหล่งที่มาของตัวเลขที่เลือก" aria-live="polite"
        className="grid content-start gap-4 p-4 sm:p-6 lg:sticky lg:top-4">
        <span className="label">แหล่งที่มา · {row.ref}</span>
        <div className="grid gap-1">
          <p className="font-display text-[1rem] font-semibold leading-snug">{paper.title}</p>
          <p className="text-[0.85rem] text-muted">
            {[paper.journal, paper.year, paper.card_en ? designLabel(designKey(paper.card_en), "th") : null].filter(Boolean).join(" · ")}
            {" · "}n = <SampleSize paper={paper} />
          </p>
        </div>
        <div className="grid gap-1">
          <p className="flex flex-wrap items-center gap-2 text-[0.92rem]">
            <Glyph direction={row.direction} lang="th" />
            <b className="font-display">{shownName}</b>
            <span className="text-muted">{DIRECTION_LABEL.th[row.direction]}</span>
          </p>
          <p className="text-[1.05rem]">
            <VerifiedNumber value={row.valueText} />
            {row.ciText && <> <span className="text-[0.85rem] text-muted">95% CI</span> <VerifiedNumber value={row.ciText} /></>}
          </p>
        </div>
        <div className="grid gap-1">
          <span className="label">ประโยคในบทคัดย่อ</span>
          <p className="font-quote text-[1.02rem] leading-relaxed">
            <HighlightedQuote quote={quote} number={findReported(row.value, quote, { lo: row.lo, hi: row.hi })} />
          </p>
          <p className="text-[0.8rem] text-muted">ตัวเลขที่ไฮไลต์พบในบทคัดย่อตรงทุกตัวอักษร</p>
        </div>
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="text-[0.9rem] text-primary underline underline-offset-2">
            เปิดบทความต้นฉบับ
          </a>
        )}
      </div>
    </aside>
  );
}
