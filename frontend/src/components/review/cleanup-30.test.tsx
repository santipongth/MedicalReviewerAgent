import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene } from "@/lib/agent-scene";
import { getReview } from "@/lib/api";
import { initialRun, reduceRun, type RunState } from "@/lib/progress";
import { FALLBACK_TITLE } from "@/lib/title";
import type { Review, ReviewEvent } from "@/lib/types";
import { quickReviewFixture, reviewFixture } from "@/test/fixtures";

const useReview = vi.fn();
vi.mock("@/lib/use-review", () => ({ useReview: (...a: unknown[]) => useReview(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/r/x", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/standalone-assets", () => ({ loadStandaloneAssets: async () => ({ js: "/*app*/", css: "/*css*/" }) }));

import { GET } from "@/app/r/[id]/report.html/route";
import { QuickAnswer } from "./quick-answer";
import { ReviewScreen } from "./review-screen";

vi.setConfig({ testTimeout: 20_000 });

const TOPIC = "ฉันปวดหัวทุกวัน ควรกินยาอะไร";
const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent =>
  ({ seq, type, payload } as unknown as ReviewEvent);
const runOf = (...types: string[]): RunState => types.reduce((s, t, i) => reduceRun(s, ev(i + 1, t)), initialRun());

function live(run: RunState) {
  const review = { ...reviewFixture, topic: TOPIC, status: "running", result: null } as unknown as Review;
  return { review, run, scene: initialScene(), phase: "live", connection: "open", retry: vi.fn() };
}

beforeEach(() => {
  document.title = "";
  useReview.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("Plan 30: the tab title waits for the topic check", () => {
  it("marks the topic check as passed from the first event after it", () => {
    expect(runOf("queued", "started", "checking_topic").guardPassed).toBeFalsy();
    expect(runOf("queued", "started", "checking_topic", "refining").guardPassed).toBe(true);
    expect(runOf("started", "done").guardPassed).toBe(true);
    expect(runOf("started", "checking_topic", "rejected").guardPassed).toBeFalsy();
  });

  it("keeps a neutral title while the topic is being checked", () => {
    useReview.mockReturnValue(live(runOf("queued", "started", "checking_topic")));
    render(<ReviewScreen id="x" />);
    expect(document.title).toBe(FALLBACK_TITLE);
  });

  it("names the tab after the topic once the check has passed", () => {
    useReview.mockReturnValue(live(runOf("queued", "started", "checking_topic", "refining")));
    render(<ReviewScreen id="x" />);
    expect(document.title).toBe(TOPIC);
  });
});

describe("Plan 30: a personal refusal's topic arrives as null", () => {
  it("reads it as an empty topic", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...reviewFixture, topic: null, status: "rejected" }),
      { status: 200, headers: { "content-type": "application/json" } })));
    expect((await getReview(reviewFixture.id)).topic).toBe("");
  });
});

describe("Plan 30: the offline report of a quick answer", () => {
  it("sends the reader to the quick answer page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(quickReviewFixture), { status: 200 })));
    const id = quickReviewFixture.id;
    const res = await GET(new Request(`http://web/r/${id}/report.html`), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/r/${id}`);
  });
});

describe("Plan 30: quick page details", () => {
  const withText = (text: string, refs: string[]): Review => ({
    ...quickReviewFixture,
    result: { ...quickReviewFixture.result!, summary: text, support: null, quick: { refs, papers_read: 4 },
      synthesis: { ...quickReviewFixture.result!.synthesis!, executive_summary: text } },
  });

  it("leaves no stray space where a group with no numberable ref is dropped", () => {
    render(<QuickAnswer review={withText("ผลลดลง [P8]. อีกงานพบผลคล้ายกัน [P1]", ["P1"])} />);
    const text = document.querySelector("[data-quick-text]")!.textContent!;
    expect(text).toContain("ผลลดลง.");
    expect(text).not.toMatch(/ {2}| \./);
  });

  it("keeps the space before a valid group that directly follows a dropped one", () => {
    render(<QuickAnswer review={withText("risk [P8][P1].", ["P1"])} />);
    expect(document.querySelector("[data-quick-text]")!.textContent).toBe("risk [1].");
  });

  it("says a cited study's details are missing instead of showing its raw id", () => {
    render(<QuickAnswer review={withText("ผลลดลง [P1, P9]", ["P1", "P9"])} />);
    const missing = document.querySelector('[data-quick-ref="P9"]')!;
    expect(missing).toHaveTextContent("ไม่พบรายละเอียดของงานวิจัยนี้ในผลลัพธ์");
    expect(missing.textContent).not.toContain("P9");
  });
});
