import type { AdminStatus, AuditEntry, HarnessStatus, LlmVersion, RuntimeVersion, SettingSpec } from "./admin-types";

export const STATUS_LABEL: Record<AdminStatus, string> = {
  queued: "รอคิว", running: "กำลังทำ", done: "เสร็จ", error: "ผิดพลาด", rejected: "ถูกปฏิเสธ", cancelled: "ยกเลิกแล้ว",
};

/** Stack and legend order on the dashboard chart; also the status filter's order. */
export const STATUS_ORDER: AdminStatus[] = ["done", "error", "rejected", "cancelled", "running", "queued"];

export const ACTION_LABEL: Record<string, string> = {
  "review.cancel": "ยกเลิกรีวิว", "review.hide": "ซ่อนรีวิวจากรายการสาธารณะ", "review.show": "แสดงรีวิวในรายการสาธารณะ",
  "review.delete": "ลบรีวิว", "key.mint": "สร้าง API key", "key.update": "แก้ไข API key", "key.revoke": "เพิกถอน API key",
  "admin.login": "เข้าสู่ระบบ", "admin.logout": "ออกจากระบบ", "admin.lockout": "ล็อกการเข้าสู่ระบบ (ผิดหลายครั้ง)",
  "admin.create": "สร้างบัญชีผู้ดูแล", "admin.passwd": "เปลี่ยนรหัสผ่าน", "admin.disable": "ปิดบัญชีผู้ดูแล",
  "admin.enable": "เปิดบัญชีผู้ดูแล",
  "llm_config.save": "บันทึกการตั้งค่าโมเดล", "llm_config.restore": "ย้อนการตั้งค่าโมเดล",
  "llm_config.reset": "สร้างเวอร์ชันใหม่จาก llm.yaml", "llm.test": "ทดสอบโมเดล",
  "settings.save": "บันทึกการตั้งค่า", "settings.restore": "ย้อนการตั้งค่า", "settings.reset": "กลับไปใช้ค่า env",
  "glossary.save": "บันทึกอภิธานศัพท์", "glossary.restore": "ย้อนอภิธานศัพท์", "glossary.reset": "กลับไปใช้อภิธานศัพท์ตั้งต้น",
  "harness.start": "เริ่มรัน harness", "harness.cancel": "ยกเลิก harness run",
  "llm_key.set": "ใส่คีย์ผู้ให้บริการ", "llm_key.replace": "เปลี่ยนคีย์ผู้ให้บริการ", "llm_key.delete": "ลบคีย์ผู้ให้บริการ",
  "llm_key.rotate": "เข้ารหัสคีย์ผู้ให้บริการใหม่ (CLI)",
};

export const MODEL_SOURCE_LABEL: Record<LlmVersion["source"], string> = {
  edit: "แก้ไข", restore: "ย้อนกลับ", file: "จาก llm.yaml",
};

/** A save, restore or reset answered 201 with `workers_notified: false`: the version is stored, the Redis publish
 * failed, and the workers' 30 s poll of the DB picks it up. */
export const WORKERS_NOT_NOTIFIED = "บันทึกแล้ว แต่แจ้ง worker ไม่สำเร็จ: worker จะใช้เวอร์ชันนี้ภายใน 30 วินาที";

export const ACTOR_LABEL: Record<AuditEntry["actor_kind"], string> = { user: "ผู้ดูแล", key: "API key", cli: "CLI" };

