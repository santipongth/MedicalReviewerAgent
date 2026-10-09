import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyReviewFixture, legacyReviewFixture, narrativeReviewFixture, reviewFixture, scopingReviewFixture } from "@/test/fixtures";

vi.mock("./charts", () => ({ Charts: () => <section aria-labelledby="h-charts"><h2 id="h-charts">แผนภาพหลักฐาน</h2><div data-testid="charts" /></section> }));

vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { Report } from "./report";

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
    const summary = screen.getByRole("heading", { name: "สรุป" }).closest("section")!;
    await userEvent.click(within(summary).getByRole("button", { name: "P4" }));
    expect(rail().getByText(/Short-term metformin initiation/)).toBeInTheDocument();
    expect(rail().getByText("สองโมเดลอ่านต่างกัน")).toBeInTheDocument();
  });

  it("a blanked effect is a visible hole, an unreported one is labelled as such", async () => {
    render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^P2: / }));
    expect(rail().getAllByText("ไม่ยืนยัน").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*การเสียชีวิต/ }));
    expect(rail().getByText(/ไม่ได้รายงานตัวเลข/)).toBeInTheDocument();
  });

  it("lists a paper whose extraction failed with its reason", () => {
    render(<Report review={reviewFixture} />);
    expect(screen.getByText(/Antidiabetic drugs and adenoma/)).toBeInTheDocument();
    expect(screen.getByText(/อ่านไม่สำเร็จ/)).toBeInTheDocument();
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
    const live = table.parentElement!.parentElement!.querySelector("p[aria-live=polite]")!;
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

  it("the section nav links exactly the section headings present, in reading order", () => {
    const { container } = render(<Report review={reviewFixture} />);
    const nav = screen.getByRole("navigation", { name: "ในรายงานนี้" });
    const links = within(nav).getAllByRole("link");
    const ids = links.map((a) => a.getAttribute("href")!.slice(1));
    for (const id of ids) expect(container.querySelector(`h2#${id}`)).not.toBeNull();
    const h2ids = [...container.querySelectorAll("h2[id^='h-']")].map((h) => h.id);
    expect(h2ids).toEqual(ids);
    expect(ids[0]).toBe("h-summary");
    expect(ids.at(-1)).toBe("h-method");
    expect(links.map((a) => a.textContent)).toContain("ดาวน์โหลด");
  });

  it("a review with no papers has no section nav", () => {
    render(<Report review={emptyReviewFixture} />);
    expect(screen.queryByRole("navigation", { name: "ในรายงานนี้" })).toBeNull();
  });

  it("the method section repeats the downloads and holds the disclaimer; offline it has neither link", () => {
    const { unmount } = render(<Report review={reviewFixture} />);
    const method = screen.getByRole("heading", { name: "วิธีทำและดาวน์โหลด" }).closest("section")!;
    expect(within(method).getByRole("link", { name: /HTML/ })).toBeInTheDocument();
    expect(within(method).getByRole("link", { name: "CSV" })).toBeInTheDocument();
    expect(within(method).getByText(/ไม่ใช่คำแนะนำทางการแพทย์/)).toBeInTheDocument();
    unmount();
    render(<Report review={reviewFixture} offline />);
    const offlineMethod = screen.getByRole("heading", { name: "วิธีทำ" }).closest("section")!;
    expect(screen.getByRole("navigation", { name: "ในรายงานนี้" })).toHaveTextContent("วิธีทำ");
    expect(within(offlineMethod).queryByRole("link")).toBeNull();
    // no site header in the offline file, so the sticky nav and anchor offsets use a zero header height
    expect(offlineMethod.closest<HTMLElement>("[style]")!.style.getPropertyValue("--header-h")).toBe("0px");
    expect(within(offlineMethod).getByText(/ไม่ใช่คำแนะนำทางการแพทย์/)).toBeInTheDocument();
  });

  it("a review with no papers shows the explicit message and no matrix", () => {
    render(<Report review={emptyReviewFixture} />);
    expect(screen.getByText(/ไม่พบงานวิจัยที่ตรงกับหัวข้อนี้/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // empty state: a next step instead of a rating for nothing (design review FINDING-003)
    expect(screen.getByRole("link", { name: "ถามคำถามใหม่" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/ความแข็งแรงของหลักฐาน/)).not.toBeInTheDocument();
    expect(screen.queryByText(/สรุปเขียนโดยโมเดล/)).not.toBeInTheDocument();
    expect(screen.queryByText(/·s*$/)).not.toBeInTheDocument();
  });

  it("the bottom line shows the direction tally as plain counts, never as verified numbers", () => {
    render(<Report review={reviewFixture} />);
    const section = screen.getByRole("heading", { name: "สรุป" }).closest("section")!;
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

describe("Report per review type", () => {
  it("a legacy result (no review_type) shows no type badge and keeps its sections and 'very low' fallback", () => {
    const noStrength = { ...reviewFixture, result: { ...reviewFixture.result!, synthesis: { ...reviewFixture.result!.synthesis!, evidence_strength: null } } };
    const { container } = render(<Report review={noStrength} />);
    expect(screen.queryByText(/อ่านเฉพาะบทคัดย่อ/)).toBeNull();
    expect(navIds(container)).toEqual(["h-summary", "h-claims", "h-matrix", "h-charts", "h-gaps", "h-papers", "h-method"]);
    expect(screen.getByRole("button", { name: /ความแข็งแรงของหลักฐาน/ }).closest("p")).toHaveTextContent("ต่ำมาก");
  });

  it("scoping: badge, PCC, evidence map; no claims, findings matrix, forest or direction tally", () => {
    const { container } = render(<Report review={scopingReviewFixture} />);
    expect(screen.getByText(/อัตโนมัติ · อ่านเฉพาะบทคัดย่อ/)).toHaveTextContent("การทบทวนขอบเขต");
    expect(navIds(container)).toEqual(["h-summary", "h-evidence-map", "h-litmatrix", "h-map", "h-charts", "h-gaps", "h-papers", "h-method"]);
    expect(container.querySelector("#h-claims")).toBeNull();
    expect(container.querySelector("#h-matrix")).toBeNull();
    expect(screen.queryByRole("table", { name: /ผลแต่ละการศึกษา/ })).toBeNull();
    const summary = screen.getByRole("heading", { name: "สรุป" }).closest("section")!;
    expect(within(summary).queryByRole("list")).toBeNull();
    expect(within(summary).queryByRole("button", { name: /จำนวนงานวิจัยตามทิศทางผล/ })).toBeNull();
    expect(within(summary).getByText(/ไม่ได้ประเมินความแข็งแรงของหลักฐาน \(การทบทวนขอบเขต\)/)).toBeInTheDocument();
    expect(screen.queryByText("ต่ำมาก")).toBeNull();
    expect(screen.getByText(/ไม่ใช่คำแนะนำทางการแพทย์/)).toHaveTextContent("การทบทวนขอบเขต");
  });

  it("scoping: the evidence map counts papers per concept and design, as plain counts", () => {
    render(<Report review={scopingReviewFixture} />);
    const section = screen.getByRole("heading", { name: "แผนที่หลักฐาน" }).closest("section")!;
    expect(within(section).getByText("จำนวนงานที่พบ ไม่ใช่การประเมินว่าได้ผล")).toBeInTheDocument();
    const byConcept = within(section).getByRole("table", { name: /ตามประเด็น/ });
    const row = within(byConcept).getByRole("row", { name: /อุบัติการณ์มะเร็งลำไส้ใหญ่/ });
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["2", "1", "1", "4"]);
    expect(within(byConcept).getByRole("columnheader", { name: "รวม" })).toBeInTheDocument();
    const byYear = within(section).getByRole("table", { name: /ตามช่วงปี/ });
    expect(within(within(byYear).getByRole("row", { name: /2015–2019/ })).getAllByRole("cell").map((c) => c.textContent)).toEqual(["1", "1", "–", "2"]);
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
    expect(navIds(container)).toEqual(["h-summary", "h-claims", "h-matrix", "h-litmatrix", "h-map", "h-charts", "h-gaps", "h-papers", "h-method"]);
    expect(screen.getByTestId("charts")).toBeInTheDocument();
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

  it("slr with a grade keeps the strength bar", () => {
    const slr = { ...reviewFixture, result: { ...reviewFixture.result!, review_type: "slr" as const } };
    render(<Report review={slr} />);
    expect(screen.getByRole("button", { name: /ความแข็งแรงของหลักฐาน/ }).closest("p")).toHaveTextContent("ต่ำ");
    expect(screen.getByText(/อัตโนมัติ · อ่านเฉพาะบทคัดย่อ/)).toHaveTextContent("การทบทวนวรรณกรรมอย่างเป็นระบบ");
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
    const summary = screen.getByRole("heading", { name: "สรุป" }).closest("section")!;
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
    expect(navIds(a.container)).toEqual(["h-summary", "h-claims", "h-matrix", "h-charts", "h-litmatrix", "h-map", "h-gaps", "h-papers", "h-method"]);
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

  it("concept map: scoping groups by design and shows no direction", async () => {
    render(<Report review={scopingReviewFixture} />);
    const section = screen.getByRole("heading", { name: "แผนที่ความรู้" }).closest("section")!;
    await userEvent.click(within(section).getByRole("button", { name: "ดูเป็นตาราง" }));
    expect(section).toHaveTextContent("Case-control");
    expect(section).not.toHaveTextContent(/สนับสนุนผล|ตรงข้าม|ตามที่เอเจนต์อ่าน/);
    expect(within(section).queryAllByRole("img")).toHaveLength(0);
  });
});
