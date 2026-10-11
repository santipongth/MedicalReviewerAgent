import { paperRangeTh, usableLimits } from "./limits";

/**
 * Paper counts for the developer page as the running service reports them (GET /api/v1/status). Only usable ranges are
 * quoted (`usableLimits`); a missing, partial or malformed limits object falls back to number-free wording.
 */
export function limitsCopy(limits: unknown) {
  const l = usableLimits(limits);
  if (!l) {
    return {
      screen: "",
      read: "ตามจำนวนที่ผู้ใช้กำหนด",
      papers: "ช่วงที่รับอยู่ใน limits.max_papers ของ /status",
      mcpRange: "ปรับให้อยู่ในช่วงที่ระบบรับ ดู limits ใน /status",
      scope: "คัดกรองงานที่มีบทคัดย่อ แล้ววิเคราะห์ฉบับที่เกี่ยวข้องที่สุดตามจำนวนที่ผู้ใช้กำหนด (ช่วงที่รับอยู่ในหัวข้อ “ขีดจำกัดตอนนี้”) ถ้าผ่านเกณฑ์ไม่ถึงจะวิเคราะห์เท่าที่มีและแจ้งในรายงาน",
    };
  }
  const { max_papers: m, candidate_limit: c } = l;
  return {
    screen: `ราว ${c.default} ฉบับ`,
    read: `ตามจำนวนที่ผู้ใช้กำหนด ${paperRangeTh(l)}`,
    papers: paperRangeTh(l),
    mcpRange: `ปรับให้อยู่ในช่วง ${m.min}–${m.max}`,
    scope: `คัดกรองงานที่มีบทคัดย่อราว ${c.default} ฉบับ (ปรับได้ ${c.min}–${c.max}) แล้ววิเคราะห์ฉบับที่เกี่ยวข้องที่สุดตามจำนวนที่ผู้ใช้กำหนด ${m.min}–${m.max} ฉบับ (ค่าเริ่มต้น ${m.default}) ถ้าผ่านเกณฑ์ไม่ถึงจะวิเคราะห์เท่าที่มีและแจ้งในรายงาน`,
  };
}
