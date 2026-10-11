// Plan 21: the paper-count limits come from GET /api/v1/status. Copy and the request form use them only when they are
// usable ranges; otherwise they fall back to number-free wording and leave the count to the API's default.
import type { ServiceLimits } from "./types";

type Range = { min: number; max: number; default: number };

function isRange(r: unknown): r is Range {
  const o = r as Partial<Record<keyof Range, unknown>> | null | undefined;
  if (!o || typeof o !== "object") return false;
  const { min, max, default: d } = o;
  return [min, max, d].every((v) => typeof v === "number" && Number.isFinite(v)) && (min as number) <= (d as number) && (d as number) <= (max as number);
}

/** "(min–max ฉบับ ค่าเริ่มต้น d)": the paper-count range as the developer page states it. */
export function paperRangeTh(limits: ServiceLimits): string {
  const m = limits.max_papers;
  return `(${m.min}–${m.max} ฉบับ ค่าเริ่มต้น ${m.default})`;
}

/** The limits when both the paper count and the pool size are usable ranges (min <= default <= max), else null. */
export function usableLimits(limits: unknown): ServiceLimits | null {
  const l = limits as Partial<ServiceLimits> | null | undefined;
  return l && isRange(l.max_papers) && isRange(l.candidate_limit) ? (l as ServiceLimits) : null;
}
