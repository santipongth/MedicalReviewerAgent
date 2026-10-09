import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialScene, reduceScene, type Scene } from "@/lib/agent-scene";
import type { ReviewEvent } from "@/lib/types";
import { ThoughtCard } from "./thought-card";

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
const sceneOf = (...evs: ReviewEvent[]): Scene => evs.reduce((s, e) => reduceScene(s, { kind: "event", ev: e }), initialScene());
const START = [ev(1, "queued", { topic: "t" }), ev(2, "started", {})];

describe("ThoughtCard", () => {
  it("waiting", () => {
    render(<ThoughtCard scene={sceneOf(ev(1, "queued", { topic: "t" }))} />);
    expect(screen.getByText("เอเจนต์กำลังทำ")).toBeInTheDocument();
    expect(screen.getByText(/รอคิว/)).toBeInTheDocument();
    expect(screen.getByText("เอเจนต์จะเริ่มทำงานเมื่อถึงคิว")).toBeInTheDocument();
    expect(screen.getByText("จากเหตุการณ์จริงของรีวิวนี้")).toBeInTheDocument();
  });

  it("search shows the first queries and the rest count, with a start time", () => {
    render(<ThoughtCard scene={sceneOf(...START, ev(3, "planning", { queries: ["q one", "q two", "q three"], elapsed_s: 17.4 }))} />);
    expect(screen.getByText(/ค้นฐานข้อมูล/)).toBeInTheDocument();
    expect(screen.getByText("q one")).toBeInTheDocument();
    expect(screen.getByText("และอีก 1 คำค้น")).toBeInTheDocument();
    expect(screen.getByText(/เริ่ม 0:17/)).toBeInTheDocument();
  });

  it("read with a finished paper shows glyph, as-read direction and the uncertain flag", () => {
    const scene = sceneOf(
      ...START,
      ev(3, "screened", { kept: 2, total: 5 }),
      ev(4, "reading", { ref: "P1", title: "Cohort of metformin" }), ev(5, "reading", { ref: "P2", title: "Other" }),
      ev(6, "extracted", { ref: "P1", ok: true, verified: 2, uncertain: true, direction: "positive", design: "rct" }),
    );
    render(<ThoughtCard scene={scene} />);
    expect(screen.getByText(/อ่านเสร็จ 1 จาก 2 ฉบับ/)).toBeInTheDocument();
    expect(screen.getByText("Cohort of metformin")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /.+/ })).toBeInTheDocument(); // the Glyph
    expect(screen.getByText(/ตามที่เอเจนต์อ่าน/)).toBeInTheDocument();
    expect(screen.getByText("สองโมเดลอ่านต่างกัน")).toBeInTheDocument();
    expect(screen.getByText("ตรวจตัวเลขผ่าน 2 ค่า")).toBeInTheDocument();
  });

  it("synth appends the no-progress caption once", () => {
    render(<ThoughtCard scene={sceneOf(...START, ev(3, "synthesizing", { papers: 3 }))} />);
    expect(screen.getAllByText(/ขั้นนี้ไม่มีความคืบหน้าให้ดู/)).toHaveLength(1);
  });

  it("is a labelled region without live semantics", () => {
    const { container } = render(<ThoughtCard scene={sceneOf(...START, ev(3, "checking_topic", {}))} />);
    expect(container.querySelector('[aria-labelledby="h-thought"]')).not.toBeNull();
    expect(container.querySelector("#h-thought")).toHaveTextContent("เอเจนต์กำลังทำ");
    expect(container.querySelector("[aria-live], [role=status]")).toBeNull();
  });

  it("renders nothing for terminal states", () => {
    const { container } = render(<ThoughtCard scene={sceneOf(...START, ev(3, "error", { message: "x" }))} />);
    expect(container).toBeEmptyDOMElement();
  });
});
