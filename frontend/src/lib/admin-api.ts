import type {
  AdminKey, AdminMe, AdminReview, AdminStatus, AuditEntry, CatalogModel, CatalogQuery, Dashboard, FieldError, GlossaryReport, GlossaryState,
  GlossaryTerm, HarnessCompare, HarnessReportItem, HarnessResultItem, HarnessRun, HarnessStartBody, HarnessState, LlmConfigDoc,
  LlmConfigState, LlmDraft, LlmSaveResult, LlmVersion, MintedKey, Page, ProbeResult, RuntimeKind, RuntimeVersion, SavedVersion,
  SettingValue, SettingsReport, SettingsState, ValidateReport,
} from "./admin-types";

/** Admin calls are relative and same-origin: the session cookie (Path=/api/v1/admin) never leaves the site, and Caddy
 * (or the dev rewrite in next.config.ts) routes them to the API. */
export const ADMIN_BASE = "/api/v1/admin";

/** The body's `errors` when it is a list of {field, message} (a settings or glossary document refused, Plan 23c). */
function fieldErrorsOf(body: unknown): FieldError[] | null {
  const errors = typeof body === "object" && body !== null ? (body as { errors?: unknown }).errors : undefined;
  if (!Array.isArray(errors)) return null;
  const out: FieldError[] = [];
  for (const e of errors) {
    if (typeof e !== "object" || e === null) return null;
    const { field, message } = e as { field?: unknown; message?: unknown };
    if (typeof message !== "string" || (field !== undefined && field !== null && typeof field !== "string")) return null;
    out.push({ field: typeof field === "string" ? field : null, message });
  }
  return out;
}

/** The body's `reasons` when it is a list of codes (the harness start's 503, Plan 23c). */
function reasonsOf(body: unknown): string[] | null {
  const reasons = typeof body === "object" && body !== null ? (body as { reasons?: unknown }).reasons : undefined;
  return Array.isArray(reasons) && reasons.every((r) => typeof r === "string") ? reasons : null;
}

export class AdminApiError extends Error {
  /** The body's field errors and reason codes, when it carries them in the right shape; null otherwise. */
  readonly errors: FieldError[] | null;
  readonly reasons: string[] | null;

