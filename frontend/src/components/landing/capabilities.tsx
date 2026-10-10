import { REVIEW_TYPE_LABEL } from "@/lib/review-type";
import type { ReviewType } from "@/lib/types";

const TYPES: ReviewType[] = ["slr", "meta_analysis", "scoping", "narrative"];

const VIEWS: [string, string][] = [
  ["ตารางเทียบผลและข้อขัดแย้ง", "ผลแต่ละการศึกษาเรียงตามผลลัพธ์ ข้อที่เห็นตรงกันและที่ขัดกันพร้อมสาเหตุที่น่าจะเป็น"],
  ["ตารางงานวิจัย", "literature review matrix: ผู้แต่ง ปี รูปแบบ ประชากร สิ่งที่ศึกษา ผลลัพธ์ ข้อจำกัด ทุกตัวเลขตรวจกับบทคัดย่อแล้ว"],
  ["แผนที่ความรู้", "จากคำถามสู่ตัวแปรและกลุ่มงานวิจัยที่สนับสนุนหรือขัดแย้ง ดูเป็นแผนภาพหรือโครงร่างข้อความ"],
  ["PRISMA และ forest plot", "ขั้นตอนการคัดเลือกพร้อมเหตุผลที่คัดออก และขนาดผลของแต่ละการศึกษา"],
  ["เครือข่ายการอ้างอิง", "งานไหนในรีวิวอ้างอิงกัน จากข้อมูลบรรณานุกรมของ OpenAlex และ Europe PMC"],
  ["ค่ารวม (meta-analysis)", "random effects จากตัวเลขที่ตรวจแล้ว ติดป้าย “คำนวณ” เสมอ แยกจากผลที่มาจากงานวิจัย"],
];

const SOURCES = ["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ", "OpenAIRE"];

/** What the service can do now (Plans 14–17): review types, report views and sources, in one band. */
export function Capabilities() {
  return (
    <section aria-labelledby="h-capabilities" className="grid gap-8 border-t border-rule pt-10">
      <div className="grid max-w-[65ch] gap-3">
        <h2 id="h-capabilities" className="text-[1.75rem] font-bold">รีวิวได้ 4 แบบ รายงานมีอะไรบ้าง</h2>
        <p className="text-muted">
          เลือกรูปแบบการทบทวนให้ตรงกับคำถาม ระบบปรับวิธีคัดกรอง การสรุป และส่วนของรายงานให้เข้ากับรูปแบบนั้น
          ทุกแบบอ่านจากบทคัดย่อเท่านั้นและตรวจตัวเลขทุกตัว
        </p>
      </div>
      <ul aria-label="รูปแบบการทบทวนที่มี" className="grid gap-x-8 border-t border-rule sm:grid-cols-2">
        {TYPES.map((t) => (
          <li key={t} className="grid gap-1 border-b border-rule py-3">
            <h3 className="text-[1.05rem] font-semibold">
              {REVIEW_TYPE_LABEL[t].th} <span className="font-normal text-muted">({REVIEW_TYPE_LABEL[t].en})</span>
            </h3>
            <p className="text-[0.92rem] text-muted">{REVIEW_TYPE_LABEL[t].description}</p>
          </li>
        ))}
      </ul>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ul aria-label="ส่วนของรายงาน" className="grid gap-x-8 border-t border-rule sm:grid-cols-2">
          {VIEWS.map(([title, body]) => (
            <li key={title} className="grid gap-1 border-b border-rule py-3">
              <h3 className="text-[1rem] font-semibold">{title}</h3>
              <p className="text-[0.9rem] text-muted">{body}</p>
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
          <p className="text-[0.88rem] text-muted">
            ค้นผ่าน SearXNG ของระบบเอง ตัดงานซ้ำด้วย DOI และ PMID แล้วเติมข้อมูลจาก Europe PMC
            ไม่ดาวน์โหลดบทความฉบับเต็ม
          </p>
        </div>
      </div>
    </section>
  );
}
