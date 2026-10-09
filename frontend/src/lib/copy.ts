export const TYPICAL_DURATION_TH = "ปกติใช้ 1–3 นาที";
/** A paper handed to the readers but not finished: it may be read now or wait behind the LLM limit (never "in flight"). */
export const READING_OR_QUEUED = "กำลังอ่านหรือรอคิว";
/** SR/MA overlap note (report bottom line and live evidence board): pooled designs may contain counted primary studies. */
export const POOLED_OVERLAP_TH = "งานทบทวน/วิเคราะห์อภิมานอาจซ้อนกับงานวิจัยหลักที่นับรวม";
/** Paired with every direction shown live: direction is the reading model's judgement, not a conclusion. */
export const AS_READ_TH = "ตามที่เอเจนต์อ่าน";
/** A finished read without a (known) direction: old events or future enum values. Never shown as "unclear". */
export const NO_DIRECTION_TH = "ไม่มีข้อมูลทิศทาง";
