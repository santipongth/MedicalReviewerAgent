import { apiUrl } from "./config";
import type { CreateReviewBody, Review, ReviewCreated, ReviewSummary, ServiceStatus } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
    public reviewId?: string,
    public reason?: string,
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
    const { review_id: reviewId, reason } = (body ?? {}) as { review_id?: string; reason?: string };
    throw new ApiError(res.status, detailMessage(body) ?? res.statusText, Number.isFinite(retry) && retry > 0 ? retry : undefined,
      reviewId, reason);
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

export function getReview(id: string): Promise<Review> {
  return request<Review>(`/api/v1/reviews/${encodeURIComponent(id)}`);
}

export function listRecent(limit = 10): Promise<ReviewSummary[]> {
  return request<ReviewSummary[]>(`/api/v1/reviews?recent=${limit}`);
}
