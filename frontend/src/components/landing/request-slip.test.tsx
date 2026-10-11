import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { GLOSS, glossText } from "@/lib/glossary";
import { STATUS_FIXTURE } from "@/test/status-fixture";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const createReview = vi.fn();
const getStatus = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()),
  createReview: (...a: unknown[]) => createReview(...a), getStatus: (...a: unknown[]) => getStatus(...a) }));

const OPEN = STATUS_FIXTURE;

import { RequestSlip } from "./request-slip";

// Flake root cause (Task 9): every keystroke of userEvent.type re-rendered the whole form and waited on a setTimeout
// (the default delay 0), so a test's wall time grew with CPU load until it hit Vitest's 5 s timeout in a busy full run
// (reproduced by running three suites at once). Now nothing waits on a timer (delay: null) and the topic is pasted as
// one input event, as a person pasting a question would.
let user: ReturnType<typeof userEvent.setup>;

async function typeTopic(text = "statins and dementia") {
  await user.click(screen.getByLabelText(/คำถามหรือวัตถุประสงค์/));
  await user.paste(text);
}

beforeEach(() => {
  user = userEvent.setup({ delay: null }); // one per test, as the user-event docs recommend
  push.mockReset();
  createReview.mockReset();
  getStatus.mockReset();
  getStatus.mockResolvedValue(OPEN);
  delete (window as { turnstile?: unknown }).turnstile;
  // a script left by an earlier test belongs to an unmounted slip
  document.head.querySelectorAll('script[src*="challenges.cloudflare.com"]').forEach((el) => el.remove());
});

