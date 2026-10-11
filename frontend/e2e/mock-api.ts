import type { Page, Route } from "@playwright/test";
import { emptyReviewFixture, reviewFixture } from "../src/test/fixtures";

export const API = "http://api.mock";
export const RID = reviewFixture.id;

type Handler = (route: Route) => Promise<void> | void;

function json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
  return route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: JSON.stringify(body) });
}

export function sse(events: [string, Record<string, unknown>][]): string {
  return events.map(([type, payload], i) => `id: ${i + 1}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`).join("");
}

export const OPEN_STATUS = {
  accepting: true, reason: null, retry_after: null, queue_depth: 0, running: 1, reviews_today: 12, turnstile_site_key: null,
  limits: { review_rate_limit: "5/hour", api_key_rate_limit: "60/hour", paper_search_rate_limit: "30/minute",
    max_papers: { min: 5, max: 30, default: 30 }, candidate_limit: { min: 20, max: 100, default: 60 }, max_queued_reviews: 50, sse_max_per_ip: 5 },
};

export const LIVE_EVENTS: [string, Record<string, unknown>][] = [
  ["queued", { topic: reviewFixture.topic }], ["started", { resume: false, elapsed_s: 0.1 }],
  ["checking_topic", { elapsed_s: 0.5 }], ["refining", { elapsed_s: 0.8 }],
  ["question_refined", { refined_question: "ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2 เมตฟอร์มินลดอุบัติการณ์มะเร็งลำไส้ใหญ่หรือไม่",
    interpretation: "คุณอยากรู้ว่าเมตฟอร์มินลดความเสี่ยงหรือไม่", sub_questions: ["ผลขึ้นกับระยะเวลาการใช้ยาหรือไม่"], assumptions: [], elapsed_s: 4 }],
  ["planning", { queries: ["metformin colorectal cancer"], elapsed_s: 6 }], ["searching", { found: 41, elapsed_s: 9 }],
  ["enriching", { candidates: 60, elapsed_s: 11 }], ["screening", { batch: 10, elapsed_s: 12 }], ["screened", { kept: 30, total: 60, elapsed_s: 16 }],
  ["reading", { ref: "P1", title: "Metformin and incident colorectal cancer in a national diabetes cohort", elapsed_s: 17 }],
  ["extracted", { ref: "P1", ok: true, verified: 2, uncertain: false, direction: "positive", design: "cohort", elapsed_s: 30 }],
];

/**
 * Eight finished reads (P1..P8) with mixed directions, to follow the 30 `reading` events: positive x2, negative, the
 * string "null" (no association), mixed (an SR/MA), unclear + uncertain, a failed read, and an ok read with no direction.
 * Board counts: positive 2, negative 1, null 1, mixed 1, unclear 1; no direction 1; failed 1; read 8.
 */
export const DIRECTION_EVENTS: [string, Record<string, unknown>][] = [
  ["extracted", { ref: "P1", ok: true, verified: 2, uncertain: false, direction: "positive", design: "cohort", elapsed_s: 21 }],
  ["extracted", { ref: "P2", ok: true, verified: 1, uncertain: false, direction: "negative", design: "rct", elapsed_s: 22 }],
  ["extracted", { ref: "P3", ok: true, verified: 2, uncertain: false, direction: "null", design: "case_control", elapsed_s: 23 }],
  ["extracted", { ref: "P4", ok: true, verified: 3, uncertain: false, direction: "mixed", design: "sr_ma_rct", elapsed_s: 24 }],
  ["extracted", { ref: "P5", ok: true, verified: 0, uncertain: true, direction: "unclear", design: "cohort", elapsed_s: 25 }],
  ["extracted", { ref: "P6", ok: false, verified: 0, uncertain: false, direction: null, design: null, elapsed_s: 26 }],
  ["extracted", { ref: "P7", ok: true, verified: 1, uncertain: false, direction: null, design: null, elapsed_s: 27 }],
  ["extracted", { ref: "P8", ok: true, verified: 2, uncertain: false, direction: "positive", design: "rct", elapsed_s: 28 }],
];

