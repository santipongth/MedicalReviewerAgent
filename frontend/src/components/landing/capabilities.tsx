import type { ReactNode } from "react";
import { REVIEW_TYPE_LABEL } from "@/lib/review-type";
import type { ReviewType } from "@/lib/types";
import { Gloss } from "../ui/gloss";
import { TypeDescription } from "./type-description";

const TYPES: ReviewType[] = ["slr", "meta_analysis", "scoping", "narrative"];

const VIEWS: { title: string; body: ReactNode }[] = [
  { title: "ตารางเทียบผลและข้อขัดแย้ง", body: "ผลของแต่ละงานวิจัยเรียงตามผลลัพธ์ ข้อที่งานวิจัยเห็นตรงกันและที่ขัดกัน พร้อมสาเหตุที่น่าจะเป็น" },
  { title: "ตารางงานวิจัย", body: <><Gloss k="litMatrix" />: ผู้แต่ง ปี รูปแบบการศึกษา กลุ่มที่ศึกษา สิ่งที่ให้ ผลลัพธ์ และข้อจำกัด ทุกตัวเลขตรวจกับบทคัดย่อแล้ว</> },
  { title: "แผนที่ความรู้", body: "ภาพที่โยงคำถามไปยังสิ่งที่วัดและกลุ่มงานวิจัยที่สนับสนุนหรือขัดแย้ง ดูเป็นแผนภาพหรือเป็นโครงร่างข้อความก็ได้" },
  { title: "แผนภาพคัดเลือกและแผนภาพผล", body: <><Gloss k="prisma" /> แสดงว่างานใดถูกคัดเข้าหรือออกเพราะอะไร และ <Gloss k="forestPlot" /></> },
  { title: "เครือข่ายการอ้างอิง", body: "งานไหนในรีวิวอ้างอิงถึงกัน จากข้อมูลบรรณานุกรมของ OpenAlex และ Europe PMC" },
  { title: "ค่ารวมจากการวิเคราะห์อภิมาน", body: <>รวมตัวเลขที่ตรวจแล้วจากหลายงานเป็นผลเดียวด้วยวิธี <Gloss k="randomEffects" /> ติดป้าย “คำนวณ” เสมอ แยกจากตัวเลขที่มาจากงานวิจัย</> },
];

const SOURCES = ["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ", "OpenAIRE"];

/** What the service can do now (Plans 14–17): review types, report views and sources, in one band. */
export function Capabilities() {
  return (
    <section aria-labelledby="h-capabilities" className="grid gap-8 border-t border-rule pt-10">
      <div className="grid max-w-[65ch] gap-3">
        <h2 id="h-capabilities" className="text-[1.75rem] font-bold">รีวิวได้ 4 แบบ รายงานมีอะไรบ้าง</h2>
        <p className="text-muted">
          เลือกรูปแบบการทบทวนให้ตรงกับคำถาม ระบบจะปรับวิธีคัดกรอง การสรุป และส่วนของรายงานให้เข้ากับรูปแบบนั้น
        </p>
      </div>
      <ul aria-label="รูปแบบการทบทวนที่มี" className="grid gap-x-8 border-t border-rule sm:grid-cols-2">
        {TYPES.map((t) => (
          <li key={t} className="grid content-start gap-1 border-b border-rule py-3">
            <h3 className="text-[1.05rem] font-semibold">
              {REVIEW_TYPE_LABEL[t].th} <span className="font-normal text-muted">({REVIEW_TYPE_LABEL[t].en})</span>
            </h3>
            <p className="text-[0.95rem] leading-[1.7] text-muted"><TypeDescription type={t} /></p>
          </li>
        ))}
      </ul>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ul aria-label="ส่วนของรายงาน" className="grid gap-x-8 border-t border-rule sm:grid-cols-2">
          {VIEWS.map(({ title, body }) => (
            <li key={title} className="grid content-start gap-1 border-b border-rule py-3">
              <h3 className="text-[1rem] font-semibold">{title}</h3>
              <p className="text-[0.95rem] leading-[1.7] text-muted">{body}</p>
            </li>
          ))}
        </ul>
        <div className="grid content-start gap-3">
          <h3 className="label">แหล่งข้อมูลที่ค้น</h3>
          <ul aria-label="แหล่งข้อมูลที่ค้น" className="flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <li key={s} className="rounded-sm border border-rule px-2.5 py-1 font-display text-[0.9rem]">{s}</li>
            ))}
          </ul>
          <p className="text-[0.92rem] leading-[1.7] text-muted">
            ฐานข้อมูลงานวิจัยวิชาการแบบเปิด ค้นผ่าน <Gloss k="searxng" /> ตัดงานซ้ำด้วย <Gloss k="doiPmid" />{" "}
            แล้วเติมข้อมูลจาก Europe PMC
          </p>
        </div>
      </div>
    </section>
  );
}