describe("RequestSlip", () => {
  it("submits the topic with options and opens the review", async () => {
    createReview.mockResolvedValue({ review_id: "r-1", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    await user.click(screen.getByLabelText("English"));
    await user.click(screen.getByLabelText(/RCT/));
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith({
      topic: "statins and dementia", language: "en", options: { max_papers: 30, review_type: "slr", study_types: ["RCT"] },
    });
    expect(push).toHaveBeenCalledWith("/r/r-1");
  });

  it("takes the slider's range and starting value from /status (5–50, default 30)", async () => {
    render(<RequestSlip />);
    const slider = await screen.findByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    expect(slider).toHaveAttribute("min", "5");
    expect(slider).toHaveAttribute("max", "50");
    expect(slider).toHaveValue("30");
    expect(slider).toHaveAttribute("aria-valuetext", "30 ฉบับ");
    const help = document.getElementById(slider.getAttribute("aria-describedby")!);
    expect(help).toHaveTextContent(
      "ระบบคัดกรองราว 120 ฉบับที่มีบทคัดย่อ แล้ววิเคราะห์ฉบับที่เกี่ยวข้องที่สุดตามจำนวนนี้ ถ้าผ่านเกณฑ์ไม่ถึงจะวิเคราะห์เท่าที่มีและแจ้งในรายงาน");
  });

  it("submits the count the slider is moved to", async () => {
    createReview.mockResolvedValue({ review_id: "r-1", status: "queued", cached: false });
    render(<RequestSlip />);
    const slider = await screen.findByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    fireEvent.change(slider, { target: { value: "50" } });
    expect(slider).toHaveAttribute("aria-valuetext", "50 ฉบับ");
    await typeTopic();
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith({
      topic: "statins and dementia", language: "th", options: { max_papers: 50, review_type: "slr" },
    });
  });

  it("follows whatever maximum the service reports (never hard-coded)", async () => {
    getStatus.mockResolvedValue({ ...OPEN, limits: { ...OPEN.limits, max_papers: { min: 5, max: 40, default: 20 } } });
    render(<RequestSlip />);
    const slider = await screen.findByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    expect(slider).toHaveAttribute("max", "40");
    expect(slider).toHaveValue("20");
  });

  it("uses the server-rendered limits before the browser's own status read lands", () => {
    getStatus.mockReturnValue(new Promise(() => {})); // never settles
    render(<RequestSlip limits={OPEN.limits} />);
    const slider = screen.getByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    expect(slider).toHaveAttribute("max", "50");
    expect(slider).toHaveValue("30");
  });

  it("with no limits known (status unreadable), shows no slider and lets the API pick the count", async () => {
    getStatus.mockRejectedValue(new ApiError(0, "network"));
    createReview.mockResolvedValue({ review_id: "r-1", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByText("ตัวเลือกเพิ่มเติม").closest("summary")?.textContent).not.toMatch(/\d+ ฉบับ/);
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith({ topic: "statins and dementia", language: "th", options: { review_type: "slr" } });
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
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
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
    await typeTopic();
    // the status first (the button is also enabled before it arrives, when no Turnstile is known), then the token: the
    // widget mounts in a passive effect after the container renders, and the button turns enabled when its token is in
    await screen.findByTestId("turnstile");
    const button = screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({ language: "th" }), { turnstileToken: "tok-1" });
  });

  it("explains why it cannot submit when the Turnstile script is blocked", async () => {
    getStatus.mockResolvedValue({ ...OPEN, turnstile_site_key: "site-key" });
    render(<RequestSlip />);
    // the script is added by a passive effect that can run after the widget's container is on screen (the flake under
    // load, Task 9): wait for the script itself
    const script = await waitFor(() => {
      const el = document.head.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]');
      expect(el).not.toBeNull();
      return el!;
    });
    script.dispatchEvent(new Event("error"));
    expect(await screen.findByText(/โหลดระบบยืนยันว่าเป็นผู้ใช้จริงไม่ได้/)).toBeInTheDocument();
    script.remove();
  });

  it("names a momentary admission backlog honestly", async () => {
    createReview.mockRejectedValue(new ApiError(503, "too many submissions", 5, undefined, "busy"));
    render(<RequestSlip />);
    await typeTopic();
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("มีผู้ส่งพร้อมกันจำนวนมาก");
  });

  it("explains a rate limit with the wait time", async () => {
    createReview.mockRejectedValue(new ApiError(429, "rate limit exceeded", 1800));
    render(<RequestSlip />);
    await typeTopic();
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("30 นาที");
    expect(push).not.toHaveBeenCalled();
  });

  it("example topics fill the slip instead of navigating", async () => {
    render(<RequestSlip />);
    await user.click(screen.getByRole("button", { name: "SGLT2 inhibitors and heart failure" }));
    expect(screen.getByLabelText(/คำถามหรือวัตถุประสงค์/)).toHaveValue("SGLT2 inhibitors and heart failure");
  });

  it("starts with an empty topic and a placeholder example", () => {
    render(<RequestSlip />);
    const topic = screen.getByLabelText(/คำถามหรือวัตถุประสงค์/);
    expect(topic).toHaveValue("");
    expect(topic.tagName).toBe("TEXTAREA");
    expect(topic).toHaveAttribute("maxlength", "600");
    expect(topic.getAttribute("placeholder")).toContain("ต้องการทบทวนเรื่องใด");
  });

  it("pre-fills the topic from initialTopic", () => {
    render(<RequestSlip initialTopic="vitamin D and fractures" />);
    expect(screen.getByLabelText(/คำถามหรือวัตถุประสงค์/)).toHaveValue("vitamin D and fractures");
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
    await waitFor(() => expect(summary).toHaveTextContent("ภาษาไทย · วิเคราะห์ 30 ฉบับ · ทุกปี"));
    await user.click(screen.getByLabelText("English"));
    await user.type(screen.getByLabelText(/ตั้งแต่ปี/), "2015");
    expect(summary).toHaveTextContent("English · วิเคราะห์ 30 ฉบับ · ตั้งแต่ปี 2015");
  });

  it("shows the three numbered steps of the scope form", () => {
    render(<RequestSlip />);
    expect(screen.getByRole("form", { name: "กำหนดขอบเขตการทบทวน" })).toBeInTheDocument();
    expect(screen.getByLabelText(/รูปแบบการทบทวน/)).toHaveValue("slr");
    expect(screen.getByRole("group", { name: /หลักฐานและเกณฑ์คัดเลือก/ })).toBeInTheDocument();
    expect(screen.getByText(/ไม่เลือก = ไม่จำกัดชนิดงานวิจัย/)).toBeInTheDocument();
  });

  it("shows each study design as a tile: Thai name first, then the English term and its plain gloss", () => {
    render(<RequestSlip />);
    const group = screen.getByRole("group", { name: /หลักฐานและเกณฑ์คัดเลือก/ });
    // the name is short (Thai name + term); the plain words are the description, so tabbing stays quick
    const rct = within(group).getByRole("checkbox", { name: /RCT/ });
    expect(rct).toHaveAccessibleName("การทดลองแบบสุ่มและมีกลุ่มควบคุม RCT");
    expect(rct).toHaveAccessibleDescription(GLOSS.rct.plain?.th ?? "");
    expect(within(group).getByRole("checkbox", { name: "การศึกษาติดตามกลุ่มคน Cohort" })).toBeInTheDocument();
    expect(within(group).getByRole("checkbox", { name: "การสำรวจ ณ จุดเวลาเดียว Cross-sectional" }))
      .toHaveAccessibleDescription(GLOSS.crossSectional.plain?.th ?? "");
    expect(within(group).getByRole("checkbox", { name: "อื่น ๆ — ระบุ" })).toBeInTheDocument();
    expect(within(group).getAllByRole("checkbox")).toHaveLength(8); // seven designs plus "other"
  });

  it("marks the folded options as something that opens", () => {
    render(<RequestSlip />);
    const summary = screen.getByText("ตัวเลือกเพิ่มเติม").closest("summary") as HTMLElement;
    expect(summary.querySelector("[data-chevron][aria-hidden=true]")).not.toBeNull();
    expect(summary).toHaveTextContent("แก้ไข");
  });

  it("glosses PICO in the question hint and keeps the free, no-sign-up note in the submit row", () => {
    render(<RequestSlip />);
    expect(screen.getByText(/ลองคิดตาม/).textContent).toContain(glossText("pico"));
    const submit = screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ });
    expect(submit.closest("[data-testid=submit-row]")).toHaveTextContent("ฟรี · ไม่ต้องสมัคร");
  });

  it("sends the chosen review type", async () => {
    createReview.mockResolvedValue({ review_id: "r-4", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    await user.selectOptions(screen.getByLabelText(/รูปแบบการทบทวน/), "meta_analysis");
    expect(screen.getByText(/ตัวเลขรวมคำนวณโดยระบบ/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({
      options: { max_papers: 30, review_type: "meta_analysis" },
    }));
  });

  it("sends a free-text other study type, capped at 60 characters", async () => {
    createReview.mockResolvedValue({ review_id: "r-5", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    expect(screen.queryByLabelText("ระบุชนิดงานวิจัยอื่น")).toBeNull();
    await user.click(screen.getByLabelText(/อื่น ๆ — ระบุ/));
    const other = screen.getByLabelText("ระบุชนิดงานวิจัยอื่น");
    expect(other).toHaveAttribute("maxlength", "60");
    await user.type(other, "Delphi study");
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({
      options: { max_papers: 30, review_type: "slr", study_types: ["Other: Delphi study"] },
    }));
  });

  it("explains the limited support for qualitative and mixed-methods studies", async () => {
    render(<RequestSlip />);
    expect(screen.queryByText(/สรุปเป็นประเด็นจากบทคัดย่อ/)).toBeNull();
    await user.click(screen.getByLabelText(/Qualitative/));
    expect(screen.getByText(/สรุปเป็นประเด็นจากบทคัดย่อ ไม่มีค่าผลเชิงตัวเลข/)).toBeInTheDocument();
  });

  it("sends English study-type values although the labels are Thai", async () => {
    createReview.mockResolvedValue({ review_id: "r-3", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    await user.click(screen.getByLabelText(/Cohort/));
    await user.click(screen.getByLabelText(/การทดลองแบบไม่สุ่ม/));
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({
      options: { max_papers: 30, review_type: "slr", study_types: ["Cohort", "Non-randomized trial"] },
    }));
  });
});
