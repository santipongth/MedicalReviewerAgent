import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TraceRow } from "@/lib/agent-scene";
import { nearBottom, TraceLog } from "./trace-log";

const rows: TraceRow[] = [
  { key: 1, type: "started", text: "เริ่มงาน", elapsed: 0.4, repeat: 1 },
  { key: 2, type: "extracted", text: "อ่านบทความ", elapsed: 75, repeat: 6 },
];

describe("TraceLog", () => {
  it("renders elapsed, type and merged repeat count", () => {
    render(<TraceLog rows={rows} />);
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(screen.getByText("1:15")).toBeInTheDocument();
    expect(screen.getByText("[extracted]")).toBeInTheDocument();
    expect(screen.getByText(/×6/)).toBeInTheDocument();
    expect(screen.queryByText(/×1\b/)).toBeNull();
  });

  it("is a named focusable scroll region and not live", () => {
    const { container } = render(<TraceLog rows={rows} />);
    const box = screen.getByRole("region", { name: "บันทึกการทำงาน" }).querySelector("div")!;
    expect(box).toHaveAttribute("tabindex", "0");
    expect(box).toHaveAttribute("aria-labelledby", "h-trace");
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("nearBottom is true only within the slack", () => {
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 288 })).toBe(true);
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 288 })).toBe(false);
  });

  it("keeps following while the reader stays at the bottom, and stops after they scroll up", () => {
    const geom = { scrollHeight: 500, clientHeight: 288 };
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => geom.scrollHeight });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => geom.clientHeight });
    try {
      const mk = (n: number): TraceRow[] => Array.from({ length: n }, (_, i) => ({ key: i, type: "extracted", text: "t", elapsed: i, repeat: 1 }));
      const { rerender } = render(<TraceLog rows={mk(3)} />);
      const box = screen.getByRole("region", { name: "บันทึกการทำงาน" }).querySelector("div")!;
      for (let n = 4; n < 8; n++) {
        geom.scrollHeight += 100;
        fireEvent.scroll(box); // content grew mid-scroll: distance > slack, but not a user scroll up
        rerender(<TraceLog rows={mk(n)} />);
        expect(box.scrollTop).toBe(geom.scrollHeight);
      }
      box.scrollTop = 0;
      fireEvent.scroll(box);
      geom.scrollHeight += 100;
      rerender(<TraceLog rows={mk(9)} />);
      expect(box.scrollTop).toBe(0);
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
  });
});
