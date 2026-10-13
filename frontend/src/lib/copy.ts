export const TYPICAL_DURATION_TH = "ปกติใช้ 1–3 นาที";
/** Plan 27: a quick answer's expected time (an estimate on the budget preset, not measured live). */
export const QUICK_DURATION_TH = "ปกติใช้ราว 1 นาที";
/** A paper handed to the readers but not finished: it may be read now or wait behind the LLM limit (never "in flight"). */
export const READING_OR_QUEUED = "กำลังอ่านหรือรอคิว";
/** SR/MA overlap note (report bottom line and live evidence board): pooled designs may contain counted primary studies. */
export const POOLED_OVERLAP_TH = "งานทบทวน/วิเคราะห์อภิมานอาจซ้อนกับงานวิจัยหลักที่นับรวม";
/** Paired with every direction shown live: direction is the reading model's judgement, not a conclusion. */
export const AS_READ_TH = "ตามที่เอเจนต์อ่าน";
/** A finished read without a (known) direction: old events or future enum values. Never shown as "unclear". */
export const NO_DIRECTION_TH = "ไม่มีข้อมูลทิศทาง";

type Copy = { th: string; en: string };
/**
 * A meta-analysis without a pooled estimate, in its two honest states (title-block chip, bottom line, section). "none":
 * the pooling step ran and no outcome qualified. "failed": the step did not complete (`meta_analysis` is null), so the
 * cause is unknown and the copy never claims "fewer than 3 studies".
 */
export const META_POOL_COPY: Record<"none" | "failed", { chip: Copy; label: Copy; reason: Copy; heading: Copy }> = {
  none: {
    chip: { th: "(รวมผลไม่ได้)", en: "(not pooled)" },
    label: { th: "การวิเคราะห์อภิมาน (รวมผลไม่ได้)", en: "Meta-analysis (not pooled)" },
    reason: {
      th: "ไม่มีผลลัพธ์ใดที่มีงานวิจัยหลักตั้งแต่ 3 ฉบับวัดผลด้วยตัววัดเดียวกันและมีตัวเลขที่ตรวจผ่านครบ จึงไม่มีค่ารวม",
      en: "No outcome had at least 3 primary studies with the same measure and fully verified numbers, so there is no pooled estimate",
    },
    heading: { th: "การวิเคราะห์อภิมาน: รวมผลไม่ได้", en: "Meta-analysis: not pooled" },
  },
  failed: {
    chip: { th: "(รวมผลไม่สำเร็จ)", en: "(pooling failed)" },
    label: { th: "การวิเคราะห์อภิมาน (รวมผลไม่สำเร็จ)", en: "Meta-analysis (pooling failed)" },
    reason: {
      th: "ขั้นตอนรวมผลทำงานไม่สำเร็จ จึงไม่มีค่ารวม ผลของแต่ละงานยังอยู่ในรายงาน",
      en: "The pooling step did not complete, so there is no pooled estimate; each study's result is still in the report",
    },
    heading: { th: "การวิเคราะห์อภิมาน: ค่ารวมไม่สำเร็จ", en: "Meta-analysis: pooling failed" },
  },
};
