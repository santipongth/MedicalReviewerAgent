import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metaP20ReviewFixture, P20_FIXTURES_EN, resultFixture, slrP20ReviewFixture } from "@/test/fixtures";
import type { Review } from "@/lib/types";

vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { stubViewport } from "@/test/viewport";
import { Hole } from "../ui/evidence";
import { Report } from "./report";

// Full <Report> renders take about 1 s alone and passed 5 s when three suites shared the CPU (Task 9 stress runs):
// a hang guard for this file only, not a timing assertion.
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  document.documentElement.lang = "th";
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

const fire = (type: "beforeprint" | "afterprint") => act(() => { window.dispatchEvent(new Event(type)); });

/** 32 records, so the literature matrix has three pages. */
const many: Review = {
  ...slrP20ReviewFixture,
  result: {
    ...slrP20ReviewFixture.result!,
    papers: Array.from({ length: 32 }, (_, i) => ({ ...resultFixture.papers![2], ref: `P${i + 1}`, title: `Study ${i + 1}` })),
  },
};

describe("verified-numbers appendix (Plan 20 Task 8)", () => {
  it("closes the report: a collapsed disclosure listing each verified number with its study, outcome and source sentence", () => {
    stubViewport(true);
    render(<Report review={slrP20ReviewFixture} />);
    const section = screen.getByRole("region", { name: "ภาคผนวก: ตัวเลขที่ตรวจแล้ว" });
    const details = section.querySelector("details")!;
    expect(details.open).toBe(false);
    const table = within(section).getByRole("table", { name: "ตัวเลขจากงานวิจัยที่ตรวจกับบทคัดย่อแล้ว" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["งานวิจัย", "ผลลัพธ์", "ตัวเลข", "ประโยคต้นฉบับ (บทคัดย่อ)"]);
    const p3 = within(table).getAllByRole("row").find((r) => r.textContent?.includes("HR 0.80"))!;
    expect(within(p3).getByRole("rowheader")).toHaveTextContent("P3");
    expect(Array.from(p3.querySelectorAll(".num-verified")).map((e) => e.textContent)).toEqual(["HR 0.80", "0.71–0.90"]);
    expect(p3).toHaveTextContent("Metformin use was associated with a lower risk of colorectal cancer");
    expect(p3.querySelector("mark")).toHaveTextContent("0.80");
    // the appendix is the last section and the table of contents lists it
    expect(within(screen.getByRole("navigation", { name: "สารบัญ" })).getByRole("link", { name: "ภาคผนวก" })).toHaveAttribute("href", "#h-appendix");
    // a blanked value is never listed
    expect(within(table).queryByText("P2")).toBeNull();
    // no pooled numbers in an SLR
    expect(within(section).queryByRole("table", { name: /คำนวณ/ })).toBeNull();
  });

  it("a meta-analysis lists the computed numbers separately, through ComputedNumber, with k and the studies", () => {
    stubViewport(true);
    render(<Report review={metaP20ReviewFixture} />);
    const section = screen.getByRole("region", { name: "ภาคผนวก: ตัวเลขที่ตรวจแล้ว" });
    const table = within(section).getByRole("table", { name: "ตัวเลขที่ระบบคำนวณ (ค่ารวม)" });
    const row = within(table).getAllByRole("row")[1];
    expect(within(row).getByRole("img", { name: /^0\.96 \(0\.78–1\.17\) \(คำนวณโดยระบบ/ })).toHaveAttribute("data-computed", "true");
    expect(row.querySelector(".num-verified")).toBeNull(); // never the verified face
    expect(row).toHaveTextContent("P3, P4, P7");
    expect(row).toHaveTextContent("81%");
  });

  it("each study code says it opens the source sentences (fix round 1)", () => {
    stubViewport(true);
    render(<Report review={slrP20ReviewFixture} />);
    const section = screen.getByRole("region", { name: "ภาคผนวก: ตัวเลขที่ตรวจแล้ว" });
    expect(within(section).getAllByRole("button", { name: "P3: ดูประโยคต้นฉบับ" }).length).toBeGreaterThan(0);
  });

  it("numbers with no stored quote are left out and counted; unchecked numbers get a note, not a table (fix round 1)", () => {
    stubViewport(true);
    const papers = slrP20ReviewFixture.result!.papers!.map((p) => (p.ref === "P1" && p.card && p.card_en ? {
      ...p, card: { ...p.card, sample_size_quote: null }, card_en: { ...p.card_en, sample_size_quote: null } } : p));
    const { unmount } = render(<Report review={{ ...slrP20ReviewFixture, result: { ...slrP20ReviewFixture.result!, papers } }} />);
    const section = screen.getByRole("region", { name: "ภาคผนวก: ตัวเลขที่ตรวจแล้ว" });
    expect(section.querySelector("[data-appendix-omitted]")).toHaveTextContent("1");
    expect(within(section).getByRole("table", { name: "ตัวเลขจากงานวิจัยที่ตรวจกับบทคัดย่อแล้ว" }).textContent).not.toContain("48,210");
    unmount();
    const off = { ...slrP20ReviewFixture, result: { ...slrP20ReviewFixture.result!, methods: {
      ...slrP20ReviewFixture.result!.methods!, extraction: { ...slrP20ReviewFixture.result!.methods!.extraction, verify_quotes: false } } } };
    render(<Report review={off} />);
    const s2 = screen.getByRole("region", { name: "ภาคผนวก: ตัวเลขที่ตรวจแล้ว" });
    expect(within(s2).queryByRole("table", { name: "ตัวเลขจากงานวิจัยที่ตรวจกับบทคัดย่อแล้ว" })).toBeNull();
    expect(s2.querySelector("[data-appendix-unchecked]")).not.toBeNull();
  });

  it("is English in an English report", () => {
    stubViewport(true);
    render(<Report review={P20_FIXTURES_EN.meta} />);
    const section = screen.getByRole("region", { name: "Appendix: verified numbers" });
    expect(within(section).getByRole("table", { name: "Numbers from the studies, checked against the abstracts" })).toBeInTheDocument();
    expect(within(section).getByRole("table", { name: "Numbers computed by the system (pooled)" })).toBeInTheDocument();
  });
});

describe("print mode (Plan 20 Task 8)", () => {
  it("before printing: every disclosure opens, the literature matrix becomes one table of every row, the SoF table is a table; after: all back", () => {
    stubViewport(390);
    const { container } = render(<Report review={many} />);
    const root = container.querySelector("[data-report]")!;
    const closed = Array.from(root.querySelectorAll("details")).filter((d) => !d.open);
    expect(closed.length).toBeGreaterThan(2);
    expect(root.querySelector("[data-lit-cards]")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "หน้าของตารางงานวิจัย" })).toBeInTheDocument();
    const sof = () => root.querySelector("section[aria-labelledby=h-sof] table")!;
    expect(sof().className).toContain("max-md:block");

    fire("beforeprint");
    expect(root).toHaveAttribute("data-printing", "true");
    expect(closed.every((d) => d.open)).toBe(true);
    expect(root.querySelector("[data-lit-cards]")).toBeNull();
    const lit = screen.getByRole("table", { name: "ตารางสรุปงานวิจัย" });
    expect(within(lit).getAllByRole("rowheader")).toHaveLength(32);
    expect(screen.queryByRole("navigation", { name: "หน้าของตารางงานวิจัย" })).toBeNull();
    expect(sof().className).not.toContain("max-md:");
    // printed in the light theme whatever the screen theme
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    fire("afterprint");
    expect(root).not.toHaveAttribute("data-printing");
    expect(closed.every((d) => !d.open)).toBe(true);
    expect(root.querySelector("[data-lit-cards]")).not.toBeNull();
    expect(sof().className).toContain("max-md:block");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("a dark screen theme comes back after printing", () => {
    stubViewport(true);
    document.documentElement.setAttribute("data-theme", "dark");
    render(<Report review={slrP20ReviewFixture} />);
    fire("beforeprint");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    fire("afterprint");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("sets the running header (short title, review id) and the page footer in the report language", () => {
    stubViewport(true);
    const { container, unmount } = render(<Report review={slrP20ReviewFixture} />);
    const css = container.querySelector("style[data-print-page]")!.textContent!;
    expect(css).toContain("@top-left");
    expect(css).toContain("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2");
    expect(css).toContain(slrP20ReviewFixture.id.slice(0, 8));
    expect(css).toContain('"หน้า " counter(page) " จาก " counter(pages)');
    unmount();
    const en = render(<Report review={P20_FIXTURES_EN.slr} />).container.querySelector("style[data-print-page]")!.textContent!;
    expect(en).toContain('"Page " counter(page) " of " counter(pages)');
    expect(en).toContain("In adults with type 2 diabetes");
  });

  it("controls are marked print:hidden: section nav, view toggles, filters, copy buttons, the rail, scroll cues", () => {
    stubViewport(true);
    const { container } = render(<Report review={slrP20ReviewFixture} />);
    const hidden = (el: Element | null) => expect(el?.closest(".print\\:hidden")).not.toBeNull();
    hidden(screen.getByRole("navigation", { name: "สารบัญ" }));
    hidden(screen.getByRole("button", { name: /^กรอง/ }));
    const toggles = container.querySelectorAll("figure button[aria-pressed]"); // chart / table view toggles
    expect(toggles.length).toBeGreaterThan(0);
    for (const el of toggles) hidden(el);
    hidden(screen.getByRole("button", { name: "คัดลอกการอ้างอิงรายงานนี้" }));
    hidden(screen.getByRole("complementary", { name: "ต้นฉบับ" }));
    hidden(screen.getByRole("button", { name: "พิมพ์" }));
    for (const el of container.querySelectorAll("[data-scroll-hint]")) hidden(el);
    // and the other way round: a key to the printed marks shows only on paper
    // the PRISMA flow prints as its boxes; its table twin would print the same flow twice (fix round 1)
    expect(container.querySelector("[data-prisma-flow] details")).toHaveClass("print:hidden");
    const key = container.querySelector("[data-print-key]")!;
    expect(key).toHaveClass("hidden", "print:block");
    expect(key).toHaveTextContent("[ไม่ได้ตรวจ]");
  });
});

describe("Hole in print", () => {
  it("prints as bracketed text in the report language", () => {
    const { container, unmount } = render(<Hole lang="th" />);
    expect(container.querySelector(".hole")).toHaveAttribute("data-print-label", "[ไม่ได้ตรวจ]");
    expect(container.querySelector(".hole")).toHaveTextContent(/^ไม่ยืนยัน$/); // the screen text is unchanged
    unmount();
    expect(render(<Hole lang="en" />).container.querySelector(".hole")).toHaveAttribute("data-print-label", "[unverified]");
  });
});
