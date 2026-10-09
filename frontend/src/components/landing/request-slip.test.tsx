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

async function typeTopic(text = "statins and dementia") {
  await userEvent.type(screen.getByLabelText(/หัวข้อ/), text);
}

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
    await typeTopic();
    await userEvent.click(screen.getByLabelText("English"));
    await userEvent.click(screen.getByLabelText(/RCT/));
    await userEvent.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith({
      topic: "statins and dementia", language: "en", options: { max_papers: 30, review_type: "slr", study_types: ["RCT"] },
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

  it("tells the reopening time from the service, in the viewer's own clock", async () => {
    const { capacityText } = await import("./request-slip");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:59:59.900+07:00")); // a minute boundary must not split the two reads
    const reopen = new Date(Date.now() + 5400 * 1000).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    expect(capacityText("daily_budget", 5400)).toContain(reopen);
    expect(capacityText("daily_budget", 5400)).not.toContain("07:00");
    vi.useRealTimers();
  });

  it("explains a full queue returned at submit time", async () => {
    createReview.mockRejectedValue(new ApiError(503, "the review queue is full", 60, undefined, "queue_full"));
    render(<RequestSlip />);
    await typeTopic();
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
    await typeTopic();
    await userEvent.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({ language: "th" }), { turnstileToken: "tok-1" });
  });

  it("explains why it cannot submit when the Turnstile script is blocked", async () => {
    getStatus.mockResolvedValue({ ...OPEN, turnstile_site_key: "site-key" });
    render(<RequestSlip />);
    await screen.findByTestId("turnstile");
    const script = document.head.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]');
    expect(script).not.toBeNull();
    script!.dispatchEvent(new Event("error"));
    expect(await screen.findByText(/โหลดระบบยืนยันว่าเป็นผู้ใช้จริงไม่ได้/)).toBeInTheDocument();
    script!.remove();
  });

  it("names a momentary admission backlog honestly", async () => {
    createReview.mockRejectedValue(new ApiError(503, "too many submissions", 5, undefined, "busy"));
    render(<RequestSlip />);
    await typeTopic();
    await userEvent.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("มีผู้ส่งพร้อมกันจำนวนมาก");
  });

  it("explains a rate limit with the wait time", async () => {
    createReview.mockRejectedValue(new ApiError(429, "rate limit exceeded", 1800));
    render(<RequestSlip />);
    await typeTopic();
    await userEvent.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("30 นาที");
    expect(push).not.toHaveBeenCalled();
  });

  it("example topics fill the slip instead of navigating", async () => {
    render(<RequestSlip />);
    await userEvent.click(screen.getByRole("button", { name: "SGLT2 inhibitors and heart failure" }));
    expect(screen.getByLabelText(/หัวข้อ/)).toHaveValue("SGLT2 inhibitors and heart failure");
  });

  it("starts with an empty topic and a placeholder example", () => {
    render(<RequestSlip />);
    const topic = screen.getByLabelText(/หัวข้อ/);
    expect(topic).toHaveValue("");
    expect(topic).toHaveAttribute("placeholder", "เช่น เมตฟอร์มินกับมะเร็งลำไส้ใหญ่");
  });

  it("pre-fills the topic from initialTopic", () => {
    render(<RequestSlip initialTopic="vitamin D and fractures" />);
    expect(screen.getByLabelText(/หัวข้อ/)).toHaveValue("vitamin D and fractures");
  });

  it("says why the button is disabled while the Turnstile token is pending", async () => {
    getStatus.mockResolvedValue({ ...OPEN, turnstile_site_key: "site-key" });
    render(<RequestSlip />);
    await screen.findByTestId("turnstile");
    const button = screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ });
    expect(button).toBeDisabled();
    const reason = await screen.findByText(/กำลังยืนยันว่าเป็นผู้ใช้จริง/);
    expect(button.getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("summarises the folded options as they change", async () => {
    render(<RequestSlip />);
    const summary = screen.getByText("ตัวเลือกเพิ่มเติม").closest("summary") as HTMLElement;
    expect(summary).toHaveTextContent("ทุกชนิดงานวิจัย · สูงสุด 30 ฉบับ · ทุกปี");
    await userEvent.click(screen.getByLabelText(/RCT/));
    await userEvent.type(screen.getByLabelText(/ตั้งแต่ปี/), "2015");
    expect(summary).toHaveTextContent("การทดลองแบบสุ่ม (RCT) · สูงสุด 30 ฉบับ · ตั้งแต่ปี 2015");
  });

  it("sends English study-type values although the labels are Thai", async () => {
    createReview.mockResolvedValue({ review_id: "r-3", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    await userEvent.click(screen.getByLabelText(/Cohort/));
    await userEvent.click(screen.getByLabelText(/Systematic review/));
    await userEvent.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({
      options: { max_papers: 30, review_type: "slr", study_types: ["Cohort", "Systematic review"] },
    }));
  });
});
