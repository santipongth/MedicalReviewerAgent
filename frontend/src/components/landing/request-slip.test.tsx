import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const createReview = vi.fn();
const getStatus = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()),
  createReview: (...a: unknown[]) => createReview(...a), getStatus: (...a: unknown[]) => getStatus(...a) }));

const OPEN = { accepting: true, reason: null, retry_after: null, queue_depth: 0, running: 0, reviews_today: 3,
  turnstile_site_key: null, limits: { review_rate_limit: "5/hour", api_key_rate_limit: "60/hour",
    paper_search_rate_limit: "30/minute", max_papers: { min: 5, max: 30, default: 30 },
    candidate_limit: { min: 20, max: 100, default: 60 }, max_queued_reviews: 50 } };

import { RequestSlip } from "./request-slip";

beforeEach(() => {
  push.mockReset();
  createReview.mockReset();
  getStatus.mockReset();
  getStatus.mockResolvedValue(OPEN);
  delete (window as { turnstile?: unknown }).turnstile;
});

describe("RequestSlip", () => {
  it("submits the topic with options and opens the review", async () => {
    createReview.mockResolvedValue({ review_id: "r-1", status: "queued", cached: false });
    render(<RequestSlip />);
    const topic = screen.getByLabelText(/หัวข้อ/);
    await userEvent.clear(topic);
    await userEvent.type(topic, "statins and dementia");
    await userEvent.click(screen.getByLabelText("English"));
    await userEvent.click(screen.getByLabelText("RCT"));
    await userEvent.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith({
      topic: "statins and dementia", language: "en", options: { max_papers: 30, study_types: ["RCT"] },
    });
    expect(push).toHaveBeenCalledWith("/r/r-1");
  });

  it("analyses up to 30 abstracts by default", () => {
    render(<RequestSlip />);
    const slider = screen.getByLabelText(/จำนวนงานวิจัยที่วิเคราะห์/);
    expect(slider).toHaveAttribute("max", "30");
    expect(slider).toHaveValue("30");
  });

  it("tells people when the service is full and does not let them submit", async () => {
    getStatus.mockResolvedValue({ ...OPEN, accepting: false, reason: "daily_budget", retry_after: 3600 });
    render(<RequestSlip />);
    expect(await screen.findByRole("status")).toHaveTextContent("วันนี้");
    expect(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ })).toBeDisabled();
  });

  it("explains a full queue returned at submit time", async () => {
    createReview.mockRejectedValue(new ApiError(503, "the review queue is full", 60, undefined, "queue_full"));
    render(<RequestSlip />);
    await userEvent.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("คิว");
  });

  it("sends the Turnstile token when the deployment uses Turnstile", async () => {
    (window as { turnstile?: unknown }).turnstile = {
      render: (_el: HTMLElement, opts: { callback: (t: string) => void }) => { opts.callback("tok-1"); return "w1"; },
      reset: vi.fn(),
    };
    getStatus.mockResolvedValue({ ...OPEN, turnstile_site_key: "site-key" });
    createReview.mockResolvedValue({ review_id: "r-2", status: "queued", cached: false });
    render(<RequestSlip />);
    await screen.findByTestId("turnstile");
    await userEvent.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({ language: "th" }), { turnstileToken: "tok-1" });
  });

  it("explains a rate limit with the wait time", async () => {
    createReview.mockRejectedValue(new ApiError(429, "rate limit exceeded", 1800));
    render(<RequestSlip />);
    await userEvent.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("30 นาที");
    expect(push).not.toHaveBeenCalled();
  });

  it("example topics fill the slip instead of navigating", async () => {
    render(<RequestSlip />);
    await userEvent.click(screen.getByRole("button", { name: "SGLT2 inhibitors and heart failure" }));
    expect(screen.getByLabelText(/หัวข้อ/)).toHaveValue("SGLT2 inhibitors and heart failure");
  });
});
