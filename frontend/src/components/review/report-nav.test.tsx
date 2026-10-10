import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportNav, ReportToc, SectionHeading, Subsections } from "./report-nav";

const ITEMS = [{ id: "h-answer", label: "คำตอบ" }, { id: "h-results", label: "ผลลัพธ์" }];

describe("report navigation", () => {
  it("the table of contents is an ordered list of short links, hidden below xl", () => {
    render(<ReportToc items={ITEMS} label="สารบัญ" />);
    const toc = screen.getByRole("navigation", { name: "สารบัญ" });
    expect(toc).toHaveClass("hidden", "xl:block");
    expect(within(toc).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["คำตอบ", "#h-answer"], ["ผลลัพธ์", "#h-results"]]);
    expect(toc.querySelector("ol")).not.toBeNull();
  });

  it("the top nav is hidden from xl (the table of contents takes over) and fades its scrolled edge", () => {
    render(<ReportNav items={ITEMS} label="ในรายงานนี้" />);
    const nav = screen.getByRole("navigation", { name: "ในรายงานนี้" });
    expect(nav).toHaveClass("xl:hidden");
    expect(nav.querySelector("ul")).toHaveClass("nav-fade", "overflow-x-auto");
  });

  it("no items: no nav at all", () => {
    const { container } = render(<><ReportToc items={[]} /><ReportNav items={[]} /></>);
    expect(container).toBeEmptyDOMElement();
  });

  it("a block heading is an H2 on its own and an H3 inside a group section", () => {
    render(<>
      <SectionHeading id="h-a">A</SectionHeading>
      <Subsections><SectionHeading id="h-b">B</SectionHeading></Subsections>
    </>);
    expect(screen.getByRole("heading", { level: 2, name: "A" })).toHaveAttribute("id", "h-a");
    expect(screen.getByRole("heading", { level: 3, name: "B" })).toHaveAttribute("id", "h-b");
  });
});
