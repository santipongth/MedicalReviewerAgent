import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { DASHBOARD } from "@/test/admin-fixtures";
import { DashboardView } from "./dashboard-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/dashboard" }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

describe("DashboardView", () => {
  it("shows totals, capacity against its caps, the chart, its table twin and cost by synthesizer", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/dashboard") ? [200, DASHBOARD] : undefined));
    await renderAdmin(<DashboardView />);
    expect(await screen.findByText("$0.520")).toBeInTheDocument();
    expect(screen.getByText("12.5%")).toBeInTheDocument();
    expect(screen.getByText("รับรีวิวใหม่อยู่")).toBeInTheDocument();
    expect(screen.getByText("5 / 500")).toBeInTheDocument();
    expect(screen.getByText("$0.400 / $10.00")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /จำนวนรีวิวต่อวัน/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /รายวัน/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /synthesizer/ })).toHaveTextContent("openrouter:qwen/qwen3.5-flash-02-23");
  });

  it("explains the unknown synthesizer bucket as reviews that recorded no model", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/dashboard") ? [200, DASHBOARD] : undefined));
    await renderAdmin(<DashboardView />);
    const table = await screen.findByRole("table", { name: /synthesizer/ });
    expect(table).toHaveTextContent("ไม่ได้บันทึกโมเดล (รีวิวที่ไม่เสร็จ เช่น ผิดพลาด ถูกปฏิเสธ หรือยกเลิก)");
    expect(table).not.toHaveTextContent(/\bunknown\b/);
    expect(table).toHaveTextContent("$0.020");
  });

  it("refetches for another range", async () => {
    const fetch = mockAdminFetch((m, p) => (p.startsWith("/dashboard") ? [200, DASHBOARD] : undefined));
    await renderAdmin(<DashboardView />);
    await screen.findByText("$0.520");
    fireEvent.change(screen.getByLabelText("ช่วงเวลา"), { target: { value: "7" } });
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u) === "/api/v1/admin/dashboard?days=7")).toBe(true));
  });

  it("says when the service is not accepting reviews, with the reason", async () => {
    const closed = { ...DASHBOARD, capacity: { ...DASHBOARD.capacity, accepting: false, reason: "daily_capacity" } };
    mockAdminFetch((m, p) => (p.startsWith("/dashboard") ? [200, closed] : undefined));
    await renderAdmin(<DashboardView />);
    expect(await screen.findByText(/ไม่รับรีวิวใหม่ตอนนี้/)).toHaveTextContent("daily_capacity");
  });

  it("shows a failure as an alert", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/dashboard") ? [500, { detail: "boom" }] : undefined));
    await renderAdmin(<DashboardView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("(500)");
  });
});
