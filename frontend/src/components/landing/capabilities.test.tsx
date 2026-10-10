import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
