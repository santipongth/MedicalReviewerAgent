import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialScene, reduceScene, type Scene } from "@/lib/agent-scene";
import { liveTally } from "@/lib/live-evidence";
import type { ReviewEvent } from "@/lib/types";
import { EvidenceBoard } from "./evidence-board";

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
const apply = (s: Scene, ...evs: ReviewEvent[]): Scene => evs.reduce((a, e) => reduceScene(a, { kind: "event", ev: e }), s);
const START = [ev(1, "queued", { topic: "t" }), ev(2, "started", {}), ev(3, "screened", { kept: 6, total: 9 })];
const reading = (n: number) => Array.from({ length: n }, (_, i) => ev(4 + i, "reading", { ref: `P${i + 1}`, title: `Paper ${i + 1}` }));
const ext = (seq: number, ref: string, p: Record<string, unknown>) => ev(seq, "extracted", { ref, ok: true, verified: 1, uncertain: false, ...p });

const base = () => apply(initialScene(), ...START, ...reading(6));
const full = () => apply(base(),
  ext(20, "P1", { direction: "positive", design: "rct" }),
  ext(21, "P2", { direction: "positive", design: "cohort" }),
  ext(22, "P3", { direction: "null", design: "sr_ma_rct" }),
  ext(23, "P4", { direction: "mixed", uncertain: true }),
  ext(24, "P5", {}),
  ext(25, "P6", { ok: false }),
);

describe("EvidenceBoard", () => {
  it("renders nothing without slots", () => {
    const { container } = render(<EvidenceBoard scene={initialScene()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("empty state before any paper finished", () => {
    render(<EvidenceBoard scene={base()} />);
    expect(screen.getByText("ยังไม่มีงานที่อ่านเสร็จ")).toBeInTheDocument();
    expect(screen.getByText("อ่านเสร็จ 0/6")).toBeInTheDocument();
  });

  it("counts per direction match liveTally; the string null lands under no association", () => {
    const scene = full();
    const { container } = render(<EvidenceBoard scene={scene} />);
    const tally = liveTally(scene);
    for (const d of ["positive", "negative", "null", "mixed", "unclear"] as const) {
      const li = container.querySelector(`[data-evidence-dir="${d}"]`)!;
      expect(li.getAttribute("data-count")).toBe(String(tally.groups[d].length));
    }
    const nullLi = container.querySelector('[data-evidence-dir="null"]')!;
    expect(nullLi).toHaveTextContent("ไม่มีความสัมพันธ์");
    expect(nullLi.getAttribute("data-count")).toBe("1");
    expect(screen.getByText("อ่านเสร็จ 6/6")).toBeInTheDocument();
  });

  it("notes: missing direction, failed, uncertain, SR/MA overlap", () => {
    render(<EvidenceBoard scene={full()} />);
    expect(screen.getByText("อีก 1 ฉบับอ่านเสร็จแต่ไม่มีข้อมูลทิศทาง")).toBeInTheDocument();
    expect(screen.getByText("อ่านไม่สำเร็จ 1 ฉบับ (ไม่นับ)")).toBeInTheDocument();
    expect(screen.getByText(/มี 1 ฉบับที่/)).toBeInTheDocument();
    expect(screen.getByText(/ซ้อนกับงานวิจัยหลัก/)).toBeInTheDocument();
  });

  it("SR/MA note only with sr_ma designs", () => {
    render(<EvidenceBoard scene={apply(base(), ext(20, "P1", { direction: "positive", design: "rct" }))} />);
    expect(screen.queryByText(/ซ้อนกับงานวิจัยหลัก/)).toBeNull();
  });

  it("toggle flips aria-expanded and the detail classes", () => {
    render(<EvidenceBoard scene={full()} />);
    const btn = screen.getByRole("button", { name: "ดูรายฉบับ" });
    const detail = document.getElementById(btn.getAttribute("aria-controls")!)!;
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(detail.className).toContain("hidden lg:grid");
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "ซ่อนรายฉบับ" })).toHaveAttribute("aria-expanded", "true");
    expect(detail.className).not.toContain("hidden");
    expect(detail.className).toContain("grid");
  });

  it("chips present at mount do not animate; a later chip does", () => {
    const { container, rerender } = render(<EvidenceBoard scene={full()} />);
    expect(container.querySelectorAll('[data-evidence-chip]').length).toBe(4);
    expect(container.innerHTML).not.toContain("evidence-in");
    rerender(<EvidenceBoard scene={apply(full(), ev(30, "reading", { ref: "P7", title: "x" }), ext(31, "P7", { direction: "negative" }))} />);
    const chip = container.querySelector('[data-evidence-chip="P7"]')!;
    expect(chip.className).toContain("evidence-in");
    expect(container.querySelector('[data-evidence-chip="P1"]')!.className).not.toContain("evidence-in");
  });

  it("is not a live region and gives no column special styling", () => {
    const { container } = render(<EvidenceBoard scene={full()} />);
    expect(container.querySelector("[aria-live]")).toBeNull();
    const cls = [...container.querySelectorAll("[data-evidence-dir]")].map((n) => n.className);
    expect(new Set(cls.filter((c) => !c.includes("text-muted"))).size).toBe(1);
    expect(container.textContent).not.toMatch(/%/);
  });
});
