import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessState } from "@/lib/admin-types";
import type { AdminReply } from "@/test/admin-fetch";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { COMPARE, HARNESS, REPORTS, REPORT_TEXT, RESULTS, RUN, RUN_DONE } from "@/test/admin-runtime-fixtures";
import { HarnessReport } from "./harness-report";
import { HarnessView, plannedRuns } from "./harness-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/harness" }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); nav.replace.mockReset(); });

const ACTIVE: HarnessState = { ...HARNESS, available: false, reasons: ["active_run"], active: RUN };
const routes = (state: HarnessState = HARNESS) => (m: string, p: string): AdminReply | undefined => {
  if (m !== "GET") return undefined;
  if (p === "/harness") return [200, state];
  if (p.startsWith("/harness/runs")) return [200, { items: [RUN_DONE], next: null }];
  if (p === "/harness/reports") return [200, { items: REPORTS }];
  if (p.startsWith("/harness/reports/")) return [200, { name: REPORTS[0].name, text: REPORT_TEXT }];
  if (p === "/harness/results") return [200, { items: RESULTS }];
  if (p.startsWith("/harness/compare")) return [200, COMPARE];
  return undefined;
};

describe("plannedRuns", () => {
  it("counts the chosen strata's frozen reviews, capped, times the repeats", () => {
    expect(plannedRuns(HARNESS, [], null, 2)).toBe(6);
    expect(plannedRuns(HARNESS, ["cv"], 2, 1)).toBe(2);
    expect(plannedRuns(HARNESS, ["renal"], null, 2)).toBe(0);
  });
});