/** Intercept every call to the fake API origin. `overrides` win over the defaults below. */
export async function mockApi(page: Page, overrides: Record<string, Handler> = {}) {
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const key = `${method} ${url.pathname}`;
    if (method === "OPTIONS") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE" } });
    }
    if (overrides[key]) return overrides[key](route);
    if (key === "GET /api/v1/reviews") {
      return json(route, 200, [{ id: RID, topic: reviewFixture.topic, language: "th", status: "done", created_at: reviewFixture.created_at,
        finished_at: reviewFixture.finished_at, verification_rate: 0.857 }]);
    }
    if (key === "GET /api/v1/status") return json(route, 200, OPEN_STATUS);
    if (key === `GET /api/v1/reviews/${RID}`) return json(route, 200, reviewFixture);
    if (key === "GET /api/v1/reviews/empty") return json(route, 200, { ...emptyReviewFixture, id: "empty" });
    return json(route, 404, { detail: "review not found" });
  });
}

export { json };

export interface SseFrame {
  delayMs: number;
  events: [string, Record<string, unknown>][];
  /** release this frame only once an element matching this selector is on the page (then wait `delayMs`): a test
   * that needs the page ready for an event waits on that, not on a guess of how long loading takes (Task 9). Re-checked
   * on every DOM change, attributes included; a gate still closed is named in `window.__sseGate` (see `sseGatesOpen`). */
  after?: string;
}

/**
 * Serve `/reviews/${RID}/events` as a stream that releases each frame `delayMs` after the previous one (same SSE
 * wire format and seq numbering as `sse()`), or, for a frame with `after`, `delayMs` after its selector appears. The
 * stream stays open after the last frame, like a running review. The time each frame was sent is kept in
 * `window.__sseFrameAt`. Installed as an init script around window.fetch, so it also works when the page clock is
 * faked; every other request passes through to the real fetch (and so to `page.route`).
 */
export async function streamSse(page: Page, frames: SseFrame[]) {
  let seq = 0;
  const wire = frames.map((f) => ({
    delayMs: f.delayMs,
    after: f.after ?? null,
    text: f.events.map(([type, payload]) => { seq += 1; return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`; }).join(""),
  }));
  await page.addInitScript(({ wire, rid }) => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith(`/reviews/${rid}/events`)) return realFetch(input, init);
      const w = window as unknown as { __sseStart: number; __sseFrameAt: number[]; __sseGate: string | null };
      w.__sseGate = null;
      w.__sseStart = Date.now(); // lets a test line itself up with the first frame
      w.__sseFrameAt = [];
      const enc = new TextEncoder();
      const timers: number[] = [];
      let observer: MutationObserver | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          const send = (text: string) => { w.__sseFrameAt.push(Date.now()); try { c.enqueue(enc.encode(text)); } catch { /* closed */ } };
          if (!wire.some((f) => f.after)) {
            let at = 0;
            for (const f of wire) {
              at += f.delayMs;
              timers.push(window.setTimeout(() => send(f.text), at));
            }
          } else {
            // one frame after another: a gated frame waits for its selector first
            const next = (i: number) => {
              const f = wire[i];
              if (!f) return;
              const go = () => { timers.push(window.setTimeout(() => { send(f.text); next(i + 1); }, f.delayMs)); };
              if (!f.after || document.querySelector(f.after)) return go();
              w.__sseGate = f.after;
              observer = new MutationObserver(() => {
                if (!document.querySelector(f.after!)) return;
                observer?.disconnect();
                w.__sseGate = null;
                go();
              });
              observer.observe(document, { subtree: true, childList: true, attributes: true });
            };
            next(0);
          }
          init?.signal?.addEventListener("abort", () => {
            timers.forEach((t) => window.clearTimeout(t));
            observer?.disconnect();
            try { c.error(new DOMException("aborted", "AbortError")); } catch { /* closed */ }
          });
        },
        cancel() { timers.forEach((t) => window.clearTimeout(t)); observer?.disconnect(); },
      });
      return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
    };
  }, { wire, rid: RID });
}

/** Waits until no `after:` gate of `streamSse` is still closed, else fails naming the selector that never matched. */
export async function sseGatesOpen(page: Page, timeout = 15_000) {
  try {
    await page.waitForFunction(() => (window as unknown as { __sseGate?: string | null }).__sseGate == null, undefined, { timeout });
  } catch {
    const gate = await page.evaluate(() => (window as unknown as { __sseGate?: string | null }).__sseGate);
    throw new Error(`streamSse: the frame gated on "${gate}" was never sent (no element matched within ${timeout} ms)`);
  }
}
