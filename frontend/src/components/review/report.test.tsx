import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyReviewFixture, legacyReviewFixture, metaReviewFixture, narrativeReviewFixture, reviewFixture, scopingReviewFixture, slrReviewFixture } from "@/test/fixtures";

vi.mock("./charts", () => ({
  Charts: () => <section aria-labelledby="h-charts"><h3 id="h-charts">แผนภาพหลักฐาน</h3><div data-testid="charts" /></section>,
}));

vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { desktopViewport } from "@/test/viewport";
import { Report } from "./report";

desktopViewport(); // desktop layouts unless a test stubs a narrow viewport (Plan 20 Task 5: lit-matrix cards, concept outline)

async function openFilters() {
  await userEvent.click(screen.getByRole("button", { name: /^กรอง \(แสดง/ }));
}

function rail() {
  return within(screen.getByRole("complementary", { name: /ต้นฉบับ/ }));
}

describe("Report", () => {
  it("opens on the refined question, summary, evidence strength and comparison matrix", () => {
    render(<Report review={reviewFixture} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2");
    expect(screen.getByRole("button", { name: /ความแข็งแรงของหลักฐาน/ }).closest("p")).toHaveTextContent("ต่ำ");
    expect(screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ })).toBeInTheDocument();
    expect(screen.getByText(/ระยะติดตามสั้น/)).toBeInTheDocument();
  });

  it("clicking a matrix cell shows the verbatim source sentence with the number highlighted", async () => {
    render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }));
    expect(rail().getByText(/Metformin use and colorectal cancer risk/)).toBeInTheDocument();
    expect(rail().getByText("0.80", { selector: "mark" })).toBeInTheDocument();
    expect(rail().getByText("HR 0.80")).toHaveClass("num-verified");
    expect(rail().getByText("1,234")).toHaveClass("num-verified");
  });

  it("says every paper was read from its abstract, and old full-text results still show their source", async () => {
    const { unmount } = render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }));
    expect(rail().getByText("บทคัดย่อ")).toBeInTheDocument();
    expect(rail().queryByRole("link", { name: /ฉบับเต็มที่อ่าน/ })).toBeNull();
    unmount();
    render(<Report review={legacyReviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }));
    expect(rail().getByText("ฉบับเต็ม (เว็บสำนักพิมพ์ OA)")).toBeInTheDocument();
    expect(rail().getByRole("link", { name: /ฉบับเต็มที่อ่าน/ })).toBeInTheDocument();
  });

  it("citations in the summary select the cited paper", async () => {
    render(<Report review={reviewFixture} />);
    const summary = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    await userEvent.click(within(summary).getByRole("button", { name: "P4" }));
    expect(rail().getByText(/Short-term metformin initiation/)).toBeInTheDocument();
    expect(rail().getByText("สองโมเดลอ่านต่างกัน")).toBeInTheDocument();
  });

  it("a blanked effect is a visible hole, an unreported one is labelled as such", async () => {
    render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^P2: / }));
    expect(rail().getAllByText("ไม่ยืนยัน").length).toBeGreaterThan(0);
    // the one-study mortality row is behind "show all" (Plan 20 Task 5: k >= 2 by default)
    await userEvent.click(screen.getByRole("button", { name: "แสดงทั้งหมด (2)" }));
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*การเสียชีวิต/ }));
    expect(rail().getByText(/ไม่ได้รายงานตัวเลข/)).toBeInTheDocument();
  });

  it("lists a paper whose extraction failed with its reason", () => {
    render(<Report review={reviewFixture} />);
    expect(screen.getByText(/Antidiabetic drugs and adenoma/)).toBeInTheDocument();
    const papers = screen.getByRole("heading", { name: "งานวิจัยที่อ่าน" }).closest("section")!;
    expect(within(papers).getByText(/อ่านไม่สำเร็จ/)).toBeInTheDocument();
    // the title block counts only the studies that were read, and names the one that was not
    expect(screen.getByLabelText("ข้อมูลรายงาน")).toHaveTextContent("4 ฉบับ (อ่านไม่สำเร็จอีก 1)");
  });

  it("filters by study-design category and shows the category with the paper's own description", async () => {
    render(<Report review={reviewFixture} />);
    await openFilters();
    await userEvent.click(screen.getByLabelText("Case-control"));
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    expect(within(table).queryByRole("columnheader", { name: /^P1\b/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^P2: / }));
    expect(rail().getByText("Case-control · nested case-control")).toBeInTheDocument();
  });

  it("the paper list names each study's design category", () => {
    render(<Report review={reviewFixture} />);
    const list = screen.getByRole("heading", { name: /งานวิจัยที่วิเคราะห์|งานวิจัยที่อ่าน/ }).closest("section")!;
    expect(within(list).getAllByText("Case-control").length).toBeGreaterThan(0);
    expect(within(list).queryByText("nested case-control")).toBeNull();
  });

  it("offers the review as Markdown, CSV and JSON downloads", () => {
    render(<Report review={reviewFixture} />);
    const id = reviewFixture.id;
    for (const [name, fmt] of [["Markdown", "md"], ["CSV", "csv"], ["JSON", "json"]]) {
      const href = screen.getAllByRole("link", { name: new RegExp(name) })[0].getAttribute("href") ?? "";
      expect(href.endsWith(`/api/v1/reviews/${id}/export?format=${fmt}`)).toBe(true);
    }
  });

  it("marks pooled (SR/MA) columns in the comparison table", () => {
    render(<Report review={reviewFixture} />);
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    const p4 = within(table).getByRole("columnheader", { name: /P4/ });
    expect(p4).toHaveTextContent("SR/MA");
    expect(within(table).getByRole("columnheader", { name: /^P1\b/ })).not.toHaveTextContent("SR/MA");
  });

  it("shows the selected cell as a visible line below the matrix", async () => {
    render(<Report review={reviewFixture} />);
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    const live = table.closest("section")!.querySelector("p[aria-live=polite]")!;
    expect(live.textContent).toBe("");
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }));
    expect(live).toHaveTextContent(/^P3 · .*อุบัติการณ์.*:/);
  });

  it("renders one legend that includes the uncertain flag, and no diamond marker", () => {
    render(<Report review={reviewFixture} />);
    const matrix = screen.getByRole("heading", { name: "ผลแต่ละการศึกษา" }).closest("section")!;
    expect(within(matrix).getAllByText("สองโมเดลอ่านต่างกัน")).toHaveLength(1); // the legend, same wording as the flag
    const list = screen.getByRole("heading", { name: "งานวิจัยที่อ่าน" }).closest("section")!;
    expect(within(list).getAllByText("สองโมเดลอ่านต่างกัน").length).toBeGreaterThan(0); // paper list flag
    expect(screen.queryByText(/◆ ไม่แน่นอน/)).toBeNull();
  });

  it("column headers carry the first author and year, with the full title as the tooltip", () => {
    render(<Report review={reviewFixture} />);
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    const abbr = within(table).getByRole("columnheader", { name: /^P3\b/ }).querySelector("abbr")!;
    expect(abbr.getAttribute("title")).toContain("Metformin use and colorectal cancer risk");
    expect(abbr).toHaveTextContent("Lindqvist 2021");
  });

  it("switches to the English original", async () => {
    render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText(/Most studies found a lower risk/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("In adults with type 2 diabetes");
  });

  it("filters narrow the matrix and the paper list", async () => {
    render(<Report review={reviewFixture} />);
    const toggle = screen.getByRole("button", { name: "กรอง (แสดง 5 จาก 5 ฉบับ)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(/ความเกี่ยวข้องขั้นต่ำ/)).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const slider = screen.getByLabelText(/ความเกี่ยวข้องขั้นต่ำ/);
    // fireEvent-style change: user-event cannot drag range inputs in jsdom
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(slider, { target: { value: "90" } });
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    expect(within(table).queryByRole("columnheader", { name: /^P4/ })).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /^P3\b/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "กรอง (แสดง 2 จาก 5 ฉบับ)" })).toBeInTheDocument();
  });

  it("while filtering, a status line above the charts and the paper list clears the filters", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<Report review={reviewFixture} />);
    expect(screen.queryByText(/กำลังกรอง/)).toBeNull();
    await openFilters();
    fireEvent.change(screen.getByLabelText(/ความเกี่ยวข้องขั้นต่ำ/), { target: { value: "90" } });
    const statuses = screen.getAllByText("กำลังกรอง: แสดง 2 จาก 5 ฉบับ");
    expect(statuses).toHaveLength(2);
    const chartsWrap = screen.getByTestId("charts").closest("section")!.parentElement!;
    expect(within(chartsWrap).getByText(/กำลังกรอง/).compareDocumentPosition(screen.getByTestId("charts")))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const papers = screen.getByRole("heading", { name: "งานวิจัยที่อ่าน" }).closest("section")!;
    expect(within(papers).getByText(/กำลังกรอง/)).toBeInTheDocument();
    await userEvent.click(within(papers).getByRole("button", { name: "ล้างตัวกรอง" }));
    expect(screen.queryByText(/กำลังกรอง/)).toBeNull();
    expect(screen.getByRole("button", { name: "กรอง (แสดง 5 จาก 5 ฉบับ)" })).toBeInTheDocument();
  });

  it("the section nav and the table of contents link exactly the section headings present, in reading order", () => {
    const { container } = render(<Report review={reviewFixture} />);
    const ids = navIds(container);
    for (const id of ids) expect(container.querySelector(`h2#${id}`)).not.toBeNull();
    const h2ids = [...container.querySelectorAll("h2[id^='h-']")].map((h) => h.id);
    expect(h2ids).toEqual(ids);
    expect(ids[0]).toBe("h-answer");
    expect(ids.at(-1)).toBe("h-downloads");
    const toc = screen.getByRole("navigation", { name: "สารบัญ" });
    expect(within(toc).getAllByRole("link").map((a) => a.getAttribute("href")!.slice(1))).toEqual(ids);
    expect(within(toc).getAllByRole("link").map((a) => a.textContent)).toContain("ดาวน์โหลด");
  });

  it("a review with no papers has no section nav or table of contents", () => {
    render(<Report review={emptyReviewFixture} />);
    expect(screen.queryByRole("navigation", { name: "ในรายงานนี้" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "สารบัญ" })).toBeNull();
  });

  it("methods hold the disclaimer and downloads have their own section; offline there is no downloads section", () => {
    const { unmount } = render(<Report review={reviewFixture} />);
    const downloads = screen.getByRole("heading", { name: "ดาวน์โหลด" }).closest("section")!;
    expect(within(downloads).getByRole("link", { name: /HTML/ })).toBeInTheDocument();
    expect(within(downloads).getByRole("link", { name: "CSV" })).toBeInTheDocument();
    const method = screen.getByRole("heading", { name: "วิธีการ" }).closest("section")!;
    expect(within(method).getByText(/ไม่ใช่คำแนะนำทางการแพทย์/)).toBeInTheDocument();
    unmount();
    render(<Report review={reviewFixture} offline />);
    const offlineMethod = screen.getByRole("heading", { name: "วิธีการ" }).closest("section")!;
    expect(screen.getByRole("navigation", { name: "ในรายงานนี้" })).toHaveTextContent("วิธีการ");
    expect(screen.queryByRole("heading", { name: "ดาวน์โหลด" })).toBeNull();
    expect(within(offlineMethod).queryByRole("link")).toBeNull();
    // no site header in the offline file, so the sticky nav and anchor offsets use a zero header height
    expect(offlineMethod.closest<HTMLElement>("[style]")!.style.getPropertyValue("--header-h")).toBe("0px");
    expect(within(offlineMethod).getByText(/ไม่ใช่คำแนะนำทางการแพทย์/)).toBeInTheDocument();
  });

  it("a review with no papers shows the explicit message and no matrix", () => {
    render(<Report review={emptyReviewFixture} />);
    expect(screen.getByText(/ไม่พบงานวิจัยที่ตรงกับหัวข้อนี้/)).toBeInTheDocument();
    // the only table is the selection flow's twin (Plan 20 Task 4: the flow explains the empty result); no matrix
    expect(screen.queryAllByRole("table").filter((t) => !t.closest("[data-prisma-flow]"))).toHaveLength(0);
    // empty state: a next step instead of a rating for nothing (design review FINDING-003)
    expect(screen.getByRole("link", { name: "ถามคำถามใหม่" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/ความแข็งแรงของหลักฐาน/)).not.toBeInTheDocument();
    expect(screen.queryByText(/สรุปเขียนโดยโมเดล/)).not.toBeInTheDocument();
    expect(screen.queryByText(/·s*$/)).not.toBeInTheDocument();
  });

  it("the bottom line shows the direction tally as plain counts, never as verified numbers", () => {
    render(<Report review={reviewFixture} />);
    const section = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    const tally = within(section).getByRole("list");
    const cards = reviewFixture.result!.papers!.map((p) => (p.card_en ?? p.card)?.overall_direction).filter(Boolean);
    const items = within(tally).getAllByRole("listitem");
    const total = items.reduce((n, li) => n + Number(li.querySelector(".tabular-nums")!.textContent), 0);
    expect(total).toBe(cards.length);
    expect(tally.querySelector(".num-verified")).toBeNull();
    expect(within(section).getByText(/งานทบทวน\/วิเคราะห์อภิมานอาจซ้อนกับงานวิจัยหลัก/)).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: /จำนวนงานวิจัยตามทิศทางผล/ })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: /ความแข็งแรงของหลักฐาน/ })).toBeInTheDocument();
    expect(within(section).getByText(/ตัวเลขตรวจผ่าน/)).toBeInTheDocument();
  });

  it("copy link and downloads are hidden offline; downloads and copy link are present online", () => {
    const { unmount } = render(<Report review={reviewFixture} />);
    expect(screen.getByRole("button", { name: "คัดลอกลิงก์" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /HTML/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "พิมพ์" })).toBeInTheDocument();
    unmount();
    render(<Report review={reviewFixture} offline />);
    expect(screen.queryByRole("button", { name: "คัดลอกลิงก์" })).toBeNull();
    expect(screen.queryByRole("link", { name: /HTML/ })).toBeNull();
    expect(screen.getByRole("button", { name: "พิมพ์" })).toBeInTheDocument();
  });

  it("the summary note points to the source rail and no longer says tape is in the table", () => {
    render(<Report review={reviewFixture} />);
    const note = screen.getByText(/สรุปเขียนโดยโมเดล/);
    expect(note).toHaveTextContent("ดูได้ในแถบต้นฉบับ");
    expect(note.textContent).not.toMatch(/ลายเทปในตาราง/);
  });

  it("how the agent interpreted the question is one flat disclosure after the bottom line", () => {
    const { container } = render(<Report review={reviewFixture} />);
    const summary = screen.getByText("เอเจนต์ตีความคำถามอย่างไร");
    const details = summary.closest("details")!;
    expect(details.querySelector("details")).toBeNull();
    expect(within(details).getByRole("button", { name: "PICO" })).toBeInTheDocument();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});

