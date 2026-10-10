import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Intro, WhatItIs } from "./intro";

describe("WhatItIs (hero)", () => {
  it("says in plain words what the system is", () => {
    render(<WhatItIs />);
    expect(screen.getByRole("heading", { name: "ระบบนี้คืออะไร" })).toBeInTheDocument();
    const text = screen.getByTestId("what-it-is").textContent ?? "";
    expect(text).toContain("ผู้ช่วย AI");
    expect(text).toContain("บทคัดย่อ (ย่อหน้าสรุปสั้น ๆ");
    // the arrow is decoration: the link's name is the words only
    expect(screen.getByRole("link", { name: "ดูว่าระบบทำอะไรให้บ้าง" })).toHaveAttribute("href", "#intro");
  });
});

describe("Intro", () => {
  it("uses the scope form's name for a systematic review", () => {
    const { container } = render(<Intro />);
    expect(container.textContent).toContain("การทบทวนวรรณกรรมอย่างเป็นระบบ");
    expect(container.textContent).not.toMatch(/(?<!วรรณกรรม)อย่างเป็นระบบ/);
  });

  it("walks through the five steps the engine really takes, in order", () => {
    render(<Intro />);
    const steps = within(screen.getByRole("list", { name: "ระบบทำอะไรให้บ้าง" })).getAllByRole("listitem");
    expect(steps.map((s) => s.querySelector("h4")?.textContent)).toEqual(
      ["ค้น", "คัดกรอง", "อ่านและตรวจตัวเลข", "สรุปและบอกระดับความน่าเชื่อถือ", "ออกรายงาน"]);
  });

  it("lists the benefits, including where every number comes from", () => {
    render(<Intro />);
    const benefits = within(screen.getByRole("list", { name: "มีประโยชน์อย่างไร" })).getAllByRole("listitem");
    expect(benefits.length).toBeGreaterThanOrEqual(4);
    // only numbers taken from papers are checked against the abstract; pooled values are computed and labelled
    const numbers = screen.getByText(/ตัวเลขทุกตัวที่ยกมาจากงานวิจัยตรวจกับบทคัดย่อต้นฉบับแล้ว/);
    expect(numbers).toHaveTextContent("ค่ารวมที่ระบบคำนวณเองมีป้ายบอกชัด");
    expect(screen.queryByText(/ตัวเลขทุกตัวตรวจกับบทคัดย่อ/)).toBeNull();
  });

  it("states the limits honestly: abstracts only, automated, never a substitute for a doctor", () => {
    render(<Intro />);
    const note = screen.getByTestId("intro-limits");
    expect(note).toHaveTextContent("อ่านเฉพาะบทคัดย่อ");
    expect(note).toHaveTextContent("ใช้แทนแพทย์หรือผู้เชี่ยวชาญไม่ได้");
  });

  it("never claims full-text reading and never hard-codes a service limit", () => {
    const { container } = render(<Intro />);
    const text = container.textContent ?? "";
    for (const m of text.matchAll(/ฉบับเต็ม/g)) expect(text.slice(Math.max(0, m.index - 24), m.index)).toMatch(/ไม่/);
    expect(text).not.toMatch(/\b(30|60|100)\b/); // paper counts and rate limits come from GET /api/v1/status
  });

  it("explains the report's jargon in a disclosure that opens on click or keyboard, never on hover", async () => {
    render(<Intro />);
    const summary = screen.getByText(/คำที่จะเจอในรายงาน/);
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    // a visible open/close marker (the flex summary has no native triangle), hidden from screen readers
    expect(details.querySelector("summary [data-chevron][aria-hidden=true]")).not.toBeNull();
    await userEvent.click(summary);
    expect(details.open).toBe(true);
    const terms = within(details).getAllByRole("term").map((t) => t.textContent);
    for (const t of ["PICO", "PRISMA", "GRADE", "HR / RR / OR", "95% CI", "I²"]) expect(terms).toContain(t);
    expect(within(details).getByText(/ช่วงที่ค่าจริงน่าจะอยู่/)).toBeInTheDocument();
  });
});
