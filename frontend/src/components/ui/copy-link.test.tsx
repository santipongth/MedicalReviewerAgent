import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CopyLinkButton } from "./copy-link";

function mockClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("CopyLinkButton", () => {
  it("writes the URL and announces it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<CopyLinkButton />);
    await userEvent.click(screen.getByRole("button", { name: "คัดลอกลิงก์" }));
    expect(writeText).toHaveBeenCalledWith(location.href);
    expect(await screen.findByText("คัดลอกแล้ว")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("คัดลอกแล้ว");
  });

  it("falls back to a read-only input when the clipboard fails", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<CopyLinkButton />);
    await userEvent.click(screen.getByRole("button", { name: "คัดลอกลิงก์" }));
    const input = await screen.findByRole("textbox");
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveValue(location.href);
  });
});