function navIds(container: HTMLElement) {
  const nav = within(container).getByRole("navigation", { name: "ในรายงานนี้" });
  return within(nav).getAllByRole("link").map((a) => a.getAttribute("href")!.slice(1));
}

/** Every section and block heading in reading order (H2 groups and the H3 blocks inside them). */
function headingIds(container: HTMLElement) {
  return [...container.querySelectorAll("h2[id^='h-'], h3[id^='h-']")].map((h) => h.id);
}

describe("Report per review type", () => {
  it("a legacy result (no review_type) shows no type badge and keeps its sections and 'very low' fallback", () => {
    const noStrength = { ...reviewFixture, result: { ...reviewFixture.result!, synthesis: { ...reviewFixture.result!.synthesis!, evidence_strength: null } } };
    const { container } = render(<Report review={noStrength} />);
    expect(screen.queryByText(/อ่านเฉพาะบทคัดย่อ/)).toBeNull();
    expect(navIds(container)).toEqual(["h-answer", "h-selection", "h-results", "h-rob", "h-claims", "h-limitations", "h-gaps", "h-method", "h-papers", "h-downloads"]);
    expect(headingIds(container)).toEqual(["h-answer", "h-selection", "h-results", "h-matrix", "h-charts", "h-rob", "h-claims", "h-limitations", "h-gaps", "h-method", "h-papers", "h-downloads"]);
    expect(container.querySelector("#h-key-findings, #h-sof, #h-discussion")).toBeNull(); // no answer, no SoF for legacy
    expect(screen.getByRole("button", { name: /ความแข็งแรงของหลักฐาน/ }).closest("p")).toHaveTextContent("ต่ำมาก");
  });

  it("slr with no quantitative studies: strength not assessed (never 'very low'), with the reason", () => {
    const why = "ไม่ได้ประเมินความแข็งแรงของหลักฐาน: ไม่มีงานวิจัยเชิงปริมาณ";
    const synthesis = { ...slrReviewFixture.result!.synthesis!, evidence_strength: null, grade_baseline: null, evidence_rationale: why };
    const review = { ...slrReviewFixture, result: { ...slrReviewFixture.result!, synthesis } };
    render(<Report review={review} />);
    const summary = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    expect(within(summary).getByText(/^ไม่ได้ประเมินความแข็งแรงของหลักฐาน \(/)).toBeInTheDocument();
    expect(within(summary).getByText(why)).toBeInTheDocument();
    expect(within(summary).queryByRole("button", { name: /^ความแข็งแรงของหลักฐาน/ })).toBeNull();
    expect(screen.queryByText("ต่ำมาก")).toBeNull();
  });

  it("scoping: badge, PCC, evidence map; no claims, findings matrix, forest or direction tally", () => {
    const { container } = render(<Report review={scopingReviewFixture} />);
    expect(screen.getByLabelText("ข้อมูลรายงาน")).toHaveTextContent("การทบทวนขอบเขต");
    expect(screen.getByText("อัตโนมัติ · อ่านเฉพาะบทคัดย่อ · ไม่ใช่คำแนะนำทางการแพทย์")).toBeInTheDocument();
    expect(navIds(container)).toEqual(["h-answer", "h-selection", "h-characteristics", "h-landscape", "h-limitations", "h-gaps", "h-method", "h-papers", "h-downloads"]);
    expect(headingIds(container)).toEqual(["h-answer", "h-selection", "h-characteristics", "h-evidence-map", "h-litmatrix", "h-landscape", "h-map",
      "h-limitations", "h-gaps", "h-method", "h-papers", "h-downloads"]);
    expect(container.querySelector("#h-sof")).toBeNull();
    expect(container.querySelector("#h-claims")).toBeNull();
    expect(container.querySelector("#h-matrix")).toBeNull();
    expect(screen.queryByRole("table", { name: /ผลแต่ละการศึกษา/ })).toBeNull();
    const summary = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    expect(within(summary).queryByRole("list")).toBeNull();
    expect(within(summary).queryByRole("button", { name: /จำนวนงานวิจัยตามทิศทางผล/ })).toBeNull();
    expect(within(summary).getByText(/ไม่ได้ประเมินความแข็งแรงของหลักฐาน \(การทบทวนขอบเขต\)/)).toBeInTheDocument();
    expect(screen.queryByText("ต่ำมาก")).toBeNull();
    expect(container.querySelector("[data-disclaimer]")).toHaveTextContent(/การทบทวนขอบเขต.*ไม่ใช่คำแนะนำทางการแพทย์/);
  });

  it("scoping: the evidence map counts papers per concept and design, as plain counts", () => {
    render(<Report review={scopingReviewFixture} />);
    const section = screen.getByRole("heading", { name: "แผนที่หลักฐาน" }).closest("section")!;
    expect(within(section).getByText(/^จำนวนงานที่พบ ไม่ใช่การประเมินว่าได้ผล/)).toBeInTheDocument();
    const byConcept = within(section).getByRole("table", { name: /ตามประเด็น/ });
    const row = within(byConcept).getByRole("row", { name: /อุบัติการณ์มะเร็งลำไส้ใหญ่/ });
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["4", "2", "1", "1"]);
    expect(within(byConcept).getByRole("columnheader", { name: "รวม" })).toBeInTheDocument();
    const byYear = within(section).getByRole("table", { name: /ตามช่วงปี/ });
    expect(within(within(byYear).getByRole("row", { name: /2015–2019/ })).getAllByRole("cell").map((c) => c.textContent)).toEqual(["2", "1", "1", "–"]);
    expect(section.querySelector(".num-verified")).toBeNull();
    expect(section.querySelectorAll("td.tabular-nums.font-display").length).toBeGreaterThan(0);
  });

  it("scoping: question details show the PCC block and key terms instead of PICO", () => {
    render(<Report review={scopingReviewFixture} />);
    const details = screen.getByText("เอเจนต์ตีความคำถามอย่างไร").closest("details")!;
    expect(within(details).getByRole("button", { name: "PCC" })).toBeInTheDocument();
    expect(within(details).queryByRole("button", { name: "PICO" })).toBeNull();
    expect(within(details).getByText("C · แนวคิด").nextElementSibling).toHaveTextContent("การใช้เมตฟอร์มิน");
    expect(within(details).getByText("C · บริบท").nextElementSibling).toHaveTextContent("การดูแลผู้ป่วยนอก");
    expect(within(details).getByText("metformin")).toBeInTheDocument();
  });

  it("scoping: no direction glyph or risk-of-bias label in the paper list, source drawer or filters", async () => {
    render(<Report review={scopingReviewFixture} />);
    const list = screen.getByRole("heading", { name: "งานวิจัยที่อ่าน" }).closest("section")!;
    expect(within(list).queryAllByRole("img")).toHaveLength(0);
    expect(list).not.toHaveTextContent(/อคติ/);
    expect(list).not.toHaveTextContent(/สนับสนุนผล|ตรงข้าม/);
    expect(within(list).getByText("Case-control")).toBeInTheDocument(); // design stays
    await userEvent.click(within(list).getByRole("button", { name: /^P2 / })); // P2 keeps a positive direction in its card
    expect(rail().queryAllByRole("img")).toHaveLength(0);
    expect(screen.getByRole("complementary", { name: /ต้นฉบับ/ })).not.toHaveTextContent(/ความเสี่ยงอคติ|สนับสนุนผล/);
    await openFilters();
    expect(screen.queryByText("ความเสี่ยงอคติ")).toBeNull();
  });

  it("key terms show on typed results only; a legacy result with key_terms renders as before", () => {
    const keyTerms = [{ term: "metformin", synonyms: ["biguanide"], mesh: "Metformin" }];
    const legacy = { ...reviewFixture, result: { ...reviewFixture.result!, question: { ...reviewFixture.result!.question!, key_terms: keyTerms } } };
    const { unmount } = render(<Report review={legacy} />);
    expect(screen.queryByText("คำสำคัญที่ใช้ค้น")).toBeNull();
    expect(screen.queryByText(/· biguanide/)).toBeNull();
    unmount();
    render(<Report review={{ ...legacy, result: { ...legacy.result, review_type: "slr" as const } }} />);
    expect(screen.getByText("คำสำคัญที่ใช้ค้น")).toBeInTheDocument();
  });

  it("narrative: not graded, keeps claims and findings, hides PRISMA", () => {
    const { container } = render(<Report review={narrativeReviewFixture} />);
    expect(screen.getByText(/ไม่ได้ประเมินความแข็งแรงของหลักฐาน \(การทบทวนแบบบรรยาย\)/)).toBeInTheDocument();
    expect(screen.queryByText("ต่ำมาก")).toBeNull();
    expect(navIds(container)).toEqual(["h-answer", "h-characteristics", "h-results", "h-rob", "h-claims", "h-landscape", "h-limitations", "h-gaps", "h-method", "h-papers", "h-downloads"]);
    // Plan 20 Task 5: no outcome has 3 effect sizes and the study map has < 5 points, so the charts block is left out
    expect(headingIds(container)).toEqual(["h-answer", "h-characteristics", "h-litmatrix", "h-results", "h-matrix", "h-rob", "h-claims",
      "h-landscape", "h-map", "h-limitations", "h-gaps", "h-method", "h-papers", "h-downloads"]);
    expect(screen.queryByTestId("charts")).toBeNull();
    expect(container.querySelector("[data-prisma-flow]")).toBeNull();
    expect(container.querySelector("#h-sof")).toBeNull();
  });

  it("lit matrix: shown for narrative, slr and scoping, never for legacy; scoping drops direction and bias columns", () => {
    const table = () => screen.queryByRole("table", { name: "ตารางสรุปงานวิจัย" });
    const legacy = render(<Report review={legacyReviewFixture} />);
    expect(table()).toBeNull();
    legacy.unmount();
    const slr = render(<Report review={{ ...reviewFixture, result: { ...reviewFixture.result!, review_type: "slr" as const } }} />);
    expect(table()).not.toBeNull();
    expect(slr.container.querySelector("#h-litmatrix")).not.toBeNull();
    slr.unmount();
    const sc = render(<Report review={scopingReviewFixture} />);
    expect(within(table()!).queryByRole("columnheader", { name: "ทิศทาง" })).toBeNull();
    sc.unmount();
    render(<Report review={narrativeReviewFixture} />);
    expect(within(table()!).getByRole("columnheader", { name: "ทิศทาง" })).toBeInTheDocument();
  });

  it("slr with a null strength says it was not assessed, never 'very low'", () => {
    const slr = { ...reviewFixture, result: { ...reviewFixture.result!, review_type: "slr" as const,
      synthesis: { ...reviewFixture.result!.synthesis!, evidence_strength: null } } };
    render(<Report review={slr} />);
    expect(screen.getByText(/ไม่ได้ประเมินความแข็งแรงของหลักฐาน \(การทบทวนวรรณกรรมอย่างเป็นระบบ\)/)).toBeInTheDocument();
    expect(screen.queryByText("ต่ำมาก")).toBeNull();
  });

  it("meta-analysis: SLR sections plus the pooled section right after the charts, graded, typed badge", () => {
    const { container } = render(<Report review={metaReviewFixture} />);
    expect(navIds(container)).toEqual(["h-answer", "h-sof", "h-selection", "h-characteristics", "h-results", "h-rob", "h-claims", "h-landscape",
      "h-limitations", "h-gaps", "h-method", "h-papers", "h-downloads"]);
    expect(headingIds(container)).toEqual(["h-answer", "h-sof", "h-selection", "h-characteristics", "h-litmatrix", "h-results", "h-matrix",
      "h-charts", "h-meta", "h-rob", "h-claims", "h-landscape", "h-map", "h-citations", "h-limitations", "h-gaps", "h-method", "h-papers", "h-downloads"]);
    expect(screen.getByLabelText("ข้อมูลรายงาน")).toHaveTextContent("การวิเคราะห์อภิมาน");
    const answer = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    expect(within(answer).getByRole("button", { name: /ความแข็งแรงของหลักฐาน/ }).closest("p")).toHaveTextContent("ต่ำมาก");
    expect(screen.getByTestId("charts")).toBeInTheDocument();
  });

  it("meta-analysis: the banner, and every pooled value only as a computed number", () => {
    render(<Report review={metaReviewFixture} />);
    const section = screen.getByRole("heading", { name: /การวิเคราะห์อภิมาน: ค่ารวม/ }).closest("section")!;
    expect(within(section).getByText("คำนวณโดยระบบจากตัวเลขที่ตรวจกับบทคัดย่อแล้ว — ไม่ใช่ผลจากงานวิจัยฉบับใด")).toBeInTheDocument();
    const block = within(section).getByRole("article", { name: "ผลลัพธ์หลัก · งานเชิงสังเกต · HR" });
    const est = within(block).getAllByRole("img", { name: /^0\.96 \(คำนวณโดยระบบ/ });
    expect(est.length).toBeGreaterThan(0);
    for (const el of est) {
      expect(el).toHaveClass("num-computed");
      expect(el.closest(".num-verified")).toBeNull();
    }
    expect(est[0]).toHaveTextContent("0.96คำนวณ");
    expect(within(block).getAllByRole("img", { name: /^0\.78–1\.17 \(คำนวณ/ }).length).toBeGreaterThan(0);
    // the heterogeneity line
    for (const v of ["81%", "0.025", "10.61", "0.005"]) expect(within(block).getByRole("img", { name: new RegExp(`^${v.replace(".", "\\.")} \\(คำนวณ`) })).toBeInTheDocument();
    expect(block).toHaveTextContent("k = 3");
    // no pooled number is ever in the verified face
    for (const el of section.querySelectorAll(".num-verified")) expect(el.textContent).not.toMatch(/0\.96|0\.78–1\.17/);
    // pool-specific warnings in Thai; the method limits once in the banner
    expect(within(block).getByText(/มีงานวิจัยน้อยกว่า 5 ฉบับ/)).toBeInTheDocument();
    expect(within(block).getByText(/งานวิจัยให้ผลต่างกันมาก \(I² ตั้งแต่ 50%\)/)).toBeInTheDocument();
    expect(within(section).getByRole("list", { name: "ข้อจำกัดของทุกค่ารวม" })).toHaveTextContent(/บทคัดย่อเท่านั้น.*95%.*ปรับปัจจัยกวน/);
  });

  it("meta-analysis: 'วิธีคำนวณ' lists every input with verified effect and CI, computed SE and weight, then method and version", async () => {
    render(<Report review={metaReviewFixture} />);
    const block = screen.getByRole("article", { name: /ผลลัพธ์หลัก/ });
    await userEvent.click(within(block).getByText("วิธีคำนวณ"));
    const table = within(block).getByRole("table", { name: /ตัวเลขที่ใช้คำนวณค่ารวม/ });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const p3 = within(rows[0]);
    expect(p3.getByRole("button", { name: "P3" })).toBeInTheDocument();
    expect(p3.getByRole("button", { name: "0.84" })).toHaveClass("num-verified");
    expect(p3.getByText("0.72–0.98")).toHaveClass("num-verified");
    expect(p3.getByRole("img", { name: /^0\.079 \(คำนวณ/ })).toBeInTheDocument();
    expect(p3.getByRole("img", { name: /^33\.2% \(คำนวณ/ })).toBeInTheDocument();
    expect(within(block).getByText(/DerSimonian-Laird random effects · รุ่น meta-1/)).toBeInTheDocument();
    await userEvent.click(p3.getByRole("button", { name: "0.84" }));
    expect(rail().getByText(/Simulated study 3/)).toBeInTheDocument();
  });

  it("meta-analysis: the pooled forest plot, SR/MA reference rows and exclusions summarised by reason", async () => {
    render(<Report review={metaReviewFixture} />);
    const section = screen.getByRole("heading", { name: /การวิเคราะห์อภิมาน: ค่ารวม/ }).closest("section")!;
    expect(within(section).getByRole("img", { name: /Forest plot ค่ารวมของ 3 งานวิจัย/ })).toBeInTheDocument();
    const ref = within(section).getByRole("heading", { name: /งานทบทวนอย่างเป็นระบบที่พบ/ }).parentElement!;
    expect(within(ref).getByRole("button", { name: "0.81" })).toHaveClass("num-verified");
    expect(within(ref).getByText("0.70–0.94")).toHaveClass("num-verified");
    expect(ref).toHaveTextContent("SR/MA ของ RCT");
    const ex = within(section).getByRole("heading", { name: "ผลที่ไม่ได้นำมารวม" }).parentElement!;
    expect(within(ex).getAllByRole("listitem")).toHaveLength(1);
    expect(ex).toHaveTextContent(/งานที่วัดผลแบบเดียวกันมีไม่ถึง 3 ฉบับ.*4 รายการ/);
    expect(ex).toHaveTextContent("ผลลัพธ์หลัก: P1, P2 · ผลด้านความปลอดภัย: P1, P3");
    expect(within(section).getByText(/ความไม่สอดคล้อง: งานวิจัยในค่ารวมของผลลัพธ์หลัก/)).toBeInTheDocument();
    // English view: English outcome names and labels
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("article", { name: "Primary outcome · observational studies · HR" })).toBeInTheDocument();
    expect(screen.getByText("Computed by the system from numbers checked against the abstracts — not a result of any single study")).toBeInTheDocument();
  });

  it("meta-analysis: a failed pooling says so; no pools says nothing was pooled; other types have no pooled section", () => {
    const failed = { ...metaReviewFixture, result: { ...metaReviewFixture.result!, meta_analysis: null } };
    const a = render(<Report review={failed} />);
    expect(screen.getAllByText(/ขั้นตอนรวมผลทำงานไม่สำเร็จ/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/ไม่ใช่ผลจากงานวิจัยฉบับใด/)).toBeNull();
    a.unmount();
    const none = { ...metaReviewFixture, result: { ...metaReviewFixture.result!, meta_analysis: { ...metaReviewFixture.result!.meta_analysis!, pools: [] } } };
    const b = render(<Report review={none} />);
    expect(screen.getByRole("heading", { name: "การวิเคราะห์อภิมาน: รวมผลไม่ได้" })).toBeInTheDocument();
    expect(screen.getByText(/อย่างน้อย 3 ฉบับต่อผลลัพธ์/)).toBeInTheDocument();
    expect(screen.queryByText(/ไม่ใช่ผลจากงานวิจัยฉบับใด/)).toBeNull();
    // no pooled value (the SoF participant sums are the only computed numbers left)
    expect([...b.container.querySelectorAll(".num-computed")].filter((el) => !el.closest("[data-participants]"))).toHaveLength(0);
    b.unmount();
    const slr = render(<Report review={{ ...metaReviewFixture, result: { ...metaReviewFixture.result!, review_type: "slr" as const } }} />);
    expect(slr.container.querySelector("#h-meta")).toBeNull();
  });

  it("meta-analysis with no papers: the 'try this' state, no pooled section or banner", () => {
    const empty = { ...metaReviewFixture, result: { ...emptyReviewFixture.result!, review_type: "meta_analysis" as const,
      meta_analysis: { version: "meta-1", pools: [], excluded: [], reference: [], grade: { primary_outcome: null, reasons: [] } } } };
    const { container } = render(<Report review={empty} />);
    expect(screen.getByRole("heading", { name: "ลองแบบนี้" })).toBeInTheDocument();
    expect(container.querySelector("#h-meta")).toBeNull();
    expect(screen.queryByText(/ไม่ใช่ผลจากงานวิจัยฉบับใด/)).toBeNull();
  });

  it("meta-analysis: τ² is labelled with its ln scale for ratio measures", () => {
    render(<Report review={metaReviewFixture} />);
    expect(screen.getByRole("article", { name: /ผลลัพธ์หลัก/ })).toHaveTextContent("τ² (ln) 0.025");
  });

  it("slr with a grade keeps the strength bar", () => {
    const slr = { ...reviewFixture, result: { ...reviewFixture.result!, review_type: "slr" as const } };
    render(<Report review={slr} />);
    const answer = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    const line = within(answer).getByRole("button", { name: /ความแข็งแรงของหลักฐาน/ }).closest("p")!;
    expect(line).toHaveTextContent("ต่ำ");
    expect(line.querySelector("[data-certainty='low']")).not.toBeNull(); // ⊕⊕◯◯
    expect(screen.getByLabelText("ข้อมูลรายงาน")).toHaveTextContent("การทบทวนวรรณกรรมอย่างเป็นระบบ");
  });
});

function stubNarrowViewport() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width"), media: query, addEventListener: () => {}, removeEventListener: () => {},
  }));
}

