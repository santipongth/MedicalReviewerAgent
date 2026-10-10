import { GLOSS, glossParts, type GlossKey } from "@/lib/glossary";
import { Gloss } from "../ui/gloss";

/**
 * The plain-language introduction (Plan 20 Task 12), for a first-time reader who is not a researcher. It describes
 * what the engine really does (abstracts only, numbers checked against the abstract) and never states a service limit:
 * paper counts and rate limits come from GET /api/v1/status.
 */

/** "ระบบนี้คืออะไร": the hero's answer, beside the headline. */
export function WhatItIs() {
  return (
    <div className="grid min-w-0 content-start gap-3">
      <h2 className="font-display text-[1.15rem] font-semibold">ระบบนี้คืออะไร</h2>
      <p data-testid="what-it-is" className="max-w-[60ch] text-[1.0625rem] leading-[1.75]">
        Medical Reviewer Agent คือผู้ช่วย AI ที่หาคำตอบจากงานวิจัยทางการแพทย์ให้คุณ แค่พิมพ์สิ่งที่สงสัย เช่น
        “ยาลดไขมันช่วยลดความเสี่ยงสมองเสื่อมได้ไหม” ระบบจะค้นงานวิจัยจากฐานข้อมูลวิชาการแบบเปิด อ่าน<Gloss k="abstract" />
        {" "}แล้วสรุปให้ว่าหลักฐานที่มีอยู่ตอบคำถามของคุณว่าอย่างไร <span className="nw">ใช้ฟรี ไม่ต้องสมัคร</span>
      </p>
      <a href="#intro" className="inline-flex min-h-11 w-fit items-center text-primary underline underline-offset-2 hover:decoration-2">
        ดูว่าระบบทำอะไรให้บ้าง ↓
      </a>
    </div>
  );
}

const STEPS: [string, string][] = [
  ["ค้น", "ตีความคำถามของคุณให้ชัดว่าถามถึงใครและเรื่องอะไร แล้วค้นงานวิจัยจากฐานข้อมูลวิชาการแบบเปิดหลายแห่งพร้อมกัน เช่น PubMed และ Europe PMC พร้อมตัดเรื่องที่ซ้ำกันออก"],
  ["คัดกรอง", "อ่านชื่อเรื่องและบทคัดย่อทีละเรื่อง เก็บไว้เฉพาะงานที่ตอบคำถามได้ตรงจริง และจดเหตุผลทุกครั้งที่คัดเรื่องใดออก"],
  ["อ่านและตรวจตัวเลข", "ดึงผลการศึกษาและตัวเลขสำคัญจากบทคัดย่อ แล้วเทียบกับประโยคต้นฉบับทีละตัว ตัวเลขที่หาไม่เจอจะเว้นว่างไว้ ระบบไม่เดาเอง"],
  ["สรุปและบอกระดับความน่าเชื่อถือ", "ดูว่างานวิจัยส่วนใหญ่ชี้ไปทางเดียวกันหรือขัดกัน และน่าจะเพราะอะไร แล้วบอกว่าหลักฐานโดยรวมน่าเชื่อถือแค่ไหน (เมื่อเลือกการทบทวนอย่างเป็นระบบหรือการวิเคราะห์อภิมาน)"],
  ["ออกรายงาน", "ได้รายงานภาษาไทยหรืออังกฤษ พร้อมตาราง แผนภาพ และรายชื่องานวิจัยที่ใช้อ้างอิง เปิดอ่านบนเว็บหรือดาวน์โหลดเก็บไว้ได้"],
];

const BENEFITS: [string, string][] = [
  ["ประหยัดเวลา", "งานค้นและอ่านที่ปกติใช้เวลาหลายชั่วโมง ได้ภาพรวมในไม่กี่นาที"],
  ["รู้ที่มาของทุกตัวเลข", "ตัวเลขทุกตัวตรวจกับบทคัดย่อต้นฉบับแล้ว แตะที่ตัวเลขเพื่อดูประโยคที่ตัวเลขนั้นมาจากได้ทันที"],
  ["รู้ว่าหลักฐานแน่นแค่ไหน", "เห็นทั้งจุดที่งานวิจัยเห็นตรงกัน จุดที่ขัดกัน และระดับความน่าเชื่อถือของหลักฐาน ไม่ใช่แค่คำตอบเดียว"],
  ["นำไปอ้างอิงต่อได้", "ทุกข้อสรุปโยงกลับไปยังงานวิจัยต้นทางพร้อมลิงก์ ใช้เป็นจุดตั้งต้นของรายงาน งานเรียน หรือการคุยกับแพทย์ได้"],
];

/** Words a first-time reader meets in a report, explained once here (the report itself explains them on tap). */
const WORDS: GlossKey[] = ["pico", "prisma", "grade", "riskOfBias", "ratios", "ci95", "i2", "forestPlot"];

/** "รู้จักระบบนี้ใน 1 นาที": what it does, why it helps, its limits, and the report's words. */
export function Intro() {
  return (
    <section id="intro" aria-labelledby="h-intro" className="grid scroll-mt-24 gap-8 border-t border-rule pt-10">
      <h2 id="h-intro" className="text-[1.75rem] font-bold">รู้จักระบบนี้ใน 1 นาที</h2>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <h3 className="text-[1.2rem] font-semibold">ทำอะไรให้บ้าง</h3>
          <ol aria-label="ระบบทำอะไรให้บ้าง" className="grid border-t border-rule">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 border-b border-rule py-3.5">
                <span aria-hidden="true" className="font-display text-[1.05rem] font-semibold tabular-nums text-muted">{i + 1}</span>
                <div className="min-w-0">
                  <h4 className="font-display text-[1.05rem] font-semibold">{title}</h4>
                  <p className="text-[1.0625rem] leading-[1.75] text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <div className="grid gap-4">
            <h3 className="text-[1.2rem] font-semibold">มีประโยชน์อย่างไร</h3>
            <ul aria-label="มีประโยชน์อย่างไร" className="grid border-t border-rule">
              {BENEFITS.map(([title, body]) => (
                <li key={title} className="border-b border-rule py-3.5 text-[1.0625rem] leading-[1.75]">
                  <b className="font-display font-semibold">{title}</b> <span className="text-muted">{body}</span>
                </li>
              ))}
            </ul>
          </div>
          <div data-testid="intro-limits" className="grid gap-1 rounded-sm bg-warn-bg p-4 text-[1.0625rem] leading-[1.75]">
            <h3 className="font-display text-[1rem] font-semibold">ข้อควรรู้</h3>
            <p>
              ระบบอ่านเฉพาะบทคัดย่อ ไม่ได้อ่านบทความฉบับเต็ม และทำงานอัตโนมัติทั้งหมด
              ผลที่ได้จึงใช้ประกอบการตัดสินใจเท่านั้น ไม่ใช้แทนแพทย์หรือผู้เชี่ยวชาญ
            </p>
          </div>
        </div>
      </div>
      <details className="group border-y border-rule">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 py-2 font-display font-medium">
          คำที่จะเจอในรายงาน <span className="font-normal text-muted">· แตะเพื่ออ่านคำอธิบาย</span>
        </summary>
        <dl className="grid gap-x-10 pb-4 md:grid-cols-2">
          {WORDS.map((k) => (
            <div key={k} className="grid gap-0.5 border-t border-rule py-3">
              <dt className="nw font-display font-semibold">{GLOSS[k].term.th}</dt>
              <dd className="text-[1rem] leading-[1.7] text-muted">{glossParts(k, "th", { full: true }).meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