  /** `structuredDetail`: the body's `detail` was not a string (FastAPI sends a list of field errors for a 422), so
   * `message` is only a status fallback and not fit to show. `body` is the parsed JSON of a failed answer (null when
   * there was none or it was not JSON). */
  constructor(public status: number, message: string, public retryAfter: number | null = null, public structuredDetail = false,
    public body: unknown = null) {
    super(message);
    this.name = "AdminApiError";
    this.errors = fieldErrorsOf(body);
    this.reasons = reasonsOf(body);
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
    let structured = false;
    let parsed: unknown = null;
    try {
      parsed = await res.json();
      const body = parsed as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
      else structured = body.detail !== undefined && body.detail !== null;
    } catch {
      // not JSON: keep the status text
    }
    const retry = Number(res.headers.get("Retry-After"));
    throw new AdminApiError(res.status, detail, Number.isFinite(retry) && retry > 0 ? retry : null, structured, parsed);
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
  llmConfig: () => call<LlmConfigState>("/llm-config"),
  llmVersions: (before?: number | null) => call<Page<LlmVersion>>(`/llm-config/versions${before ? `?before=${before}` : ""}`),
  llmVersion: (id: number) => call<LlmVersion & { config: LlmConfigDoc }>(`/llm-config/versions/${id}`),
  llmVersionYamlUrl: (id: number) => `${ADMIN_BASE}/llm-config/versions/${id}/yaml`,
  validateLlm: (draft: LlmDraft) => call<ValidateReport>("/llm-config/validate", send("POST", draft)),
  saveLlm: (body: LlmDraft & { base_version: number | null; note?: string }) =>
    call<LlmSaveResult>("/llm-config", send("POST", body)),
  restoreLlm: (id: number, base: number | null, note?: string) =>
    call<LlmSaveResult>(`/llm-config/versions/${id}/restore`, send("POST", { base_version: base, note })),
  resetLlm: (base: number | null, note?: string) =>
    call<LlmSaveResult>("/llm-config/reset", send("POST", { base_version: base, note })),
  llmModels: (query: CatalogQuery = {}) => {
    const p = new URLSearchParams();
    if (query.q?.trim()) p.set("q", query.q.trim());
    if (query.structured) p.set("structured", "true");
    if (query.reasoning) p.set("reasoning", "true");
    if (query.max_price != null) p.set("max_price", String(query.max_price));
    const qs = p.toString();
    return call<{ items: CatalogModel[]; available: boolean }>(`/llm-models${qs ? `?${qs}` : ""}`);
  },
  testLlm: (body: Partial<LlmDraft> & { preset?: string; role: string }) =>
    call<ProbeResult>("/llm-models/test", send("POST", body)),
  settings: () => call<SettingsState>("/settings"),
  validateSettings: (values: Record<string, SettingValue>) => call<SettingsReport>("/settings/validate", send("POST", { values })),
  saveSettings: (body: { values: Record<string, SettingValue>; base_version: number | null; note?: string }) =>
    call<SavedVersion>("/settings", send("POST", body)),
  glossary: () => call<GlossaryState>("/glossary"),
  validateGlossary: (terms: GlossaryTerm[]) => call<GlossaryReport>("/glossary/validate", send("POST", { terms })),
  saveGlossary: (body: { terms: GlossaryTerm[]; base_version: number | null; note?: string }) =>
    call<SavedVersion>("/glossary", send("POST", body)),
  runtimeVersions: (kind: RuntimeKind, before?: number | null) =>
    call<Page<RuntimeVersion>>(`/${kind}/versions${before ? `?before=${before}` : ""}`),
  restoreRuntime: (kind: RuntimeKind, version: number, base: number | null, note?: string) =>
    call<SavedVersion>(`/${kind}/versions/${version}/restore`, send("POST", { base_version: base, note })),
  resetRuntime: (kind: RuntimeKind, base: number | null, note?: string) =>
    call<SavedVersion>(`/${kind}/reset`, send("POST", { base_version: base, note })),
  harness: () => call<HarnessState>("/harness"),
  harnessRuns: (before?: number | null) => call<Page<HarnessRun>>(`/harness/runs${before ? `?before=${before}` : ""}`),
  startHarness: (body: HarnessStartBody) => call<HarnessRun>("/harness/runs", send("POST", body)),
  cancelHarness: (id: number) => call<HarnessRun>(`/harness/runs/${id}/cancel`, send("POST")),
  harnessReports: () => call<{ items: HarnessReportItem[] }>("/harness/reports"),
  harnessReport: (name: string) => call<{ name: string; text: string }>(`/harness/reports/${enc(name)}`),
  harnessResults: () => call<{ items: HarnessResultItem[] }>("/harness/results"),
  harnessCompare: (a: string, b: string) => call<HarnessCompare>(`/harness/compare?a=${enc(a)}&b=${enc(b)}`),
};

/** Thai text for a failed admin call. A 401 is handled by the gate, which sends the admin back to sign-in. */
export function adminErrorText(e: unknown): string {
  if (!(e instanceof AdminApiError)) return "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
  if (e.status === 0) return "ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่";
  if (e.status === 429) return e.retryAfter ? `ลองใหม่ได้ในอีก ${Math.ceil(e.retryAfter / 60)} นาที` : "ถูกจำกัดชั่วคราว ลองใหม่ภายหลัง";
  if (e.status === 403) return `ไม่มีสิทธิ์ทำรายการนี้ (${e.message})`;
  if (e.status === 404) return "ไม่พบรายการนี้แล้ว";
  if (e.status === 422 && e.structuredDetail) return "ข้อมูลที่กรอกไม่ถูกต้อง ตรวจแล้วลองใหม่";
  if (e.status === 409 || e.status === 422) return e.message;
  return `เกิดข้อผิดพลาด (${e.status}) ลองใหม่อีกครั้ง`;
}
