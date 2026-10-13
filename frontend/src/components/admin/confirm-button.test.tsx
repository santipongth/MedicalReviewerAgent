import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmButton } from "./confirm-button";

describe("ConfirmButton", () => {
  it("asks once inside the page, then runs the action", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={run} />);
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ยืนยันลบ" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันลบ" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it("backs out with ไม่ใช่", () => {
    const run = vi.fn();
    render(<ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={run} />);
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    fireEvent.click(screen.getByRole("button", { name: "ไม่ใช่" }));
    expect(screen.getByRole("button", { name: "ลบ" })).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it("gives keyboard focus back to the ask button after ไม่ใช่", () => {
    render(<ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ลบ" })).not.toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    fireEvent.click(screen.getByRole("button", { name: "ไม่ใช่" }));
    expect(screen.getByRole("button", { name: "ลบ" })).toHaveFocus();
  });

  it("gives focus back to the ask button after a confirm that leaves it on the page", async () => {
    render(<ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันลบ" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "ลบ" })).toHaveFocus());
  });

  it("shows its hint only while asking, as the description of the confirm button", () => {
    render(<ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" hint="ลบแล้วกู้คืนไม่ได้" onConfirm={vi.fn()} />);
    expect(screen.queryByText("ลบแล้วกู้คืนไม่ได้")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    expect(screen.getByText("ลบแล้วกู้คืนไม่ได้")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยืนยันลบ" })).toHaveAccessibleDescription("ลบแล้วกู้คืนไม่ได้");
    fireEvent.click(screen.getByRole("button", { name: "ไม่ใช่" }));
    expect(screen.queryByText("ลบแล้วกู้คืนไม่ได้")).not.toBeInTheDocument();
  });

  it("keeps the confirm button disabled while the control is disabled, and does not close the ask", () => {
    const run = vi.fn();
    const { rerender } = render(<ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={run} />);
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    rerender(<ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={run} disabled />);
    expect(screen.getByRole("button", { name: "ยืนยันลบ" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันลบ" }));
    expect(run).not.toHaveBeenCalled();
    rerender(<ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={run} />);
    expect(screen.getByRole("button", { name: "ยืนยันลบ" })).toBeEnabled();
  });

  it("has no description without a hint", () => {
    render(<ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    expect(screen.getByRole("button", { name: "ยืนยันลบ" })).not.toHaveAttribute("aria-describedby");
  });
});
