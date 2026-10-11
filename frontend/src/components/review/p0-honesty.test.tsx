// Plan 20 Task 2 (P0 honesty): no direction for qualitative / mixed-methods studies, an honest rail when no number was
// extracted, plain summary prose, the meta-analysis "could not pool" state, and Plan 19's labels where readers look.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { conceptTree } from "@/lib/concept-map";
import { DIRECTION_LABEL } from "@/lib/i18n";
import { isMetaNotPooled, metaPoolGap } from "@/lib/review-type";
import { metaNoPoolReviewFixture, metaReviewFixture, qualitativeReviewFixture, reviewFixture } from "@/test/fixtures";
import { desktopViewport } from "@/test/viewport";

desktopViewport();

vi.mock("./charts", () => ({ Charts: () => <section aria-labelledby="h-charts"><h2 id="h-charts">แผนภาพหลักฐาน</h2></section> }));
vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { Report } from "./report";
import { noNumberText } from "./source-rail";

// Full <Report> renders take about 1 s alone and passed 5 s when three suites shared the CPU (Task 9 stress runs):
// a hang guard for this file only, not a timing assertion.
vi.setConfig({ testTimeout: 20_000 });

const directionNames = Object.values(DIRECTION_LABEL.th);
const rail = () => within(screen.getByRole("complementary", { name: /ต้นฉบับ/ }));
const litRow = (table: HTMLElement, ref: string) =>
  within(table).getByRole("button", { name: new RegExp(`^${ref} `) }).closest("tr") as HTMLElement;
const glyphsIn = (el: HTMLElement) => within(el).queryAllByRole("img").filter((g) => directionNames.includes(g.getAttribute("aria-label") ?? ""));

describe("(a) qualitative and mixed-methods studies never show a direction", () => {
  it("findings matrix: a theme cell is 'found', the row counts 'พบใน k การศึกษา', quantitative cells keep their glyph", async () => {
    render(<Report review={qualitativeReviewFixture} />);
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    for (const ref of ["P1", "P2"]) {
      const cell = within(table).getByRole("button", { name: new RegExp(`^${ref}: ความกลัวการฉีดยา`) });
      expect(cell).toHaveAccessibleName(expect.stringContaining("พบประเด็นนี้"));
      expect(cell.getAttribute("aria-label")).not.toContain("สนับสนุนผล");
      expect(cell.querySelector(".g")).toBeNull();
      expect(cell.querySelector("[data-theme-mark]")).not.toBeNull();
    }
    const themeRow = within(table).getByRole("rowheader", { name: /ความกลัวการฉีดยา/ });
    expect(themeRow).toHaveTextContent("พบใน 2 การศึกษา");
    // P3's outcome is reported by one study: behind "show all" (Plan 20 Task 5)
    await userEvent.click(screen.getByRole("button", { name: "แสดงทั้งหมด (2)" }));
    const p3 = within(table).getByRole("button", { name: /^P3: / });
    expect(p3.querySelector(".g-sup")).not.toBeNull();
    // the legend explains the theme mark
    expect(screen.getByText(/ประเด็นจากงานเชิงคุณภาพ\/ผสมผสาน/)).toBeInTheDocument();
  });

  it("bottom line: themes are counted aside, never in the direction tally", () => {
    render(<Report review={qualitativeReviewFixture} />);
    const summary = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    const tally = within(summary).getByRole("list");
    expect(tally).toHaveTextContent("สนับสนุนผล 2"); // P3 and P4 only, not P1/P2 stored as "positive"
    expect(within(summary).getByText(/งานเชิงคุณภาพหรือแบบผสมผสาน 2 ฉบับ/)).toBeInTheDocument();
  });

  it("paper list, literature matrix and rail show no glyph or direction label for a theme paper", async () => {
    render(<Report review={qualitativeReviewFixture} />);
    const papers = screen.getByRole("heading", { name: "เอกสารอ้างอิง" }).closest("section")!;
    const p1 = within(papers).getByRole("button", { name: /^P1 / });
    expect(glyphsIn(p1)).toHaveLength(0);
    expect(p1).toHaveTextContent("สรุปเป็นประเด็น ไม่มีทิศทางผล");
    expect(glyphsIn(within(papers).getByRole("button", { name: /^P3 / }))).toHaveLength(1);

    const lit = screen.getByRole("table", { name: "ตารางสรุปงานวิจัย" });
    const row = litRow(lit, "P1");
    expect(glyphsIn(row)).toHaveLength(0);
    expect(row).toHaveTextContent("ประเด็น ไม่มีทิศทางผล");
    expect(row).not.toHaveTextContent("สนับสนุนผล");

    await userEvent.click(p1);
    const aside = screen.getByRole("complementary", { name: /ต้นฉบับ/ });
    expect(glyphsIn(aside)).toHaveLength(0);
    expect(aside).not.toHaveTextContent("สนับสนุนผล");
    expect(rail().getByText("ประเด็นจากงานเชิงคุณภาพ ไม่มีค่าตัวเลข")).toBeInTheDocument();
  });

  it("concept map: theme studies form one neutral 'found in k studies' group", () => {
    const tree = conceptTree(qualitativeReviewFixture.result!, "th", "narrative");
    const groups = tree.nodes.filter((n) => n.kind === "group");
    const theme = groups.find((n) => n.theme)!;
    expect(theme.text).toBe("พบใน 2 การศึกษา");
    expect(theme.refs).toEqual(["P1", "P2"]);
    expect(theme.direction).toBeUndefined();
    expect(groups.filter((n) => n.refs?.some((r) => r === "P1" || r === "P2")).every((n) => n.theme)).toBe(true);
    expect(conceptTree(qualitativeReviewFixture.result!, "en", "narrative").nodes.find((n) => n.theme)?.text).toBe("Found in 2 studies");
  });
});

