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
    expect(within(table).getAllByRole("columnheader").every((h) => h.getAttribute("scope") === "col")).toBe(true);
    expect(within(table).getAllByRole("rowheader")[0]).toHaveClass("sticky");
    const row = within(table).getByRole("row", { name: /การเสียชีวิต/ });
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["1", "–", "–", "1"]);
    expect(screen.getByText(/ไม่รวม 1 ฉบับ/)).toBeInTheDocument();
    expect(document.querySelector(".num-verified")).toBeNull();
  });
});
