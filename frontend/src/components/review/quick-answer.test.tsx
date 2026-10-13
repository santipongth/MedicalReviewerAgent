import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene } from "@/lib/agent-scene";
import { initialRun } from "@/lib/progress";
import type { Review } from "@/lib/types";
import { quickReviewFixture, reviewFixture } from "@/test/fixtures";

const useReview = vi.fn();
vi.mock("@/lib/use-review", () => ({ useReview: (...a: unknown[]) => useReview(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/r/x", useSearchParams: () => new URLSearchParams() }));
vi.mock("./charts", () => ({ Charts: () => <div data-testid="charts" /> }));
vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { QuickAnswer } from "./quick-answer";
import { ReviewScreen } from "./review-screen";

vi.setConfig({ testTimeout: 20_000 });

const english = (r: Review): Review => ({ ...r, language: "en", result: { ...r.result!, language: "en",
  summary: r.result!.synthesis_en!.executive_summary, synthesis: r.result!.synthesis_en } });

describe("Plan 27 quick answer page", () => {
  beforeEach(() => useReview.mockReset());

  it("shows the question, the scope, the answer with numbered citations and the closing line", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2");
    expect(document.querySelector("[data-quick-scope]")).toHaveTextContent("ถามเร็ว · คำตอบสั้นจากบทคัดย่อของงานวิจัย 4 ฉบับ");
    const text = document.querySelector("[data-quick-text]")!;
    expect(text.textContent).toBe("ผู้ใช้เมตฟอร์มินมีความเสี่ยงมะเร็งลำไส้ใหญ่ต่ำกว่า (HR 0.80) [1✓, 2] แต่การศึกษาหนึ่งพบการตรวจพบมากขึ้นในสองปีแรก [3]");
    expect(document.querySelector("[data-quick-closing]")).toHaveTextContent("ความเชื่อมั่นของหลักฐานต่ำ");
  });

  it("sets each sentence of the answer on its own line, the citation group staying with its sentence", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    const lines = [...document.querySelectorAll("[data-quick-text] [data-quick-sentence]")].map((s) => s.textContent);
    expect(lines).toEqual(["ผู้ใช้เมตฟอร์มินมีความเสี่ยงมะเร็งลำไส้ใหญ่ต่ำกว่า (HR 0.80) [1✓, 2]", "แต่การศึกษาหนึ่งพบการตรวจพบมากขึ้นในสองปีแรก [3]"]);
    expect(screen.getByText(/✓ หลังเลขอ้างอิง/)).toBeInTheDocument(); // the legend, since one citation is checked
  });

  it("beside the answer: the certainty meter with the closing line, and the evidence used (counts and direction tally)", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    const certainty = screen.getByRole("region", { name: "ความเชื่อมั่นของหลักฐาน" });
    expect(certainty.querySelector('[data-certainty="low"]')).not.toBeNull();
    expect(within(certainty).getByText("ต่ำ")).toBeInTheDocument();
    expect(certainty.querySelector("[data-quick-closing]")).not.toBeNull();
    const evidence = screen.getByRole("region", { name: "หลักฐานที่ใช้" });
    expect(evidence).toHaveTextContent("อ่าน 4 ฉบับ · อ้างอิง 3 ฉบับ");
    const tally = within(evidence).getByRole("list", { name: "ทิศทางของผลในงานที่อ้างอิง" });
    expect(within(tally).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["สนับสนุนผล2", "ตรงข้าม/อันตราย1"]);
    expect(within(tally).getByRole("img", { name: "ตรงข้าม/อันตราย" })).toBeInTheDocument(); // colour always with its glyph
  });

  it("an ungraded answer shows no meter, only its words", () => {
    const ungraded: Review = { ...quickReviewFixture, result: { ...quickReviewFixture.result!,
      synthesis: { ...quickReviewFixture.result!.synthesis!, evidence_strength: null, answer: "" } } };
    render(<QuickAnswer review={ungraded} />);
    expect(document.querySelector("[data-certainty]")).toBeNull();
    expect(screen.getByRole("region", { name: "ความเชื่อมั่นของหลักฐาน" })).toHaveTextContent("ไม่ได้ประเมินความเชื่อมั่นของหลักฐาน");
  });

  it("each reference shows its design, year, verified sample size (or the not-verified slot) and direction", () => {
    const papers = quickReviewFixture.result!.papers!.map((p) => (p.ref === "P1" ? { ...p,
      card: { ...p.card!, sample_size: null }, card_en: { ...p.card_en!, sample_size: null },
      verification: { ...p.verification!, unverified: [{ field: "sample_size" as const, outcome: null }] } } : p));
    render(<QuickAnswer review={{ ...quickReviewFixture, result: { ...quickReviewFixture.result!, papers } }} />);
    const items = within(screen.getByRole("list", { name: "เอกสารอ้างอิง" })).getAllByRole("listitem");
    const facts = items.map((li) => li.querySelector("[data-quick-facts]")!);
    expect(facts[0]).toHaveTextContent(/Cohort.*2021.*n = 1,234.*สนับสนุนผล/);
    expect(facts[0].querySelector(".num-verified")).toHaveTextContent("1,234");
    expect(facts[1].querySelector(".hole")).not.toBeNull(); // P1: its sample size was blanked
    expect(facts[1].querySelector(".num-verified")).toBeNull();
    expect(facts[2]).toHaveTextContent(/SR\/MA ของงานเชิงสังเกต.*2020.*n = 6,331/);
    expect(within(facts[2] as HTMLElement).getByRole("img", { name: "ตรงข้าม/อันตราย" })).toBeInTheDocument();
  });

  it("a quick answer with no papers shows the message once, no closing line and no certainty level", () => {
    const empty: Review = { ...quickReviewFixture, result: { ...quickReviewFixture.result!, summary: "ไม่พบงานวิจัยที่เกี่ยวข้อง",
      quick: { refs: [], papers_read: 0 }, support: null,
      synthesis: { ...quickReviewFixture.result!.synthesis!, executive_summary: "ไม่พบงานวิจัยที่เกี่ยวข้อง", answer: "",
        evidence_strength: null, grade_baseline: null } } };
    const { container } = render(<QuickAnswer review={empty} />);
    expect(document.querySelector("[data-quick-closing]")).toBeNull();
    expect(container.textContent?.match(/ไม่พบงานวิจัยที่เกี่ยวข้อง/g)).toHaveLength(1);
    expect(container.textContent).not.toMatch(/very_low|ของหลักฐานต่ำมาก/);
    expect(document.querySelector("[data-certainty]")).toBeNull();
  });

  it("links each number to its reference, and marks only a citation the support check passed", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    const one = screen.getByRole("link", { name: "อ้างอิง 1 ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้" });
    expect(one).toHaveAttribute("href", "#qref-1");
    expect(screen.getByRole("link", { name: "อ้างอิง 2" })).toHaveAttribute("href", "#qref-2");
    expect(screen.getByRole("link", { name: "อ้างอิง 3" })).toHaveAttribute("href", "#qref-3");
    expect(document.querySelectorAll("[data-checked]")).toHaveLength(1);
  });

  it("lists the references in citation order with their PubMed, DOI and PMC links", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    const list = screen.getByRole("list", { name: "เอกสารอ้างอิง" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-quick-ref"))).toEqual(["P3", "P1", "P4"]);
    expect(items[0].id).toBe("qref-1");
    expect(items[0]).toHaveTextContent("[1]Lindqvist J, Other A. Metformin use and colorectal cancer risk");
    const hrefs = within(items[0]).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://doi.org/10.1000/p3", "https://pubmed.ncbi.nlm.nih.gov/3000003/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC300003/"]);
    expect(screen.queryByText(/Biguanide exposure/)).toBeNull(); // P2 is not cited
  });

  it("offers a full review of the same question and options", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    const link = screen.getByRole("link", { name: "ทำรีวิวฉบับเต็ม" });
    expect(link.getAttribute("href")).toMatch(/^\/\?q=.+&mode=full&lang=th&year=2015&types=Cohort%7COther%3A\+Delphi\+study#request$/);
  });

  it("keeps the public safety notices: the reader guide and the harms gap", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    expect(document.querySelector('[data-notice="guide"]')).not.toBeNull();
    expect(document.querySelector('[data-notice="harms"]')).not.toBeNull();
    expect(document.querySelector("[data-audience-switch]")).toBeNull(); // one presentation
  });

  it("speaks English for an English answer", () => {
    render(<QuickAnswer review={english(quickReviewFixture)} />);
    expect(document.querySelector("[data-quick-scope]")).toHaveTextContent("Quick answer · A short answer from the abstracts of 4 studies");
    expect(screen.getByRole("link", { name: "Run a full review" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reference 3" })).toHaveAttribute("href", "#qref-3");
    expect(document.documentElement.lang).toBe("en");
  });

  it("says so when the answer cites nothing (no papers found)", () => {
    const empty: Review = { ...quickReviewFixture, result: { ...quickReviewFixture.result!, quick: { refs: [], papers_read: 0 },
      summary: "ไม่พบงานวิจัยที่ตรงกับหัวข้อนี้เพียงพอ", support: null } };
    render(<QuickAnswer review={empty} />);
    expect(screen.getByText("คำตอบนี้ไม่ได้อ้างอิงงานวิจัยใด")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "เอกสารอ้างอิง" })).toBeNull();
  });

  it("is what the review page shows for a finished quick answer; a full review still gets the report", () => {
    const screenState = (review: Review) => ({ review, run: { ...initialRun(), status: "done" as const, terminal: true },
      scene: initialScene(), phase: "report", connection: "closed", retry: vi.fn() });
    useReview.mockReturnValue(screenState(quickReviewFixture));
    const { unmount } = render(<ReviewScreen id="x" />);
    expect(document.querySelector("[data-quick-answer]")).not.toBeNull();
    unmount();
    useReview.mockReturnValue(screenState(reviewFixture));
    render(<ReviewScreen id="x" />);
    expect(document.querySelector("[data-quick-answer]")).toBeNull();
    expect(screen.getAllByRole("navigation", { name: /สารบัญ|ในรายงานนี้/ }).length).toBeGreaterThan(0);
  });
});
