import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const createReview = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), createReview: (...a: unknown[]) => createReview(...a) }));

import { RequestSlip } from "./request-slip";

beforeEach(() => {
  push.mockReset();
  createReview.mockReset();
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
