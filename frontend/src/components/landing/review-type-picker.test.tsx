import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { ReviewType } from "@/lib/types";
import { ReviewTypePicker } from "./review-type-picker";

function Harness({ available }: { available?: string[] }) {
  const [v, setV] = useState<ReviewType>("slr");
  return (<><ReviewTypePicker value={v} onChange={setV} available={available} /><output data-testid="v">{v}</output></>);
}

describe("ReviewTypePicker", () => {
  it("is a visible fieldset with the three types, SLR selected by default", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "รูปแบบการทบทวน" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /การทบทวนวรรณกรรมอย่างเป็นระบบ/ })).toBeChecked();
  });
  it("renders each description", () => {
    render(<Harness />);
    expect(screen.getByText(/ด้วยกรอบ PCC ไม่ประเมินคุณภาพ/)).toBeInTheDocument();
    expect(screen.getByText(/รายงานขั้นตอนแบบ PRISMA/)).toBeInTheDocument();
    expect(screen.getByText(/เหมาะกับการทำความเข้าใจหัวข้ออย่างรวดเร็ว/)).toBeInTheDocument();
  });
  it("reports the chosen type", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("radio", { name: /การทบทวนขอบเขต/ }));
    expect(screen.getByTestId("v")).toHaveTextContent("scoping");
  });
  it("limits the options to what the service offers, ignoring unknown values", () => {
    render(<Harness available={["slr", "scoping", "future"]} />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("radio", { name: /แบบบรรยาย/ })).toBeNull();
  });
  it("falls back to the static three when the list is empty or missing", () => {
    render(<Harness available={[]} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
});
