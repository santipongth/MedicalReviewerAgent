import { Fragment } from "react";
import { SAMPLE } from "@/lib/landing-sample";

const STEPS: [string, string, string][] = [
  ["0:00", "ตีความคำถาม", "แปลงหัวข้อเป็นคำถามวิจัยแบบ PICO พร้อมบอกสมมติฐานที่เลือกเอง"],
  ["~0:15", "ค้นห้าฐานข้อมูล", "PubMed, arXiv, Semantic Scholar, OpenAlex และ CrossRef ตัดซ้ำ เก็บราว 60 ฉบับที่มีบทคัดย่อ"],
  ["~0:40", "คัดกรอง", "เลือกฉบับที่ตรงที่สุดสูงสุด 30 ฉบับ งานก้ำกึ่งให้สองโมเดลลงคะแนน"],
  ["~1:00", "อ่านและตรวจ", "สกัดผลจากบทคัดย่อ ตรวจทุกตัวเลขกับประโยคต้นฉบับ แยกงานวิเคราะห์อภิมานออกจากงานปฐมภูมิ"],
  ["1–3 นาที", "รายงานพร้อม", "ผลที่ตรงกันและขัดกัน ระดับหลักฐาน ดาวน์โหลด MD, CSV, JSON หรือ HTML ที่เปิดได้ออฟไลน์"],
];

/** The 1–3 minute run, with the sample review's real counts (pipeline counts, not numbers from a paper). */
export function Timeline() {
  const s = SAMPLE.stats;
  const funnel: [string, number | undefined][] = [
    ["พบ", s.found], ["ไม่ซ้ำ", s.unique], ["คัดกรอง", s.screened], ["วิเคราะห์", s.extracted],
  ];
  return (
    <section aria-labelledby="h-timeline" className="grid gap-8 border-t border-rule pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="grid content-start gap-3">
        <h2 id="h-timeline" className="text-[1.75rem] font-bold">จากหัวข้อถึงรายงาน ราว 1–3 นาที</h2>
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
        {STEPS.map(([t, title, body]) => (
          <li key={title} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 border-b border-rule py-4">
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
