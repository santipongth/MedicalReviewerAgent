import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listRecent = vi.fn();
const getReview = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  listRecent: (...a: unknown[]) => listRecent(...a),
  getReview: (...a: unknown[]) => getReview(...a),
}));

import { ReceiptPanel } from "./receipt-panel";

const quote = "Metformin use was associated with a lower risk of colorectal cancer (HR 0.80, 95% CI 0.71–0.90).";

beforeEach(() => {
  listRecent.mockReset();
  getReview.mockReset();
});

describe("ReceiptPanel", () => {
  it("shows a verified number from the newest review with its verbatim quote and the recent list", async () => {
    listRecent.mockResolvedValue([
      { id: "a", topic: "เมตฟอร์มินกับมะเร็งลำไส้ใหญ่", language: "th", status: "done", created_at: "", finished_at: "",
        verification_rate: 0.96 },
      { id: "b", topic: "Vitamin D and fractures", language: "en", status: "done", created_at: "", finished_at: "",
        verification_rate: null },
    ]);
    getReview.mockResolvedValue({
      id: "a", result: { papers: [{ ref: "P3", title: "Metformin and CRC", card: {
        study_design: "cohort", population: "adults", intervention_or_exposure: "metformin", key_findings: [],
        limitations: [], risk_of_bias: "low", overall_direction: "positive", sample_size: 1234,
        sample_size_quote: "We enrolled 1,234 adults",
        outcomes: [{ outcome: "CRC", result: "lower", evidence_quote: quote, effect_measure: "HR", effect_value: 0.8,
          direction: "positive" }] } }] },
    });
    render(<ReceiptPanel />);
    expect(await screen.findByText("HR 0.80")).toHaveClass("num-verified");
    expect(screen.getByText(/lower risk of colorectal cancer/)).toBeInTheDocument();
    expect(screen.getByText("0.80", { selector: "mark" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /เมตฟอร์มินกับมะเร็งลำไส้ใหญ่/ })).toHaveAttribute("href", "/r/a");
    expect(screen.getByText("96%")).toHaveClass("num-verified");
  });

  it("explains verification when there are no public reviews yet", async () => {
    listRecent.mockResolvedValue([]);
    render(<ReceiptPanel />);
    expect(await screen.findByText(/ยังไม่มีรีวิวสาธารณะ/)).toBeInTheDocument();
    expect(getReview).not.toHaveBeenCalled();
  });

  it("stays usable when the API is unreachable", async () => {
    listRecent.mockRejectedValue(new Error("down"));
    render(<ReceiptPanel />);
    expect(await screen.findByText(/ยังไม่มีรีวิวสาธารณะ/)).toBeInTheDocument();
  });
});
