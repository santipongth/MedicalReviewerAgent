import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GLOSS, glossText } from "@/lib/glossary";
import { Capabilities } from "./capabilities";

describe("Capabilities", () => {
  it("lists the four review types, the report views and the eight sources", () => {
    render(<Capabilities />);
    expect(screen.getByRole("heading", { name: "รีวิวได้ 4 แบบ รายงานมีอะไรบ้าง" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "รูปแบบการทบทวนที่มี" }).querySelectorAll("li")).toHaveLength(4);
    expect(screen.getByRole("list", { name: "แหล่งข้อมูลที่ค้น" }).querySelectorAll("li")).toHaveLength(8);
    expect(screen.getByText("เครือข่ายการอ้างอิง")).toBeInTheDocument();
    expect(screen.getByText("ตารางงานวิจัย")).toBeInTheDocument();
  });

  it("explains each review type in plain Thai and glosses the jargon in brackets", () => {
    const { container } = render(<Capabilities />);
    const types = screen.getByRole("list", { name: "รูปแบบการทบทวนที่มี" });
    for (const k of ["slr", "metaAnalysis", "scopingReview", "narrativeReview"] as const) {
      expect(types).toHaveTextContent(GLOSS[k].plain?.th ?? "");
    }
    const text = container.textContent ?? "";
    for (const k of ["prisma", "forestPlot", "litMatrix", "randomEffects", "searxng", "doiPmid"] as const) {
      expect(text).toContain(glossText(k));
    }
  });
});
