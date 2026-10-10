// Plan 20 Task 6: Vancouver references with links and copy citation, related reports under their primary, the
// excluded-at-screening disclosure, how to cite the report and the downloads row.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { vancouver } from "@/lib/citation";
import { engineP20ReviewFixture, reviewFixture, slrP20ReviewFixture } from "@/test/fixtures";
import type { Review } from "@/lib/types";

vi.mock("./charts", () => ({
  Charts: () => <section aria-labelledby="h-charts"><h3 id="h-charts">แผนภาพหลักฐาน</h3><div data-testid="charts" /></section>,
}));
vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { Report } from "./report";
import { ComparisonMatrix } from "./report-parts";

const section = (name: RegExp | string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
const refs = () => section("เอกสารอ้างอิง");
const entry = (ref: string) => document.getElementById(`ref-${ref}`)!;

function mockClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

describe("references", () => {
  it("lists every paper in P-number order as a Vancouver reference, in the section titled References", () => {
    render(<Report review={reviewFixture} />);
    const items = [...refs().querySelectorAll("li[data-reference]")].map((li) => li.getAttribute("data-reference"));
    expect(items).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    const p3 = reviewFixture.result!.papers![2];
    expect(entry("P3").querySelector("[data-citation]")!.textContent).toBe(vancouver(p3));
    expect(entry("P3").querySelector("[data-citation]")!.textContent)
      .toBe("Lindqvist J, Other A. Metformin use and colorectal cancer risk among adults with type 2 diabetes. BMJ Open. 2021. doi: 10.1000/p3. PMID: 3000003. PMCID: PMC300003.");
    expect(screen.getByRole("navigation", { name: "สารบัญ" })).toHaveTextContent("อ้างอิง");
  });

  it("DOI, PMID and PMCID are links with accessible names", () => {
    render(<Report review={reviewFixture} />);
    const p3 = within(entry("P3"));
    expect(p3.getByRole("link", { name: /^DOI 10\.1000\/p3/ })).toHaveAttribute("href", "https://doi.org/10.1000/p3");
    expect(p3.getByRole("link", { name: /^PubMed 3000003/ })).toHaveAttribute("href", "https://pubmed.ncbi.nlm.nih.gov/3000003/");
    expect(p3.getByRole("link", { name: /^PubMed Central PMC300003/ })).toHaveAttribute("href", "https://pmc.ncbi.nlm.nih.gov/articles/PMC300003/");
    // P5 carries no identifier: no link, nothing invented
    expect(within(entry("P5")).queryAllByRole("link")).toHaveLength(0);
  });

  it("follows the report language for its chrome but keeps the reference text as written", async () => {
    render(<Report review={slrP20ReviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    const list = section("References");
    expect(within(list).getAllByRole("button", { name: /^Copy citation P/ }).length).toBeGreaterThan(0);
    expect(entry("P1").querySelector("[data-citation]")!.textContent).toBe(vancouver(slrP20ReviewFixture.result!.papers![0]));
  });

  it("copy citation copies the reference text and says so politely", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    mockClipboard(writeText);
    render(<Report review={reviewFixture} />);
    await act(async () => { within(entry("P3")).getByRole("button", { name: "คัดลอกการอ้างอิง P3" }).click(); });
    expect(writeText).toHaveBeenCalledWith(vancouver(reviewFixture.result!.papers![2]));
    const status = within(entry("P3")).getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("คัดลอกแล้ว");
  });

  it("without a clipboard, copy citation shows the text selected in a read-only box", async () => {
    mockClipboard(() => Promise.reject(new Error("denied")));
    render(<Report review={reviewFixture} />);
    await act(async () => { within(entry("P1")).getByRole("button", { name: "คัดลอกการอ้างอิง P1" }).click(); });
    const box = within(entry("P1")).getByRole("textbox", { name: /การอ้างอิง P1/ });
    expect(box).toHaveAttribute("readonly");
    expect(box).toHaveValue(vancouver(reviewFixture.result!.papers![0]));
  });

  it("the fallback says the copy failed and moves focus to the selected text", async () => {
    mockClipboard(() => Promise.reject(new Error("denied")));
    render(<Report review={reviewFixture} />);
    await act(async () => { within(entry("P1")).getByRole("button", { name: "คัดลอกการอ้างอิง P1" }).click(); });
    expect(within(entry("P1")).getByRole("status")).toHaveTextContent("คัดลอกไม่ได้ เลือกข้อความไว้ให้แล้ว");
    expect(within(entry("P1")).getByRole("textbox")).toHaveFocus();
  });

  it("the confirmation clears after a few seconds, so a second copy is announced again", async () => {
    vi.useFakeTimers();
    try {
      mockClipboard(() => Promise.resolve());
      render(<Report review={reviewFixture} />);
      const button = within(entry("P3")).getByRole("button", { name: "คัดลอกการอ้างอิง P3" });
      await act(async () => { button.click(); });
      expect(within(entry("P3")).getByRole("status")).toHaveTextContent("คัดลอกแล้ว");
      await act(async () => { vi.advanceTimersByTime(5000); });
      expect(within(entry("P3")).getByRole("status")).toHaveTextContent("");
      await act(async () => { button.click(); });
      expect(within(entry("P3")).getByRole("status")).toHaveTextContent("คัดลอกแล้ว");
    } finally {
      vi.useRealTimers();
    }
  });

  it("copy citation stays a 44px target at every width", () => {
    render(<Report review={reviewFixture} />);
    const cls = within(entry("P1")).getByRole("button", { name: "คัดลอกการอ้างอิง P1" }).className;
    expect(cls).toContain("min-h-11");
    expect(cls).not.toMatch(/md:min-h-/);
  });

  it("an identifier wraps only where it must, preferably after '/', and its text is unchanged", () => {
    render(<Report review={reviewFixture} />);
    const doi = within(entry("P3")).getByRole("link", { name: /^DOI 10\.1000\/p3/ });
    expect(doi.className).not.toContain("break-all");
    expect(doi.querySelector("wbr")).not.toBeNull();
    expect(doi.textContent).toBe("10.1000/p3");
  });

  it("a paper that could not be read promises the paper, not source sentences", () => {
    render(<Report review={reviewFixture} />);
    const p5 = within(entry("P5")).getByRole("button", { name: /^P5 / });
    expect(p5).toHaveAccessibleName(/^P5 ดูข้อมูลงานวิจัย: /);
    expect(p5).not.toHaveTextContent("ดูประโยคต้นฉบับ");
    expect(within(entry("P3")).getByRole("button", { name: /^P3 / })).toHaveAccessibleName(/^P3 ดูประโยคต้นฉบับ: /);
  });

  it("the study button in a reference still opens the source rail, and the rail links back to the reference", async () => {
    render(<Report review={reviewFixture} />);
    await userEvent.click(within(refs()).getByRole("button", { name: /^P3 / }));
    const rail = screen.getByRole("complementary", { name: "ต้นฉบับ" });
    expect(rail).toHaveTextContent("Metformin use and colorectal cancer risk");
    expect(within(rail).getByRole("link", { name: "ดูในเอกสารอ้างอิง (P3)" })).toHaveAttribute("href", "#ref-P3");
  });

  it("lists every paper whatever the filters (a reference list is complete)", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^กรอง \(แสดง/ }));
    fireEvent.change(screen.getByLabelText(/ความเกี่ยวข้องขั้นต่ำ/), { target: { value: "90" } });
    expect(refs().querySelectorAll("li[data-reference]")).toHaveLength(5);
    expect(within(refs()).queryByText(/กำลังกรอง/)).toBeNull();
  });

  it("a related report of a trial sits under its primary reference, labelled, not as a numbered study", () => {
    render(<Report review={engineP20ReviewFixture} />);
    const top = [...refs().querySelectorAll(":scope ol > li[data-reference]")].map((li) => li.getAttribute("data-reference"));
    expect(top).not.toContain("P6");
    const p6 = entry("P6");
    expect(entry("P1").contains(p6)).toBe(true);
    expect(p6.querySelector("[data-related-label]")).toHaveTextContent("รายงานเพิ่มเติม");
  });

  it("a paper not used as evidence keeps its number and carries a short note", () => {
    const review: Review = { ...slrP20ReviewFixture, result: { ...slrP20ReviewFixture.result!,
      papers: slrP20ReviewFixture.result!.papers!.map((p) => (p.ref === "P2" ? { ...p, design_excluded: true } : p)) } };
    render(<Report review={review} />);
    expect(entry("P2").querySelector("[data-reference-note='design_excluded']"))
      .toHaveTextContent("ไม่ใช้เป็นหลักฐาน: อ่านแล้วพบว่ารูปแบบการศึกษาไม่ตรงชนิดที่เลือก");
    expect(entry("P1").querySelector("[data-reference-note]")).toBeNull();
  });
});

