import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { initialRun, reduceRun } from "@/lib/progress";
import { EMERGENCY_COPY, PERSONAL_MEDICAL_COPY } from "@/lib/refusal-copy";
import { STATUS_FIXTURE } from "@/test/status-fixture";
import { TerminalState } from "../review/terminal-state";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const createReview = vi.fn();
const getStatus = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()),
  createReview: (...a: unknown[]) => createReview(...a), getStatus: (...a: unknown[]) => getStatus(...a) }));

import { RequestSlip } from "./request-slip";

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup({ delay: null });
  push.mockReset();
  createReview.mockReset();
  getStatus.mockReset();
  getStatus.mockResolvedValue(STATUS_FIXTURE);
  localStorage.clear();
});
afterEach(() => localStorage.clear());

async function submit(topic: string) {
  await user.click(screen.getByLabelText(/คำถามหรือวัตถุประสงค์/));
  await user.paste(topic);
  await user.click(screen.getByRole("button", { name: "ส่งให้เอเจนต์ทบทวน" }));
}

const refused = (kind: string, hotlines: string[]) =>
  new ApiError(422, "This may be an emergency.", undefined, undefined, undefined, { code: "emergency", kind, hotlines });

describe("Plan 26: an emergency topic gets the numbers to call, not a review", () => {
  it("shows the emergency copy and a call link to 1669", async () => {
    createReview.mockRejectedValue(refused("medical", ["1669"]));
    render(<RequestSlip />);
    await submit("my father cannot breathe");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-emergency", "medical");
    expect(alert).toHaveTextContent(EMERGENCY_COPY.medical.title);
    expect(alert).toHaveTextContent(EMERGENCY_COPY.medical.body);
    expect(screen.getByRole("link", { name: "โทร 1669 บริการการแพทย์ฉุกเฉิน" })).toHaveAttribute("href", "tel:1669");
    expect(alert).not.toHaveTextContent("father");
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText(/ตรวจหัวข้ออีกครั้ง/)).toBeNull();
  });

  it("self-harm offers the mental health hotline first", async () => {
    createReview.mockRejectedValue(refused("self_harm", ["1323", "1669"]));
    render(<RequestSlip />);
    await submit("I want to kill myself");
    await screen.findByRole("alert");
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("tel:"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["tel:1323", "tel:1669"]);
    expect(screen.getByRole("alert")).toHaveTextContent(EMERGENCY_COPY.self_harm.body);
  });

  it("offers the numbers the server sent, in its order, and falls back to the built-in list when it sent none", async () => {
    createReview.mockRejectedValueOnce(refused("medical", ["1323", "1669"]));
    const first = render(<RequestSlip />);
    await submit("urgent topic");
    await screen.findByRole("alert");
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("tel:")).map((a) => a.getAttribute("href")))
      .toEqual(["tel:1323", "tel:1669"]);
    first.unmount();

    createReview.mockRejectedValueOnce(refused("self_harm", []));
    render(<RequestSlip />);
    await submit("urgent topic");
    await screen.findByRole("alert");
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("tel:")).map((a) => a.getAttribute("href")))
      .toEqual(["tel:1323", "tel:1669"]);
  });

  it("a plain validation error is still an error line", async () => {
    createReview.mockRejectedValue(new ApiError(422, "topic too short"));
    render(<RequestSlip />);
    await submit("abc def");
    expect(await screen.findByRole("alert")).toHaveTextContent("ตรวจหัวข้ออีกครั้ง: topic too short");
    expect(document.querySelector("[data-emergency]")).toBeNull();
  });
});

describe("Plan 26: the form remembers who the report is for", () => {
  it("defaults to the public, stores the choice on submit and never sends it", async () => {
    createReview.mockResolvedValue({ review_id: "r-1", status: "queued", cached: false });
    render(<RequestSlip />);
    expect(screen.getByRole("radio", { name: "ประชาชนทั่วไป" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "แพทย์ข้างเตียง" }));
    await submit("statins and dementia");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/r/r-1"));
    expect(localStorage.getItem("mra.audience")).toBe("bedside");
    expect(JSON.stringify(createReview.mock.calls[0][0])).not.toContain("bedside");
  });

  it("starts from the stored choice", () => {
    localStorage.setItem("mra.audience", "committee");
    render(<RequestSlip />);
    expect(screen.getByRole("radio", { name: "คณะกรรมการยาและ HTA" })).toBeChecked();
  });
});

describe("Plan 26: a personal medical question", () => {
  it("gets the fixed, kind message: no topic, no model reason, no resend link", () => {
    render(<TerminalState status="rejected" code="personal_medical" topic="แม่ผมควรกินยาอะไร"
      message="personal_medical: This service summarises research about groups of people." />);
    expect(screen.getByRole("heading")).toHaveTextContent(PERSONAL_MEDICAL_COPY.title);
    expect(screen.getByText(PERSONAL_MEDICAL_COPY.body)).toBeInTheDocument();
    expect(screen.queryByText(/แม่ผม/)).toBeNull();
    expect(screen.queryByText(/This service/)).toBeNull();
    expect(screen.queryByRole("link", { name: "แก้หัวข้อแล้วส่งใหม่" })).toBeNull();
    expect(screen.getByRole("link", { name: "โทร 1669 บริการการแพทย์ฉุกเฉิน" })).toHaveAttribute("href", "tel:1669");
    expect(screen.getByRole("link", { name: "โทร 1323 สายด่วนสุขภาพจิต" })).toHaveAttribute("href", "tel:1323");
    expect(screen.getByRole("link", { name: "ถามคำถามใหม่" })).toHaveAttribute("href", "/");
  });

  it("is recognised from the stored error when the code is missing", () => {
    render(<TerminalState status="rejected" topic="t" message="personal_medical: This service summarises research." />);
    expect(screen.getByRole("heading")).toHaveTextContent(PERSONAL_MEDICAL_COPY.title);
  });

  it("other rejections keep today's view", () => {
    render(<TerminalState status="rejected" code="declined" topic="pizza" message="not medical" />);
    expect(screen.getByRole("heading")).toHaveTextContent(/ไม่ใช่คำถามวิจัยทางการแพทย์/);
  });

  it("the rejected event carries the code into the run state", () => {
    const run = reduceRun(initialRun(), { seq: 1, type: "rejected", payload: { reason: "personal_medical: x", code: "personal_medical" } });
    expect(run).toMatchObject({ status: "rejected", code: "personal_medical", terminal: true });
  });
});

describe("Plan 26: the API client reads a refusal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the code, kind and hotlines of a 422 refusal", async () => {
    const { createReview: realCreate } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "This may be an emergency.",
      code: "emergency", kind: "self_harm", hotlines: ["1323", "1669", 5], message_th: "x" }), { status: 422 })));
    const err = await realCreate({ topic: "x y z", language: "th" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.refusal).toEqual({ code: "emergency", kind: "self_harm", hotlines: ["1323", "1669"] });
    expect(err.message).toBe("This may be an emergency.");
  });
});
