import type { AdminKey, AdminMe, AdminReview, AdminStatus, AuditEntry, Dashboard, MintedKey, Page } from "./admin-types";

/** Admin calls are relative and same-origin: the session cookie (Path=/api/v1/admin) never leaves the site, and Caddy
 * (or the dev rewrite in next.config.ts) routes them to the API. */
export const ADMIN_BASE = "/api/v1/admin";

export class AdminApiError extends Error {
  constructor(public status: number, message: string, public retryAfter: number | null = null) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-MRA-Admin"] = "1";
  let res: Response;
  try {
    res = await fetch(`${ADMIN_BASE}${path}`, { ...init, method, credentials: "same-origin", headers });
  } catch (e) {
    throw new AdminApiError(0, e instanceof Error ? e.message : "network error");
  }
  if (!res.ok) {
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // not JSON: keep the status text
    }
    const retry = Number(res.headers.get("Retry-After"));
    throw new AdminApiError(res.status, detail, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const send = (method: string, body?: unknown): RequestInit =>
  body === undefined ? { method } : { method, body: JSON.stringify(body) };
const enc = encodeURIComponent;

export interface ReviewQuery { q?: string; status?: AdminStatus | ""; listed?: "" | "true" | "false"; before?: string | null }

export const adminApi = {
  signIn: (username: string, password: string) => call<void>("/session", send("POST", { username, password })),
  signOut: () => call<void>("/session", send("DELETE")),
  me: () => call<AdminMe>("/me"),
  dashboard: (days = 30) => call<Dashboard>(`/dashboard?days=${days}`),
  reviews: (query: ReviewQuery = {}) => {
    const p = new URLSearchParams();
    if (query.q?.trim()) p.set("q", query.q.trim());
    if (query.status) p.set("status", query.status);
    if (query.listed) p.set("listed", query.listed);
    if (query.before) p.set("before", query.before);
    const qs = p.toString();
    return call<Page<AdminReview>>(`/reviews${qs ? `?${qs}` : ""}`);
  },
  cancelReview: (id: string) => call<{ id: string; status: string }>(`/reviews/${enc(id)}/cancel`, send("POST")),
  setListed: (id: string, isListed: boolean) =>
    call<{ id: string; is_listed: boolean }>(`/reviews/${enc(id)}`, send("PATCH", { is_listed: isListed })),
  deleteReview: (id: string) => call<void>(`/reviews/${enc(id)}`, send("DELETE")),
  keys: () => call<AdminKey[]>("/keys"),
  mintKey: (body: { name: string; daily_quota: number; is_admin: boolean }) => call<MintedKey>("/keys", send("POST", body)),
  updateKey: (id: string, body: { name?: string; daily_quota?: number }) => call<AdminKey>(`/keys/${enc(id)}`, send("PATCH", body)),
  revokeKey: (id: string) => call<AdminKey>(`/keys/${enc(id)}/revoke`, send("POST")),
  audit: (before?: number | null) => call<Page<AuditEntry>>(`/audit${before ? `?before=${before}` : ""}`),
};

/** Thai text for a failed admin call. A 401 is handled by the gate, which sends the admin back to sign-in. */
export function adminErrorText(e: unknown): string {
  if (!(e instanceof AdminApiError)) return "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
  if (e.status === 0) return "ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่";
  if (e.status === 429) return e.retryAfter ? `ลองใหม่ได้ในอีก ${Math.ceil(e.retryAfter / 60)} นาที` : "ถูกจำกัดชั่วคราว ลองใหม่ภายหลัง";
  if (e.status === 403) return `ไม่มีสิทธิ์ทำรายการนี้ (${e.message})`;
  if (e.status === 404) return "ไม่พบรายการนี้แล้ว";
  if (e.status === 409 || e.status === 422) return e.message;
  return `เกิดข้อผิดพลาด (${e.status}) ลองใหม่อีกครั้ง`;
}
