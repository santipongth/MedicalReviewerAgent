import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()),
  getStatus: async () => ({ accepting: true, reason: null, retry_after: null, queue_depth: 2, running: 4, reviews_today: 9,
    turnstile_site_key: null, limits: { review_rate_limit: "7/hour", api_key_rate_limit: "90/hour",
      paper_search_rate_limit: "30/minute", max_papers: { min: 5, max: 50, default: 30 },
      candidate_limit: { min: 20, max: 120, default: 120 }, max_queued_reviews: 50, sse_max_per_ip: 4 } }) }));

import { LiveLimits } from "./live-limits";

describe("LiveLimits", () => {
  it("shows the limits the running service reports", async () => {
    render(<LiveLimits />);
    expect(await screen.findByText(/7 รีวิวต่อชั่วโมง/)).toBeInTheDocument();
    expect(screen.getByText(/90 รีวิวต่อชั่วโมง/)).toBeInTheDocument();
    expect(screen.getByText(/5–50 ฉบับ \(ค่าเริ่มต้น 30\) จากผู้สมัคร 20–120 ฉบับ \(ค่าเริ่มต้น 120\)/)).toBeInTheDocument();
    expect(screen.getByText(/คิวรอ 2/)).toBeInTheDocument();
    expect(screen.getByText(/สตรีมสดพร้อมกันได้ 4/)).toBeInTheDocument();
  });
});
