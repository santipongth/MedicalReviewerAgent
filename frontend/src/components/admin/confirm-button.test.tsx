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
});
