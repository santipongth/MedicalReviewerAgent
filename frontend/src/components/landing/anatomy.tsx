import type { ReactNode } from "react";
import { effectLabel, findReported, isBlankedEffect } from "@/lib/evidence";
import { SAMPLE, SAMPLE_OUTCOME } from "@/lib/landing-sample";
import type { OutcomeResult, Paper } from "@/lib/types";
import { Hole, VerifiedNumber } from "../ui/evidence";
import { Gloss } from "../ui/gloss";
import { HighlightedQuote } from "../ui/quote";

// The walk-through uses the sample's first paper: its MACE value passed, its recurrent-MI value was blanked.
const paper = SAMPLE.papers[0] as Paper;
const outcomes = paper.card_en?.outcomes ?? [];
const passed = outcomes.find((o) => o.outcome.startsWith(SAMPLE_OUTCOME)) as OutcomeResult;
const blanked = outcomes.find((o) => isBlankedEffect(paper, o.outcome));
const blankedName = blanked ? paper.card?.outcomes[outcomes.indexOf(blanked)]?.outcome ?? blanked.outcome : null;

function Step({ no, title, note, children, testId }: {
  no: string; title: string; note: string; children: ReactNode; testId: string;
}) {
  return (
    <li className="grid content-start gap-3">
      <span className="label">{no}</span>
      <h3 className="text-[1.1rem] font-semibold">{title}</h3>
      <div data-testid={testId} className="grid min-h-28 content-center gap-3 rounded-sm border border-rule bg-surface p-4">
        {children}
      </div>
      <p className="text-[0.88rem] text-muted">{note}</p>
    </li>
  );
}

/** How one number earns its tape: proposed by the model, found verbatim in the abstract, then shown or blanked. */
export function Anatomy() {
  const quote = passed.evidence_quote ?? "";
  return (
    <section aria-labelledby="h-anatomy" className="grid gap-8 border-t border-rule pt-10">
      <div className="grid max-w-[65ch] gap-3">
        <h2 id="h-anatomy" className="text-[1.75rem] font-bold">ตัวเลขหนึ่งตัวต้องผ่านอะไรก่อนถึงหน้าจอคุณ</h2>
        <p className="text-muted">
<Gloss k="llm" /> อาจจำตัวเลขผิดได้ เราจึงไม่ให้โมเดลเป็นผู้ตัดสิน ตัวเลขทุกตัวต้องหาเจอในประโยคของบทคัดย่อแบบตรงทุกตัวอักษร
          ตัวอย่างนี้มาจาก {paper.ref} ในรายงานด้านบน
        </p>
      </div>
      <ol className="grid gap-8 md:grid-cols-3">
        <Step no="1 · เสนอ" title="โมเดลอ่านบทคัดย่อแล้วเสนอค่า" testId="anatomy-claim"
          note="ยังเป็นตัวอักษรธรรมดา ไม่ใช้ฟอนต์และเทปของตัวเลขที่ยืนยันแล้ว">
          <span className="label">ค่าที่โมเดลเสนอ · ยังไม่ตรวจ</span>
          <span className="text-[1.5rem] leading-none">{effectLabel(passed)}</span>
        </Step>
        <Step no="2 · ค้นหา" title="ระบบค้นค่านั้นในประโยคต้นฉบับ" testId="anatomy-search"
          note="ต้องตรงทุกตัวอักษร และต้องไม่ใช่ส่วนหนึ่งของตัวเลขอื่น">
          <p className="font-quote text-[0.98rem] leading-relaxed">
            <HighlightedQuote quote={quote} number={findReported(passed.effect_value as number, quote, { lo: passed.ci_lower, hi: passed.ci_upper })} />
          </p>
        </Step>
        <Step no="3 · ตัดสิน" title="ผ่านได้เทป ไม่ผ่านเว้นว่าง" testId="anatomy-verdict"
          note="หลังแปลเป็นภาษาไทย ระบบตรวจซ้ำว่าตัวเลขไม่เปลี่ยนแม้แต่ตัวเดียว">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[1.5rem] leading-none"><VerifiedNumber value={effectLabel(passed)} /></span>
            <span className="text-[0.88rem]">พบตรง แสดงพร้อมเทป</span>
          </p>
          {blanked && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Hole lang="th" />
              <span className="text-[0.88rem]">{blankedName}: ไม่พบในประโยคต้นฉบับ จึงเว้นว่าง ไม่เดา</span>
            </p>
          )}
        </Step>
      </ol>
    </section>
  );
}
