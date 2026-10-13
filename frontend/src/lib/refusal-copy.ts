// Plan 26: the fixed Thai copy of a request that gets no review. The words are the backend's
// (app/services/safety.py MESSAGES, which REST and MCP clients receive); keep both in step. The copy never echoes what
// the person typed.

export type EmergencyKind = "medical" | "self_harm";

export const EMERGENCY_COPY: Record<EmergencyKind, { title: string; body: string }> = {
  medical: {
    title: "อาจเป็นภาวะฉุกเฉิน โทร 1669 ทันที",
    body: "ข้อความนี้อาจเป็นภาวะฉุกเฉิน โปรดโทร 1669 (บริการการแพทย์ฉุกเฉิน) ทันที หรือไปห้องฉุกเฉินที่ใกล้ที่สุด บริการนี้สรุปงานวิจัย จึงช่วยในภาวะฉุกเฉินไม่ได้",
  },
  self_harm: {
    title: "คุณไม่ได้อยู่คนเดียว",
    body: "ถ้าคุณกำลังคิดทำร้ายตัวเองหรือรู้สึกไม่ปลอดภัย คุณไม่ได้อยู่คนเดียว โทรสายด่วนสุขภาพจิต 1323 ได้ตลอด 24 ชั่วโมง หรือโทร 1669 ถ้าตอนนี้อยู่ในอันตราย",
  },
};

export const PERSONAL_MEDICAL_COPY = {
  title: "คำถามนี้เป็นเรื่องเฉพาะของคุณ",
  body: "บริการนี้สรุปงานวิจัยเกี่ยวกับกลุ่มประชากร จึงให้คำแนะนำเฉพาะกรณีของคุณไม่ได้ เช่น อาการ การวินิจฉัย ขนาดยา หรือการเลือกการรักษา โปรดปรึกษาแพทย์หรือเภสัชกร หากเป็นภาวะฉุกเฉิน โทร 1669 หากเป็นเรื่องความคิดอยากทำร้ายตัวเอง โทร 1323 (สายด่วนสุขภาพจิต 1323)",
  askAgain: "ถ้าต้องการรู้ว่างานวิจัยว่าอย่างไรกับคนกลุ่มหนึ่ง ลองถามใหม่โดยไม่ระบุเรื่องของตัวเอง เช่น “แอสไพรินป้องกันโรคหลอดเลือดสมองในผู้สูงอายุได้หรือไม่”",
} as const;

/** The call buttons: the number dialled and its label. */
export const HOTLINE_LABEL: Record<string, string> = {
  "1669": "โทร 1669 บริการการแพทย์ฉุกเฉิน",
  "1323": "โทร 1323 สายด่วนสุขภาพจิต",
};

export function emergencyKind(kind: string | null | undefined): EmergencyKind {
  return kind === "self_harm" ? "self_harm" : "medical";
}

/** The numbers to offer, in order (the backend's rule: self-harm adds the mental health hotline first). */
export function hotlinesFor(kind: EmergencyKind): string[] {
  return kind === "self_harm" ? ["1323", "1669"] : ["1669"];
}