describe("(c) the rail says a number was not extracted unless the paper was flagged as reporting none", () => {
  it("wording", () => {
    expect(noNumberText({ effect_measure: null }, false, "th")).toBe("ไม่ได้สกัดตัวเลข (ดูประโยคต้นฉบับ)");
    expect(noNumberText({ effect_measure: "HR" }, false, "en")).toBe("Number not extracted (see the source sentence)");
    expect(noNumberText({ effect_measure: "none" }, false, "th")).toBe("งานวิจัยไม่ได้รายงานตัวเลขสำหรับผลนี้");
    expect(noNumberText({ effect_measure: "none" }, true, "th")).toBe("ประเด็นจากงานเชิงคุณภาพ ไม่มีค่าตัวเลข");
  });

  it("a quantitative outcome with no extracted number and no flag", async () => {
    render(<Report review={qualitativeReviewFixture} />);
    const papers = screen.getByRole("heading", { name: "เอกสารอ้างอิง" }).closest("section")!;
    await userEvent.click(within(papers).getByRole("button", { name: /^P4 / }));
    expect(rail().getByText("ไม่ได้สกัดตัวเลข (ดูประโยคต้นฉบับ)")).toBeInTheDocument();
    expect(rail().queryByText(/ไม่ได้รายงานตัวเลข/)).toBeNull();
    // the literature matrix says the same
    const row = litRow(screen.getByRole("table", { name: "ตารางสรุปงานวิจัย" }), "P4");
    expect(row).toHaveTextContent("ไม่ได้สกัดตัวเลข");
  });
});

describe("(d) summary and claims prose is plain text", () => {
  it("numbers in the summary and claims carry no verified, computed or tabular styling", () => {
    const { container } = render(<Report review={qualitativeReviewFixture} />);
    const prose = container.querySelector("[data-prose]")!;
    expect(prose).toHaveTextContent("20%");
    const claims = screen.getByRole("heading", { name: "จุดที่ตรงกันและขัดกัน" }).closest("section")!;
    for (const el of [prose, claims]) {
      expect(el.querySelector(".num-verified, .num-computed, .hole, .tabular-nums, .font-num, [data-computed]")).toBeNull();
    }
    expect(screen.getByText(/ข้อความสรุปไม่ใช่ตัวเลขที่ตรวจแล้ว/)).toBeInTheDocument();
  });
});

