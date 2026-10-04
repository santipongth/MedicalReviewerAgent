import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./code-block";

describe("CodeBlock", () => {
  it("copies the code and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CodeBlock code="curl https://x" label="REST" />);
    await user.click(screen.getByRole("button", { name: /คัดลอก REST/ }));
    expect(writeText).toHaveBeenCalledWith("curl https://x");
    expect(await screen.findByText("คัดลอกแล้ว")).toBeInTheDocument();
  });

  it("selects the text when the clipboard is refused", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    render(<CodeBlock code="secret-free text" label="MCP" />);
    await user.click(screen.getByRole("button", { name: /คัดลอก MCP/ }));
    expect(await screen.findByText(/กด Ctrl\+C/)).toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe("secret-free text");
  });
});
