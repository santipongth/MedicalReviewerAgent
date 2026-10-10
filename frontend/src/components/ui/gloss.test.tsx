import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GLOSS } from "@/lib/glossary";
import { Gloss } from "./gloss";

describe("Gloss", () => {
  it("renders the term with its plain Thai meaning in brackets, as text (no hover, nothing to open)", () => {
    const { container } = render(<p><Gloss k="rct" /></p>);
    expect(container.textContent).toBe(`RCT (${GLOSS.rct.name.th})`);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("keeps the short term on one line so Thai or English words are never split", () => {
    render(<Gloss k="ci95" />);
    expect(screen.getByText("95% CI")).toHaveClass("nw");
  });

  it("adds the plain-words explanation when full", () => {
    const { container } = render(<Gloss k="metaAnalysis" full />);
    expect(container.textContent).toBe("Meta-analysis (การวิเคราะห์อภิมาน — นำตัวเลขจากหลายงานวิจัยมารวมเป็นผลเดียว)");
  });

  it("can qualify the meaning for this page (GRADE-lite is a simplified GRADE)", () => {
    const { container } = render(<Gloss k="grade" suffix="แบบย่อ">GRADE-lite</Gloss>);
    expect(container.textContent).toBe(`GRADE-lite (${GLOSS.grade.name.th} แบบย่อ)`);
  });

  it("shows the English term with an English gloss in English mode", () => {
    const { container } = render(<Gloss k="rct" lang="en" />);
    expect(container.textContent).toBe("RCT (randomised controlled trial)");
  });

  it("lets the page word the term itself", () => {
    const { container } = render(<Gloss k="grade">GRADE-lite</Gloss>);
    expect(container.textContent).toBe(`GRADE-lite (${GLOSS.grade.name.th})`);
  });
});