describe("HarnessReport", () => {
  it("renders the report as elements and never as HTML", () => {
    const { container } = render(<HarnessReport text={REPORT_TEXT} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByRole("row", { name: /Batch cost/ })).toHaveTextContent("$3.90");
  });

  it("keeps links, images and handlers as plain text: the reader makes no anchors and no raw elements", () => {
    const hostile = [
      "# [heading](javascript:alert(1))", "",
      "[click](javascript:alert(1)) <a href=\"javascript:alert(2)\">x</a> <img src=x onerror=alert(3)>", "",
      "- <iframe src=\"https://evil.test\"></iframe> and ![i](https://evil.test/p.png)", "",
      "| a | b |", "|---|---|", "| <svg onload=alert(4)> | [t](data:text/html,x) |",
    ].join("\n");
    const { container } = render(<HarnessReport text={hostile} />);
    expect(container.querySelector("a, img, iframe, svg, script, [onerror], [onload], [href], [src]")).toBeNull();
    expect(container).toHaveTextContent("[click](javascript:alert(1))");
    expect(container).toHaveTextContent("<img src=x onerror=alert(3)>");
    expect(screen.getByRole("region", { name: "ตารางที่ 1 ในรายงาน" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("columnheader", { name: "a" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "<svg onload=alert(4)>" })).toBeInTheDocument();
  });
});

describe("HarnessView", () => {
  it("explains why it cannot start and keeps the start button disabled", async () => {
    mockAdminFetch(routes({ ...HARNESS, available: false, reasons: ["no_worker", "no_fixtures"] }));
    await renderAdmin(<HarnessView />);
    expect(await screen.findByText("ยังเริ่มรันไม่ได้")).toBeInTheDocument();
    expect(screen.getByText(/harness worker ไม่ทำงาน/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เริ่มรัน harness" })).toBeDisabled();
  });

  it("estimates the run and starts it only after the acknowledgement and the confirm", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/harness/runs") { posted.push(body); return [201, { ...RUN, status: "queued" }]; }
      return routes()(m, p);
    });
    await renderAdmin(<HarnessView />);
    await screen.findByText("พร้อมเริ่มรัน");
    fireEvent.click(screen.getByRole("checkbox", { name: /cv · 3/ }));
    fireEvent.click(screen.getByRole("radio", { name: "1 รอบ" }));
    expect(screen.getByText(/ประมาณการ: 3 รอบ/)).toHaveTextContent("กรณีมากที่สุด $0.840");
    const start = screen.getByRole("button", { name: "เริ่มรัน harness" });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /เข้าใจว่าการรันนี้เรียกโมเดลจริง/ }));
    fireEvent.click(start);
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน เริ่มรันและใช้เงินจริง" }));
    expect(await screen.findByText(/เริ่มรัน console-20261013-100000-a1b2 แล้ว/)).toBeInTheDocument();
    expect(posted).toEqual([{ max_usd: 1, repeats: 1, strata: ["cv"], max_reviews: null, compare_run: null, confirm: true }]);
  });

  it("refuses a cap outside the per-review cap and the ceiling", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<HarnessView />);
    fireEvent.change(await screen.findByLabelText("งบสูงสุด (USD)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /เข้าใจว่าการรันนี้เรียกโมเดลจริง/ }));
    expect(screen.getByText("งบต้องอยู่ระหว่าง $0.280 ถึง $5.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เริ่มรัน harness" })).toBeDisabled();
  });

  it("shows the active run's progress and cancels it after the confirm", async () => {
    let cancelled = false;
    mockAdminFetch((m, p) => {
      if (m === "POST" && p === `/harness/runs/${RUN.id}/cancel`) { cancelled = true; return [200, { ...RUN, status: "cancelled" }]; }
      return routes(cancelled ? HARNESS : ACTIVE)(m, p);
    });
    await renderAdmin(<HarnessView />);
    expect(await screen.findByText(/เสร็จ 2 · ล้มเหลว 0 · ข้าม 0 จาก 6/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกการรัน" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันยกเลิก" }));
    expect(await screen.findByText(/ยกเลิกแล้ว รีวิวที่กำลังทำอยู่/)).toBeInTheDocument();
  });

  it("polls every 5 seconds while a run is active", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let done = 2;
    const fn = mockAdminFetch((m, p) => routes({ ...ACTIVE, active: { ...RUN, done } })(m, p));
    await renderAdmin(<HarnessView />);
    await screen.findByText(/เสร็จ 2 ·/);
    done = 4;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(await screen.findByText(/เสร็จ 4 ·/)).toBeInTheDocument();
    expect(fn.mock.calls.filter(([u]) => String(u).endsWith("/api/v1/admin/harness")).length).toBeGreaterThanOrEqual(2);
  });

  it("opens a report as text and compares two runs", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<HarnessView />);
    fireEvent.click(await screen.findByRole("button", { name: REPORTS[0].name }));
    expect(await screen.findByRole("heading", { name: "Cochrane harness report: 2026-10-11.1 (run baseline)" })).toBeInTheDocument();
    expect(document.querySelector("main script, section script")).toBeNull();
    fireEvent.change(screen.getByLabelText("รุ่น A"), { target: { value: RESULTS[0].label } });
    fireEvent.change(screen.getByLabelText("รุ่น B"), { target: { value: RESULTS[1].label } });
    fireEvent.click(screen.getByRole("button", { name: "เทียบ" }));
    const row = await screen.findByRole("row", { name: /Batch cost.*\$0\.40/ });
    expect(row).toHaveTextContent("$3.90");
    expect(screen.getByText("CD1: consensus:positive → none")).toBeInTheDocument();
  });

  it("shows a stopped run's error text as well as an errored run's", async () => {
    const stopped = { ...RUN_DONE, id: 5, run_id: "console-20261011-080000-e5f6", status: "stopped" as const, report: null,
      error: "the in-flight marker could not be read" };
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/harness/runs")) return [200, { items: [RUN_DONE, stopped], next: null }];
      return routes()(m, p);
    });
    await renderAdmin(<HarnessView />);
    const table = await screen.findByRole("table", { name: "การรันจากหน้านี้" });
    const stoppedRow = within(table).getByRole("row", { name: /e5f6/ });
    expect(stoppedRow).toHaveTextContent("หยุดเพราะถึงงบ");
    expect(stoppedRow).toHaveTextContent("the in-flight marker could not be read");
    expect(within(table).getByRole("row", { name: /c3d4/ })).not.toHaveTextContent("in-flight");
  });

  it("lists why a start is unavailable when the start answers 503 with reasons", async () => {
    mockAdminFetch((m, p) => {
      if (m === "POST" && p === "/harness/runs") {
        return [503, { detail: "the harness cannot start a run now: no_worker, stub_mode", reasons: ["no_worker", "stub_mode"] }];
      }
      return routes()(m, p);
    });
    await renderAdmin(<HarnessView />);
    await screen.findByText("พร้อมเริ่มรัน");
    fireEvent.click(screen.getByRole("checkbox", { name: /เข้าใจว่าการรันนี้เรียกโมเดลจริง/ }));
    fireEvent.click(screen.getByRole("button", { name: "เริ่มรัน harness" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน เริ่มรันและใช้เงินจริง" }));
    const alert = await screen.findByRole("alert");
    const items = within(alert).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/harness worker ไม่ทำงาน/);
    expect(items[1]).toHaveTextContent(/GRAPH_MODE=stub/);
    expect(alert).not.toHaveTextContent("เกิดข้อผิดพลาด (503)");
  });

  it("shows the queue's own fixed text when a 503 has no reasons", async () => {
    mockAdminFetch((m, p) => {
      if (m === "POST" && p === "/harness/runs") return [503, { detail: "the harness queue is unavailable; try again", reasons: [] }];
      return routes()(m, p);
    });
    await renderAdmin(<HarnessView />);
    await screen.findByText("พร้อมเริ่มรัน");
    fireEvent.click(screen.getByRole("checkbox", { name: /เข้าใจว่าการรันนี้เรียกโมเดลจริง/ }));
    fireEvent.click(screen.getByRole("button", { name: "เริ่มรัน harness" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน เริ่มรันและใช้เงินจริง" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("the harness queue is unavailable; try again");
  });

  it("puts a 422 start's field errors beside the fields they name and clears them when a field is edited", async () => {
    mockAdminFetch((m, p) => {
      if (m === "POST" && p === "/harness/runs") {
        return [422, { detail: "invalid", errors: [
          { field: "max_usd", message: "the cap is above the ceiling" },
          { field: "confirm", message: "confirm must be true" },
          { field: null, message: "nothing to run" }] }];
      }
      return routes()(m, p);
    });
    await renderAdmin(<HarnessView />);
    await screen.findByText("พร้อมเริ่มรัน");
    fireEvent.click(screen.getByRole("checkbox", { name: /เข้าใจว่าการรันนี้เรียกโมเดลจริง/ }));
    fireEvent.click(screen.getByRole("button", { name: "เริ่มรัน harness" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน เริ่มรันและใช้เงินจริง" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ข้อมูลที่ส่งไม่ถูกต้อง");
    expect(within(alert).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["nothing to run"]);
    const cap = screen.getByLabelText("งบสูงสุด (USD)");
    expect(cap).toHaveAccessibleDescription("the cap is above the ceiling");
    expect(cap).toBeInvalid();
    expect(screen.getByRole("checkbox", { name: /เข้าใจว่าการรันนี้เรียกโมเดลจริง/ })).toHaveAccessibleDescription("confirm must be true");
    fireEvent.change(cap, { target: { value: "2" } });
    expect(screen.queryByText("the cap is above the ceiling")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the compare route's own 404 text, and the generic one when the 404 is not the route's", async () => {
    let reply: AdminReply = [404, { detail: "no run files for run b" }];
    mockAdminFetch((m, p) => (m === "GET" && p.startsWith("/harness/compare") ? reply : routes()(m, p)));
    await renderAdmin(<HarnessView />);
    await screen.findByText("พร้อมเริ่มรัน");
    fireEvent.change(screen.getByLabelText("รุ่น A"), { target: { value: RESULTS[0].label } });
    fireEvent.change(screen.getByLabelText("รุ่น B"), { target: { value: RESULTS[1].label } });
    fireEvent.click(screen.getByRole("button", { name: "เทียบ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no run files for run b");
    expect(screen.queryByText("ไม่พบรายการนี้แล้ว")).not.toBeInTheDocument();

    reply = [404, { detail: "the harness manifest is missing" }];
    fireEvent.click(screen.getByRole("button", { name: "เทียบ" }));
    expect(await screen.findByText("the harness manifest is missing")).toBeInTheDocument();
    expect(screen.queryByText("no run files for run b")).not.toBeInTheDocument();

    reply = [404, {}]; // a proxy's 404 carries no route text
    fireEvent.click(screen.getByRole("button", { name: "เทียบ" }));
    expect(await screen.findByText("ไม่พบรายการนี้แล้ว")).toBeInTheDocument();
  });

  it("shows a report's own 404 text beside the reports", async () => {
    mockAdminFetch((m, p) => (m === "GET" && p.startsWith("/harness/reports/")
      ? [404, { detail: "no such report (or it is over 1 MB)" }] : routes()(m, p)));
    await renderAdmin(<HarnessView />);
    fireEvent.click(await screen.findByRole("button", { name: REPORTS[0].name }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no such report (or it is over 1 MB)");
  });
});
