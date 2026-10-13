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
