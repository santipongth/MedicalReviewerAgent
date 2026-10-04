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

export const LIVE_EVENTS: [string, Record<string, unknown>][] = [
  ["queued", { topic: reviewFixture.topic }], ["started", { resume: false, elapsed_s: 0.1 }],
  ["checking_topic", { elapsed_s: 0.5 }], ["refining", { elapsed_s: 0.8 }],
  ["question_refined", { refined_question: "ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2 เมตฟอร์มินลดอุบัติการณ์มะเร็งลำไส้ใหญ่หรือไม่",
    interpretation: "คุณอยากรู้ว่าเมตฟอร์มินลดความเสี่ยงหรือไม่", sub_questions: ["ผลขึ้นกับระยะเวลาการใช้ยาหรือไม่"], assumptions: [], elapsed_s: 4 }],
  ["planning", { queries: ["metformin colorectal cancer"], elapsed_s: 6 }], ["searching", { found: 41, elapsed_s: 9 }],
  ["enriching", { candidates: 60, elapsed_s: 11 }], ["screening", { batch: 10, elapsed_s: 12 }], ["screened", { kept: 30, total: 60, elapsed_s: 16 }],
  ["reading", { ref: "P1", title: "Metformin and incident colorectal cancer in a national diabetes cohort", elapsed_s: 17 }],
  ["extracted", { ref: "P1", ok: true, verified: 2, uncertain: false, elapsed_s: 30 }],
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
    if (key === `GET /api/v1/reviews/${RID}`) return json(route, 200, reviewFixture);
    if (key === "GET /api/v1/reviews/empty") return json(route, 200, { ...emptyReviewFixture, id: "empty" });
    return json(route, 404, { detail: "review not found" });
  });
}

export { json };
