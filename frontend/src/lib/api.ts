import { apiUrl } from "./config";
import type { CreateReviewBody, Review, ReviewCreated, ReviewSummary, ServiceStatus } from "./types";

/** Plan 26: a request that gets no review (422 with a code): an emergency, with the numbers to call. */
export interface Refusal {
  code: string;
  kind?: string;
  hotlines: string[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
    public reviewId?: string,
    public reason?: string,
    public refusal?: Refusal,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function detailMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string };
    return first.msg ?? undefined;
  }
  return undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? e.message : "network error");
  }
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const retry = Number(res.headers.get("retry-after"));
    const { review_id: reviewId, reason, code, kind, hotlines } = (body ?? {}) as {
      review_id?: string; reason?: string; code?: unknown; kind?: unknown; hotlines?: unknown;
    };
    const refusal = typeof code === "string" ? {
      code, kind: typeof kind === "string" ? kind : undefined,
      hotlines: Array.isArray(hotlines) ? hotlines.filter((h): h is string => typeof h === "string") : [],
    } : undefined;
    throw new ApiError(res.status, detailMessage(body) ?? res.statusText, Number.isFinite(retry) && retry > 0 ? retry : undefined,
      reviewId, reason, refusal);
  }
  return (await res.json()) as T;
}

export function createReview(body: CreateReviewBody, opts?: { turnstileToken?: string }): Promise<ReviewCreated> {
  const headers: Record<string, string> = opts?.turnstileToken ? { "cf-turnstile-response": opts.turnstileToken } : {};
  return request<ReviewCreated>("/api/v1/reviews", { method: "POST", body: JSON.stringify(body), headers });
}

export function getStatus(): Promise<ServiceStatus> {
  return request<ServiceStatus>("/api/v1/status");
}

export function exportUrl(id: string, format: "md" | "csv" | "json"): string {
  return `${apiUrl()}/api/v1/reviews/${encodeURIComponent(id)}/export?format=${format}`;
}

/** Plan 30: the API sends `topic: null` for a personal medical refusal (its question is never echoed); pages read "". */
export async function getReview(id: string): Promise<Review> {
  const review = await request<Omit<Review, "topic"> & { topic: string | null }>(`/api/v1/reviews/${encodeURIComponent(id)}`);
  return { ...review, topic: review.topic ?? "" };
}

export function listRecent(limit = 10): Promise<ReviewSummary[]> {
  return request<ReviewSummary[]>(`/api/v1/reviews?recent=${limit}`);
}