describe("(e) a meta-analysis that pooled nothing says so", () => {
  it("chip, bottom line, heading, nav and empty state; no computed banner and no 'estimates above'", () => {
    const { container } = render(<Report review={metaNoPoolReviewFixture} />);
    expect(screen.getByLabelText("ข้อมูลรายงาน")).toHaveTextContent("การวิเคราะห์อภิมาน (รวมผลไม่ได้)");
    const summary = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    expect(within(summary).getByText("การวิเคราะห์อภิมาน (รวมผลไม่ได้)")).toBeInTheDocument();
    const section = screen.getByRole("heading", { name: "การวิเคราะห์อภิมาน: รวมผลไม่ได้" }).closest("section")!;
    expect(section).toHaveTextContent(/อย่างน้อย 3 ฉบับต่อผลลัพธ์/);
    expect(section).not.toHaveTextContent("ไม่ใช่ผลจากงานวิจัยฉบับใด");
    expect(section).not.toHaveTextContent("ค่ารวมข้างบน");
    expect(within(section).getByRole("heading", { name: /งานทบทวนอย่างเป็นระบบที่พบ/ })).toBeInTheDocument();
    expect(within(section).getByRole("heading", { name: "ผลที่ไม่ได้นำมารวม" })).toBeInTheDocument();
    // no pooled value anywhere (the only computed numbers are the SoF participant sums)
    expect([...container.querySelectorAll(".num-computed")].filter((el) => !el.closest("[data-participants]"))).toHaveLength(0);
    // the results group holds the not-pooled meta block; its heading says so (the nav names the group)
    expect(section.closest("section[aria-labelledby='h-results']")).not.toBeNull();
  });

  it("English labels", async () => {
    render(<Report review={{ ...metaNoPoolReviewFixture, language: "en", result: { ...metaNoPoolReviewFixture.result!, language: "en" } }} />);
    expect(screen.getByText("Automated · abstracts only · not medical advice")).toBeInTheDocument();
    expect(screen.getByLabelText("Report details")).toHaveTextContent("Meta-analysis (not pooled)");
    expect(screen.getByRole("heading", { name: "Meta-analysis: not pooled" })).toBeInTheDocument();
    expect(screen.queryByText(/estimates above/)).toBeNull();
  });

  it("a meta-analysis with pools keeps the normal chip and banner", () => {
    const { container } = render(<Report review={metaReviewFixture} />);
    expect(container.querySelector("[data-not-pooled]")).toBeNull();
    expect(screen.getByText("คำนวณโดยระบบจากตัวเลขที่ตรวจกับบทคัดย่อแล้ว — ไม่ใช่ผลจากงานวิจัยฉบับใด")).toBeInTheDocument();
    expect(screen.getByText("อาจรวมงานวิจัยหลักชุดเดียวกับค่ารวมข้างบน")).toBeInTheDocument();
  });

  it("pooling that failed (meta_analysis: null) says 'failed', never 'fewer than 3 studies'", () => {
    const failed = { ...metaNoPoolReviewFixture, result: { ...metaNoPoolReviewFixture.result!, meta_analysis: null } };
    const { container } = render(<Report review={failed} />);
    expect(screen.getByLabelText("ข้อมูลรายงาน")).toHaveTextContent("การวิเคราะห์อภิมาน (รวมผลไม่สำเร็จ)");
    const summary = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    const reason = summary.querySelector("[data-not-pooled]")!;
    expect(reason).toHaveAttribute("data-not-pooled", "failed");
    expect(reason).toHaveTextContent("การวิเคราะห์อภิมาน (รวมผลไม่สำเร็จ)");
    expect(reason).not.toHaveTextContent("3 ฉบับ");
    expect(screen.getByRole("heading", { name: "การวิเคราะห์อภิมาน: ค่ารวมไม่สำเร็จ" })).toBeInTheDocument();
    expect(container.querySelector("[data-pool-failed]")).not.toHaveTextContent("3 ฉบับ");
    expect(container.querySelector("[data-no-pools]")).toBeNull();
  });

  it("the shared rule: no pools only when the step ran", () => {
    const base = metaNoPoolReviewFixture.result!;
    expect(metaPoolGap(base)).toBe("none");
    expect(isMetaNotPooled(base)).toBe(true);
    expect(metaPoolGap({ ...base, meta_analysis: null })).toBe("failed");
    expect(isMetaNotPooled({ ...base, meta_analysis: null })).toBe(false);
    expect(metaPoolGap(metaReviewFixture.result)).toBeNull();
    expect(metaPoolGap({ ...base, papers: [] })).toBeNull();
    expect(metaPoolGap(reviewFixture.result)).toBeNull();
  });

  it("an unpooled meta-analysis shows no graded strength bar", () => {
    const { container } = render(<Report review={metaNoPoolReviewFixture} />);
    const summary = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    expect(summary.querySelector("[data-no-bar]")).toHaveTextContent("จากงานแต่ละฉบับ ไม่มีค่ารวม");
    container.remove();
    render(<Report review={metaReviewFixture} />);
    const pooled = screen.getByRole("heading", { name: "คำตอบโดยสรุป" }).closest("section")!;
    expect(pooled.querySelector("[data-no-bar]")).toBeNull();
  });

  it("other review types never show the not-pooled state", () => {
    const { container } = render(<Report review={reviewFixture} />);
    expect(container.querySelector("[data-not-pooled]")).toBeNull();
  });
});