describe("source rail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a citation selects the paper but highlights no outcome", async () => {
    render(<Report review={reviewFixture} />);
    const summary = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    await userEvent.click(within(summary).getByRole("button", { name: "P4" }));
    expect(screen.getByRole("complementary", { name: /ต้นฉบับ/ }).querySelector("li[aria-current]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }));
    expect(screen.getByRole("complementary", { name: /ต้นฉบับ/ }).querySelectorAll("li[aria-current]")).toHaveLength(1);
  });
});

describe("mobile source drawer", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function openDrawer() {
    stubNarrowViewport();
    render(<Report review={reviewFixture} />);
    const cell = screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ });
    await userEvent.click(cell);
    return cell;
  }

  it("opens as a labelled modal dialog and moves focus to the heading", async () => {
    await openDrawer();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const heading = within(dialog).getByRole("heading", { name: /ต้นฉบับ/ });
    expect(dialog).toHaveAccessibleName(heading.textContent!);
    expect(heading).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("focuses the heading without scrolling, so the selected outcome stays in view", async () => {
    const spy = vi.spyOn(HTMLElement.prototype, "focus");
    await openDrawer();
    const heading = screen.getByRole("heading", { name: /ต้นฉบับ/ });
    const call = spy.mock.calls.findIndex((_, i) => spy.mock.contexts[i] === heading);
    expect(spy.mock.calls[call][0]).toEqual({ preventScroll: true });
    spy.mockRestore();
  });

  it("closes on Esc, restores focus to the trigger and unlocks scroll", async () => {
    const cell = await openDrawer();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cell).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("returns focus to the tapped trigger when the tap left focus on body (Safari)", async () => {
    stubNarrowViewport();
    render(<Report review={reviewFixture} />);
    const cell = screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ });
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    // fireEvent does not move focus, like a tap in Safari
    fireEvent.pointerDown(cell);
    fireEvent.click(cell);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cell).toHaveFocus();
  });

  it("closes on backdrop click", async () => {
    await openDrawer();
    await userEvent.click(screen.getByTestId("rail-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc with an open glossary term closes only the term", async () => {
    await openDrawer();
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(dialog.getAllByRole("button", { name: /ความเสี่ยงอคติ/ })[0]);
    expect(screen.getByRole("note")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is not a dialog on desktop", async () => {
    render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("complementary", { name: /ต้นฉบับ/ })).toBeInTheDocument();
  });

  it("concept map: in the type's section order, never for legacy; the outline twin opens the rail", async () => {
    const slr = { ...reviewFixture, result: { ...reviewFixture.result!, review_type: "slr" as const } };
    const a = render(<Report review={slr} />);
    expect(navIds(a.container)).toEqual(["h-answer", "h-sof", "h-selection", "h-characteristics", "h-results", "h-rob", "h-claims", "h-landscape",
      "h-limitations", "h-gaps", "h-method", "h-papers", "h-downloads"]);
    expect(headingIds(a.container).filter((id) => ["h-landscape", "h-map"].includes(id))).toEqual(["h-landscape", "h-map"]);
    expect(screen.getByRole("img", { name: /แผนที่ความรู้ \d+ กลุ่มงานวิจัย/ })).toBeInTheDocument();
    expect(screen.getByText(/เส้นเชื่อมมาจากตารางผลแต่ละการศึกษาเท่านั้น/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ดูเป็นตาราง" }));
    const outline = screen.getByRole("list", { name: "โครงร่างแผนที่ความรู้" });
    expect(within(outline).getAllByText(/อุบัติการณ์มะเร็งลำไส้ใหญ่/).length).toBeGreaterThan(0);
    await userEvent.click(within(outline).getAllByRole("button", { name: "P4" })[0]);
    expect(rail().getByText(/Short-term metformin initiation/)).toBeInTheDocument();
    a.unmount();
    const legacy = render(<Report review={legacyReviewFixture} />);
    expect(legacy.container.querySelector("#h-map")).toBeNull();
  });

  it("citation network: after the concept map when result.citations exists; never for legacy or without data", async () => {
    const a = render(<Report review={slrReviewFixture} />);
    expect(headingIds(a.container).slice(-8)).toEqual(["h-landscape", "h-map", "h-citations", "h-limitations", "h-gaps", "h-method", "h-papers", "h-downloads"]);
    expect(screen.getAllByRole("link", { name: "ภาพรวมความรู้" })[0]).toHaveAttribute("href", "#h-landscape");
    const section = screen.getByRole("heading", { level: 3, name: "เครือข่ายการอ้างอิง" }).closest("section")!;
    expect(within(section).getByRole("img", { name: "เครือข่ายการอ้างอิง 5 งานวิจัย 4 เส้นเชื่อม" })).toBeInTheDocument();
    // the twin's ref opens the rail
    await userEvent.click(within(section).getByRole("button", { name: "ดูเป็นตาราง" }));
    await userEvent.click(within(section).getByRole("button", { name: /^P4 / }));
    expect(rail().getByText(/Short-term metformin initiation/)).toBeInTheDocument();
    // the lit matrix gains the cited-by column
    expect(within(screen.getByRole("table", { name: "ตารางสรุปงานวิจัย" })).getByRole("columnheader", { name: "ถูกอ้างอิง" })).toBeInTheDocument();
    a.unmount();
    const none = render(<Report review={{ ...slrReviewFixture, result: { ...slrReviewFixture.result!, citations: null } }} />);
    expect(none.container.querySelector("#h-citations")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "ถูกอ้างอิง" })).toBeNull();
    none.unmount();
    const legacy = render(<Report review={{ ...legacyReviewFixture, result: { ...legacyReviewFixture.result!, citations: slrReviewFixture.result!.citations } }} />);
    expect(legacy.container.querySelector("#h-citations")).toBeNull();
  });

  it("concept map: scoping groups by design and shows no direction", async () => {
    render(<Report review={scopingReviewFixture} />);
    const section = screen.getByRole("heading", { name: "แผนที่ความรู้" }).closest("section")!;
    await userEvent.click(within(section).getByRole("button", { name: "ดูเป็นตาราง" }));
    expect(section).toHaveTextContent("Case-control");
    expect(section).not.toHaveTextContent(/สนับสนุนผล|ตรงข้าม|ตามที่เอเจนต์อ่าน/);
    expect(within(section).queryAllByRole("img")).toHaveLength(0);
  });
});