describe("plural-safe counts", () => {
  it("the findings matrix says 'the 1 outcome' when only one has two or more studies", () => {
    const rows = [
      { outcome: "A", cells: [{ ref: "P1", finding: "x", direction: "positive" as const }, { ref: "P2", finding: "y", direction: "positive" as const }] },
      { outcome: "B", cells: [{ ref: "P1", finding: "z", direction: "null" as const }] },
    ];
    render(<ComparisonMatrix rows={rows} refs={["P1", "P2"]} lang="en" onSelect={() => {}} outcomeOf={() => undefined} />);
    expect(document.querySelector("[data-matrix-filter]")).toHaveTextContent(
      "Showing the 1 outcome reported by 2 or more studies (of 2), most studies first");
  });
});

describe("excluded at screening", () => {
  it("is a closed disclosure with the reason counts, and says per-record details are not stored", () => {
    render(<Report review={slrP20ReviewFixture} />);
    const details = refs().querySelector("details[data-excluded-screening]") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")).toHaveTextContent("บทความที่คัดออกในขั้นคัดกรอง (14)");
    const table = within(details).getByRole("table", { name: /เหตุผลที่คัดออกในขั้นคัดกรอง/ });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows).toEqual(["ไม่เกี่ยวกับหัวข้อ8", "กลุ่มประชากรไม่ตรง3", "ผลลัพธ์ไม่ตรง2", "ชนิดสิ่งตีพิมพ์ไม่ตรง (เช่น บทบรรณาธิการ)1"]);
    for (const th of within(table).getAllByRole("columnheader")) expect(th).toHaveAttribute("scope", "col");
    expect(details).toHaveTextContent("ระบบไม่ได้เก็บรายการบทความที่คัดออกทีละฉบับ");
  });

  it("is left out when the result records no reasons (legacy)", () => {
    render(<Report review={reviewFixture} />);
    expect(refs().querySelector("details[data-excluded-screening]")).toBeNull();
  });
});