describe("(g) other comparisons and design mismatch are labelled where readers look", () => {
  it("paper list, literature matrix and rail", async () => {
    render(<Report review={qualitativeReviewFixture} />);
    const papers = screen.getByRole("heading", { name: "เอกสารอ้างอิง" }).closest("section")!;
    const p3 = within(papers).getByRole("button", { name: /^P3 / });
    expect(p3).toHaveTextContent("มีการเปรียบเทียบอื่น 1 ผล (ไม่นำไปสรุป)");
    expect(p3).toHaveTextContent("ชนิดงานวิจัยไม่ตรงเกณฑ์ที่เลือก");

    const row = litRow(screen.getByRole("table", { name: "ตารางสรุปงานวิจัย" }), "P3");
    expect(row).toHaveTextContent("ชนิดงานวิจัยไม่ตรงเกณฑ์ที่เลือก");
    expect(row).toHaveTextContent("การเปรียบเทียบอื่น ไม่นำไปสรุป: GLP-1RA vs insulin");

    await userEvent.click(p3);
    expect(rail().getByText("ชนิดงานวิจัยไม่ตรงเกณฑ์ที่เลือก")).toBeInTheDocument();
    expect(rail().getByText(/การเปรียบเทียบอื่น \(ไม่ใช่คำถามของการทบทวน/)).toHaveTextContent("GLP-1RA vs insulin");
  });

  it("a paper whose outcomes are all other comparisons reads 'unclear' and says so", () => {
    const p = qualitativeReviewFixture.result!.papers![2];
    const allOther = { ...p.card!, outcomes: p.card!.outcomes.map((o) => ({ ...o, matches_question: false })) };
    const review = { ...qualitativeReviewFixture, result: { ...qualitativeReviewFixture.result!, papers: [{ ...p, card: allOther, card_en: allOther }] } };
    render(<Report review={review} />);
    const papers = screen.getByRole("heading", { name: "เอกสารอ้างอิง" }).closest("section")!;
    const item = within(papers).getByRole("button", { name: /^P3 / });
    expect(item).toHaveTextContent("การเปรียบเทียบอื่นทั้งหมด (ไม่นำไปสรุป)");
    expect(within(item).getByRole("img", { name: "ไม่ชัด" })).toBeInTheDocument();
  });
});
