import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { graphemes, SpeechBubble, typeDuration } from "./speech-bubble";

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => reducedMotion.value,
}));

afterEach(() => { reducedMotion.value = false; });

const line = (c: HTMLElement) => c.querySelector("[data-line]")!;
const bubble = (c: HTMLElement) => c.querySelector("[data-bubble]")!;

describe("SpeechBubble", () => {
  it("splits Thai into grapheme clusters (a tone mark stays with its consonant)", () => {
    expect(graphemes("ที่")).toHaveLength(1);
    expect(graphemes("อ่าน")).toEqual(["อ่", "า", "น"]);
  });

  it("types a long line in under 1.1 s and a short one in at least 0.35 s", () => {
    expect(typeDuration(5)).toBe(0.35);
    expect(typeDuration(500)).toBe(1.1);
  });

  it("a bordered box with a tail, no shadow, and no live region", () => {
    const { container } = render(<SpeechBubble text="วางคำค้น 3 คำ" tone="speaking" tail="up" />);
    expect(bubble(container)).toHaveClass("border", "rounded-sm", "border-primary");
    expect(bubble(container).className).not.toMatch(/shadow/);
    expect(bubble(container).querySelector("svg[aria-hidden=true] path")).not.toBeNull(); // the tail
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector("[role=status]")).toBeNull();
    expect(line(container)).toHaveTextContent("วางคำค้น 3 คำ");
  });

  it("does not type on mount: the final text shows at once", () => {
    const { container } = render(<SpeechBubble text="พบ 87 รายการ" tone="working" tail="left" />);
    expect(bubble(container)).not.toHaveAttribute("data-typing");
    expect(line(container).className).toContain("group-data-[typing]/bubble:text-transparent");
  });

  it("types a live change while the full new text stays in the DOM, and marks the member card", () => {
    const { container, rerender } = render(<ul><li data-member="reader"><SpeechBubble text="a" tone="speaking" tail="up" /></li></ul>);
    rerender(<ul><li data-member="reader"><SpeechBubble text="อ่านเสร็จ 1 จาก 3 ฉบับ" tone="speaking" tail="up" /></li></ul>);
    expect(line(container)).toHaveTextContent("อ่านเสร็จ 1 จาก 3 ฉบับ"); // the final text is always in the DOM
    expect(bubble(container)).toHaveAttribute("data-typing");
    expect(container.querySelector("[data-member]")).toHaveAttribute("data-typing");
    expect(container.querySelector("[data-typed]")).toHaveAttribute("aria-hidden", "true");
  });

  it("clears the typing marks when the line changes again or the bubble unmounts", () => {
    const { container, rerender, unmount } = render(<ul><li data-member="planner"><SpeechBubble text="a" tone="speaking" tail="up" /></li></ul>);
    rerender(<ul><li data-member="planner"><SpeechBubble text="b" tone="speaking" tail="up" /></li></ul>);
    const card = container.querySelector("[data-member]")!;
    expect(card).toHaveAttribute("data-typing");
    act(() => unmount());
    expect(card).not.toHaveAttribute("data-typing");
  });

  it("never types under reduced motion", () => {
    reducedMotion.value = true;
    const { container, rerender } = render(<SpeechBubble text="a" tone="working" tail="up" />);
    rerender(<SpeechBubble text="b" tone="working" tail="up" />);
    expect(bubble(container)).not.toHaveAttribute("data-typing");
    expect(line(container)).toHaveTextContent("b");
  });

  it("tones: quiet is dashed and muted, alert uses the error tokens", () => {
    const q = render(<SpeechBubble text="x" tone="quiet" tail="up" />).container;
    expect(bubble(q)).toHaveClass("border-dashed");
    expect(q.querySelector("p")).toHaveClass("text-muted");
    const a = render(<SpeechBubble text="x" tone="alert" tail="up" />).container;
    expect(bubble(a)).toHaveClass("border-err", "bg-err-bg");
  });

  it("an up tail can sit under a given x instead of the centre", () => {
    const { container } = render(<SpeechBubble text="x" tone="working" tail="up" tailAt="38px" />);
    const tail = bubble(container).querySelector("svg") as SVGSVGElement;
    expect(tail.style.left).toMatch(/^calc\((38px - 7px|31px)\)$/); // the tip, not the tail's left edge, sits at 38px
  });
});