describe("how to cite and downloads", () => {
  it("cites the report with its question, type, finished date, id and URL, with a copy button", () => {
    render(<Report review={slrP20ReviewFixture} />);
    const block = section("ดาวน์โหลดและการอ้างอิง");
    const cite = block.querySelector("[data-how-to-cite]")!;
    expect(cite.textContent).toBe(
      `Medical Reviewer Agent. ${slrP20ReviewFixture.result!.question?.refined_question ?? slrP20ReviewFixture.topic}${/[?!]$/.test(slrP20ReviewFixture.result!.question?.refined_question ?? slrP20ReviewFixture.topic) ? "" : "."} ` +
      `การทบทวนวรรณกรรมอย่างเป็นระบบอัตโนมัติ (อ่านเฉพาะบทคัดย่อ), สร้างเมื่อ 2026-10-05. รหัสรีวิว ${slrP20ReviewFixture.id}. ` +
      `${location.origin}/r/${slrP20ReviewFixture.id}.`);
    expect(within(block).getByRole("heading", { name: "วิธีอ้างอิงรายงานนี้" })).toBeInTheDocument();
    expect(within(block).getByRole("button", { name: "คัดลอกการอ้างอิงรายงานนี้" })).toBeInTheDocument();
  });

  it("labels each download with its format", () => {
    render(<Report review={reviewFixture} />);
    const list = within(section("ดาวน์โหลดและการอ้างอิง")).getByRole("list", { name: "ดาวน์โหลดรีวิว" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining(".html"), expect.stringContaining(".md"), expect.stringContaining(".csv"), expect.stringContaining(".json"),
    ]);
    expect(within(list).getByRole("link", { name: /^CSV/ })).toBeInTheDocument();
  });

  it("offline: how to cite stays (without a URL), the downloads go", () => {
    render(<Report review={slrP20ReviewFixture} offline />);
    const block = section("วิธีอ้างอิงรายงานนี้");
    expect(block.querySelector("[data-how-to-cite]")!.textContent).not.toContain("http");
    expect(within(block).queryByRole("list", { name: "ดาวน์โหลดรีวิว" })).toBeNull();
  });
});