export const SETTING_LABEL: Record<string, string> = {
  review_rate_limit: "รีวิวต่อ IP (ไม่มี API key)", api_key_rate_limit: "รีวิวต่อ API key",
  paper_search_rate_limit: "ค้นหางานวิจัย (REST และ MCP)", sse_max_per_ip: "event stream ที่เปิดพร้อมกันต่อ client",
  max_queued_reviews: "รีวิวที่รอคิวได้สูงสุด", max_reviews_per_day: "รีวิวใหม่ต่อวัน", max_usd_per_day: "งบ LLM ต่อวัน (USD)",
  review_cost_base_usd: "งบต่อรีวิว: ค่าพื้นฐาน (USD)", review_cost_per_paper_usd: "งบต่อรีวิว: ต่องานที่วิเคราะห์ (USD)",
  review_cost_per_candidate_usd: "งบต่อรีวิว: ต่องานที่คัดกรอง (USD)", max_cost_per_review_usd: "เพดานงบต่อรีวิว (USD)",
  llm_concurrency: "LLM call พร้อมกันต่อ worker", result_cache_ttl_seconds: "อายุ cache ผลรีวิว (วินาที)",
};
export const SETTING_GROUP_ORDER: SettingSpec["group"][] = ["limits", "capacity", "cost", "workers", "cache"];
export const SETTING_GROUP_LABEL: Record<SettingSpec["group"], string> = {
  limits: "อัตราจำกัด", capacity: "ความจุ", cost: "งบค่าใช้จ่าย", workers: "Worker", cache: "Cache",
};
export const APPLIES_LABEL: Record<SettingSpec["applies"], string> = {
  api: "API · ภายใน 5 วินาที", worker: "worker · รีวิวถัดไป หรือภายใน 30 วินาที", both: "API และ worker",
};
export const RUNTIME_SOURCE_LABEL: Record<RuntimeVersion["source"], string> = { edit: "แก้ไข", restore: "ย้อนกลับ", reset: "กลับค่าตั้งต้น" };
export const HARNESS_STATUS_LABEL: Record<HarnessStatus, string> = {
  queued: "รอคิว", running: "กำลังรัน", done: "เสร็จ", stopped: "หยุดเพราะถึงงบ", cancelled: "ยกเลิกแล้ว", error: "ผิดพลาด",
};
export const HARNESS_REASON_LABEL: Record<string, string> = {
  no_manifest: "ไม่พบ manifest ของ harness (evals/cochrane/manifest.yaml)",
  no_fixtures: "ไม่มี frozen pool ในเครื่องนี้ ต้อง mount โฟลเดอร์ evals/cochrane ที่มี fixtures",
  no_worker: "harness worker ไม่ทำงาน (เริ่มด้วย docker compose --profile harness up -d harness)",
  stub_mode: "ระบบอยู่ใน GRAPH_MODE=stub รัน harness ไม่ได้",
  active_run: "มี harness run ที่รอคิวหรือกำลังรันอยู่",
};
export function harnessReasonText(code: string): string {
  return HARNESS_REASON_LABEL[code] ?? code;
}

/** Why the service refuses new reviews (the codes of Capacity.check in backend/app/services/capacity.py), in a few
 * words for the admin. The public form's longer advice to visitors is capacityText in landing/request-slip.tsx. */
export const REFUSAL_LABEL: Record<string, string> = {
  queue_full: "คิวเต็ม",
  daily_reviews: "ครบจำนวนรีวิวต่อวันแล้ว",
  daily_budget: "งบค่าใช้จ่ายต่อวันไม่พอ (นับรวมยอดที่กันไว้ให้รีวิวที่รอคิวและกำลังทำ)",
};

/** A code the console does not know yet shows as it came. */
export function refusalText(reason: string | null): string {
  return reason === null ? "ไม่ทราบเหตุผล" : REFUSAL_LABEL[reason] ?? reason;
}

export const NOT_BEHIND_SITE =
  "หน้า admin ใช้ผ่านที่อยู่หลักของเว็บเท่านั้น เปิดผ่าน Caddy (เช่น http://localhost:8088/admin) หรือโดเมนจริง ไม่ใช่พอร์ตของเว็บโดยตรง";

/** Service costs, not numbers from a paper: plain figures in the display face. Intl rounds the decimal as written
 * (0.0745 -> 0.075); toFixed rounds the binary double (0.0745 -> 0.074). */
export function formatUsd(n: number): string {
  const digits = n !== 0 && Math.abs(n) < 1 ? 3 : 2;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })}`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function show(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** One line per changed field: "daily_quota: 10 → 25"; a field only before or only after shows its one value. */
export function describeChange(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const b = before ?? {};
  const a = after ?? {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].sort().map((k) =>
    k in b && k in a ? `${k}: ${show(b[k])} → ${show(a[k])}` : `${k}: ${show(k in a ? a[k] : b[k])}`);
}
