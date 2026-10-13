import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialRun } from "@/lib/progress";
import { initialScene } from "@/lib/agent-scene";
import { FALLBACK_TITLE } from "@/lib/title";
import type { Review } from "@/lib/types";

const useReview = vi.fn();
vi.mock("@/lib/use-review", () => ({ useReview: (...a: unknown[]) => useReview(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/r/x", useSearchParams: () => new URLSearchParams() }));

import { ReviewScreen } from "./review-screen";

const TOPIC = "ฉันปวดหัวทุกวัน ควรกินยาอะไร";

function state(over: { code?: string | null; error?: string | null }) {
  const review = { id: "x", topic: TOPIC, status: "rejected", error: over.error ?? null, refusal_code: over.code ?? null } as unknown as Review;
  const run = { ...initialRun(), status: "rejected" as const, terminal: true, code: over.code ?? null, message: over.error ?? null };
  return { review, run, scene: initialScene(), phase: "terminal", connection: "open", retry: vi.fn() };
}

beforeEach(() => {
  document.title = "";
  useReview.mockReset();
});

describe("ReviewScreen tab title (Plan 26 final fix A2)", () => {
  it("names the tab after the topic for an ordinary rejection", () => {
    useReview.mockReturnValue(state({ code: "declined", error: "not medical" }));
    render(<ReviewScreen id="x" />);
    expect(document.title).toBe(TOPIC);
  });

  it("never puts a personal medical question in the tab", () => {
    useReview.mockReturnValue(state({ code: "personal_medical", error: "personal_medical: fixed text" }));
    render(<ReviewScreen id="x" />);
    expect(document.title).toBe(FALLBACK_TITLE);
    expect(document.body.textContent).not.toContain(TOPIC);
  });

  it("recognises the stored error prefix when the code is missing", () => {
    useReview.mockReturnValue(state({ error: "personal_medical: fixed text" }));
    render(<ReviewScreen id="x" />);
    expect(document.title).toBe(FALLBACK_TITLE);
  });
});
