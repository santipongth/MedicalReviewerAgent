import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { GLOSS, glossText } from "@/lib/glossary";
import type { ReviewType } from "@/lib/types";
import { ReviewTypePicker } from "./review-type-picker";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Harness({ available }: { available?: string[] }) {
  const [v, setV] = useState<ReviewType>("slr");
  return (
    <>
      <label htmlFor="t">รูปแบบการทบทวน</label>
      <ReviewTypePicker id="t" value={v} onChange={setV} available={available} />
      <output data-testid="v">{v}</output>
    </>
  );
}

describe("ReviewTypePicker", () => {
  it("is a select with the four types, systematic first and selected by default", () => {
    render(<Harness />);
    const select = screen.getByLabelText("รูปแบบการทบทวน");
    expect(select).toHaveValue("slr");
    const options = screen.getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toEqual(["slr", "meta_analysis", "scoping", "narrative"]);
    expect(screen.getByRole("option", { name: "การวิเคราะห์อภิมาน (Meta-analysis)" })).toBeInTheDocument();
  });
  it("shows the chosen type's description under the select", async () => {
    render(<Harness />);
    const select = screen.getByLabelText("รูปแบบการทบทวน");
    // plain words first, then the method with PRISMA glossed
    expect(select).toHaveAccessibleDescription(new RegExp(`^${GLOSS.slr.plain?.th}`));
    expect(select).toHaveAccessibleDescription(new RegExp(escape(glossText("prisma"))));
    await userEvent.selectOptions(select, "scoping");
    expect(screen.getByTestId("v")).toHaveTextContent("scoping");
    expect(select).toHaveAccessibleDescription(new RegExp(`^${GLOSS.scopingReview.plain?.th}`));
    expect(select).toHaveAccessibleDescription(new RegExp(escape(glossText("pcc"))));
    expect(select).toHaveAccessibleDescription(/ไม่ประเมินคุณภาพ/);
  });
  it("limits the options to what the service offers, ignoring unknown values", () => {
    render(<Harness available={["slr", "scoping", "future"]} />);
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
  it("falls back to the static four when the list is empty or missing", () => {
    render(<Harness available={[]} />);
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });
});
