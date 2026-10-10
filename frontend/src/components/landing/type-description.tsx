import type { ReactNode } from "react";
import { GLOSS, type GlossKey } from "@/lib/glossary";
import type { ReviewType } from "@/lib/types";
import { Gloss } from "../ui/gloss";

export const TYPE_GLOSS = {
  slr: "slr", meta_analysis: "metaAnalysis", scoping: "scopingReview", narrative: "narrativeReview",
} as const satisfies Record<ReviewType, GlossKey>;

/** What each review type gives, after its plain one-line meaning (the scope form's picker and the capabilities band). */
const DETAIL: Record<ReviewType, ReactNode> = {
  slr: <>คัดเลือกตามเกณฑ์ที่ตั้งไว้ก่อน แสดงขั้นตอนคัดเลือกตาม <Gloss k="prisma" /> และบอกระดับความน่าเชื่อถือของหลักฐาน · ตัวเลือกเริ่มต้น</>,
  meta_analysis: <>ทำทุกขั้นแบบการทบทวนวรรณกรรมอย่างเป็นระบบ แล้วรวมตัวเลขของงานที่วัดผลแบบเดียวกันตั้งแต่ 3 งานขึ้นไป ด้วยวิธี{" "}
    <Gloss k="randomEffects" /> ตัวเลขรวมคำนวณโดยระบบ ไม่ใช่ผลจากงานใดงานหนึ่ง</>,
  scoping: <>ตั้งคำถามด้วย <Gloss k="pcc" /> ไม่ประเมินคุณภาพงาน และไม่ตัดสินว่าได้ผลหรือไม่</>,
  narrative: <>จากงานวิจัยหลายชนิดรวมถึงบทความทบทวน เหมาะกับการทำความเข้าใจหัวข้ออย่างรวดเร็ว ไม่ให้ระดับความน่าเชื่อถือของหลักฐาน</>,
};

export function TypeDescription({ type }: { type: ReviewType }) {
  return <>{GLOSS[TYPE_GLOSS[type]].plain.th} {DETAIL[type]}</>;
}
