import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Glyph, Hole, VerifiedNumber } from "./evidence";

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
});
