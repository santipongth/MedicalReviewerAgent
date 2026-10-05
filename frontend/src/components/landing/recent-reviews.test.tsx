import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listRecent = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  listRecent: (...a: unknown[]) => listRecent(...a),
}));

import { RecentReviews } from "./recent-reviews";

const now = new Date().toISOString();

// Braces matter: a function returned from beforeEach becomes a cleanup hook, and mockReset returns the mock.
beforeEach(() => {
  listRecent.mockReset();
});

describe("RecentReviews", () => {
  it("lists finished public reviews with their verified share, each linking to its report", async () => {
    listRecent.mockResolvedValue([
      { id: "a1", topic: "เมตฟอร์มินกับมะเร็งลำไส้ใหญ่", language: "th", status: "done", created_at: now, finished_at: now, verification_rate: 0.96 },
      { id: "b2", topic: "Vitamin D and fractures", language: "en", status: "done", created_at: now, finished_at: now, verification_rate: null },
      { id: "c3", topic: "still running", language: "en", status: "running", created_at: now, finished_at: null },
    ]);
    render(<RecentReviews />);
    const first = await screen.findByRole("link", { name: /เมตฟอร์มินกับมะเร็งลำไส้ใหญ่/ });
    expect(first).toHaveAttribute("href", "/r/a1");
    expect(first).toHaveTextContent("96%");
    expect(screen.getByRole("link", { name: /Vitamin D and fractures/ })).toHaveTextContent("–");
    expect(screen.queryByText("still running")).toBeNull();
  });

  it("says so calmly when the list cannot be loaded", async () => {
    listRecent.mockRejectedValue(new Error("down"));
    render(<RecentReviews />);
    expect(await screen.findByText(/โหลดรายการไม่ได้ตอนนี้/)).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("has an empty state", async () => {
    listRecent.mockResolvedValue([]);
    render(<RecentReviews />);
    expect(await screen.findByText(/ยังไม่มีรีวิวสาธารณะที่เสร็จแล้ว/)).toBeInTheDocument();
  });
});
