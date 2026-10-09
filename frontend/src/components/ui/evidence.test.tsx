import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { Glyph, Hole, UncertainFlag, VerifiedNumber } from "./evidence";

describe("evidence primitives", () => {
  it("VerifiedNumber uses the verified style and is a button when clickable", () => {
    render(<VerifiedNumber value="HR 0.80" onSelect={() => {}} title="Show source sentence" />);
    const el = screen.getByRole("button", { name: /HR 0.80/ });
    expect(el).toHaveClass("num-verified");
    expect(el).not.toHaveAttribute("data-pending");
  });

  it("a pending VerifiedNumber has no tape yet", () => {
    render(<VerifiedNumber value="0.80" pending />);
    expect(screen.getByText("0.80")).toHaveAttribute("data-pending", "true");
  });

  it("Hole always says not verified in the chosen language", () => {
    const { rerender } = render(<Hole lang="th" />);
    expect(screen.getByText("ไม่ยืนยัน")).toHaveClass("hole");
    rerender(<Hole lang="en" />);
    expect(screen.getByText("not verified")).toBeInTheDocument();
  });

  it("Glyph has an accessible name for every direction", () => {
    for (const d of ["positive", "negative", "null", "mixed", "unclear"] as const) {
      const { unmount } = render(<Glyph direction={d} lang="en" />);
      expect(screen.getByRole("img")).toHaveAccessibleName();
      unmount();
    }
    render(<Glyph direction="negative" lang="th" />);
    expect(screen.getByRole("img", { name: "ตรงข้าม/อันตราย" })).toBeInTheDocument();
  });

  it("Hole without explain has no Term; with explain it shows one outside the slot", async () => {
    const { container, rerender } = render(<Hole lang="th" />);
    expect(container.innerHTML).toBe('<span class="hole ">ไม่ยืนยัน</span>');
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<Hole lang="th" explain />);
    expect(container.querySelectorAll(".hole")).toHaveLength(1);
    const btn = screen.getByRole("button", { name: "ทำไม?" });
    expect(container.querySelector(".hole")).not.toContainElement(btn);
    await userEvent.click(btn);
    expect(screen.getByRole("note")).toHaveTextContent("ตรวจกับต้นฉบับไม่ผ่าน");
  });

  it("UncertainFlag renders its default and custom label", () => {
    const { rerender } = render(<UncertainFlag />);
    expect(screen.getByText("สองโมเดลอ่านต่างกัน")).toBeInTheDocument();
    rerender(<UncertainFlag lang="en" />);
    expect(screen.getByText("models disagree")).toBeInTheDocument();
    rerender(<UncertainFlag label="custom" />);
    expect(screen.getByText("custom")).toBeInTheDocument();
  });
});
