import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EMPTY_MAP, evidenceMap } from "@/lib/evidence-map";
import { resultFixture } from "@/test/fixtures";
import { EvidenceMapSection } from "./evidence-map";

describe("EvidenceMapSection", () => {
  it("renders nothing for an empty map", () => {
    const { container } = render(<EvidenceMapSection map={EMPTY_MAP} lang="th" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("scrolls inside its own container with a sticky first column and scoped headers, counts as plain numbers", () => {
    const map = evidenceMap(resultFixture.papers!, resultFixture.synthesis!.comparison!, "th");
    render(<EvidenceMapSection map={map} lang="th" />);
    const table = screen.getByRole("table", { name: /ตามประเด็น/ });
    expect(table.parentElement).toHaveClass("overflow-x-auto");
    expect(table.parentElement).toHaveAttribute("role", "region");
    expect(within(table).getAllByRole("columnheader").every((h) => h.getAttribute("scope") === "col")).toBe(true);
    expect(within(table).getAllByRole("rowheader")[0]).toHaveClass("sticky");
    // Plan 20 Task 5: the total is the second column, rows by total (most first)
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)[1]).toBe("รวม");
    expect(within(table).getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["อุบัติการณ์มะเร็งลำไส้ใหญ่", "การเสียชีวิตจากมะเร็งลำไส้ใหญ่"]);
    const row = within(table).getByRole("row", { name: /การเสียชีวิต/ });
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["1", "1", "–", "–"]);
    // a one-hue ramp behind the counts, the number always printed
    expect(within(row).getAllByRole("cell")[0]).toHaveAttribute("data-ramp", "1"); // total 1 of the largest total 4
    expect(within(within(table).getByRole("row", { name: /อุบัติการณ์/ })).getAllByRole("cell")[0]).toHaveAttribute("data-ramp", "4");
    expect(screen.getByText(/ไม่รวม 1 ฉบับ/)).toBeInTheDocument();
    expect(document.querySelector(".num-verified")).toBeNull();
  });
});
