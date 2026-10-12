import type { AdminStatus, AuditEntry } from "./admin-types";

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
};

export const ACTOR_LABEL: Record<AuditEntry["actor_kind"], string> = { user: "ผู้ดูแล", key: "API key", cli: "CLI" };

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
