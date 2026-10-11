import { Fragment, type ReactNode } from "react";
import { TYPICAL_DURATION_TH } from "@/lib/copy";
import { SAMPLE } from "@/lib/landing-sample";
import { usableLimits } from "@/lib/limits";
import type { ServiceLimits } from "@/lib/types";
import { Gloss } from "../ui/gloss";

/** The steps; the pool size and the paper-count range come from /status, with number-free wording when unknown. */
function steps(limits: ServiceLimits | null): [string, string, ReactNode][] {
  const pool = limits ? `เก็บราว ${limits.candidate_limit.default} ฉบับที่มีบทคัดย่อ` : "เก็บเฉพาะเรื่องที่มีบทคัดย่อ";
  const m = limits?.max_papers;
  const pick = `เลือกฉบับที่เกี่ยวข้องที่สุดตามจำนวนที่คุณกำหนด${m ? ` (${m.min}–${m.max} ฉบับ ค่าเริ่มต้น ${m.default})` : ""}`;
  return [
    ["0:00", "ตีความคำถาม", <>แปลงหัวข้อหรือคำถามเป็นคำถามวิจัยตาม <Gloss k="pico" /> หรือ <Gloss k="pcc" /> สำหรับการทบทวนขอบเขต พร้อมบอกว่าตีความส่วนไหนเอง</>],
    ["~0:15", "ค้นหลายฐานข้อมูล", <>8 แหล่ง: PubMed, Europe PMC (รวม <Gloss k="preprint" />), OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ และ OpenAIRE ตัดเรื่องซ้ำ {pool}</>],
    ["~0:40", "คัดกรอง", `ตามเกณฑ์ของรูปแบบการทบทวนและชนิดงานวิจัยที่เลือก บันทึกเหตุผลที่คัดออก ${pick} งานที่ก้ำกึ่งให้ AI สองตัวช่วยกันลงคะแนน`],
    ["~1:00", "อ่านและตรวจ", <>ดึงผลจากบทคัดย่อ ตรวจทุกตัวเลขกับประโยคต้นฉบับ แยกงานที่รวมผลจากงานอื่นออกจาก<Gloss k="primaryStudy" /> ระหว่างนั้นดึงข้อมูลการอ้างอิงจาก OpenAlex</>],
    ["1–3 นาที", "รายงานพร้อม", <>ผลที่ตรงกันและขัดกัน ระดับหลักฐาน ตารางงานวิจัย แผนที่ความรู้ เครือข่ายการอ้างอิง และค่ารวมจากการวิเคราะห์อภิมาน ดาวน์โหลดเป็น <Gloss k="exportFormats" /> หรือ HTML ที่เปิดได้แม้ไม่มีอินเทอร์เน็ต</>],
  ];
}

/** The 1–3 minute run, with the sample review's real counts (pipeline counts, not numbers from a paper). */
export function Timeline({ limits }: { limits?: ServiceLimits | null }) {
  const rows = steps(usableLimits(limits));
  const s = SAMPLE.stats;
  const funnel: [string, number | undefined][] = [
    ["พบ", s.found], ["ไม่ซ้ำ", s.unique], ["คัดกรอง", s.screened], ["วิเคราะห์", s.extracted],
  ];
  return (
    <section aria-labelledby="h-timeline" className="grid gap-8 border-t border-rule pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="grid content-start gap-3">
        <h2 id="h-timeline" className="text-[1.75rem] font-bold">จากหัวข้อถึงรายงาน {TYPICAL_DURATION_TH}</h2>
        <p className="text-muted">เวลาโดยประมาณ ขึ้นกับจำนวนผู้ใช้ในขณะนั้นและจำนวนบทคัดย่อที่เลือก ระหว่างรอ คุณเห็นทุกขั้นที่เอเจนต์ทำ</p>
        <p data-testid="funnel" className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-display tabular-nums">
          {funnel.map(([label, n], i) => (
            <Fragment key={label}>
              {i > 0 && <span aria-hidden="true" className="text-muted">→</span>}
              <span><span className="text-[0.85rem] text-muted">{label}</span> <b className="text-[1.15rem]">{n}</b></span>
            </Fragment>
          ))}
          <span className="basis-full text-[0.8rem] text-muted">จำนวนจริงของรีวิวตัวอย่างด้านบน</span>
        </p>
      </div>
      <ol aria-label="ขั้นตอนของรีวิว" className="grid border-t border-rule">
        {rows.map(([t, title, body]) => (
          <li key={t} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 border-b border-rule py-4">
            <span className="font-display text-[0.95rem] font-semibold tabular-nums text-muted">{t}</span>
            <div className="min-w-0">
              <h3 className="text-[1.05rem] font-semibold">{title}</h3>
              <p className="text-[0.95rem] text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
