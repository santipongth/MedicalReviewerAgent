import { fireEvent, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { DASHBOARD } from "@/test/admin-fixtures";
import { DashboardView } from "./dashboard-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
const drawn = vi.hoisted(() => ({ options: [] as { series: { itemStyle?: { color: string } }[] }[] }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/dashboard" }));
vi.mock("@/components/charts/echart", () => ({
  EChart: ({ label, option }: { label: string; option: (typeof drawn.options)[number] }) => {
    drawn.options.push(option);
    return <div role="img" aria-label={label} />;
  },
}));

// jsdom has no matchMedia, which the site's useTheme subscribes to
beforeEach(() => {
  drawn.options.length = 0;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  nav.replace.mockReset();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

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

  it("redraws the chart in the new theme's colours when the theme is toggled", async () => {
    document.documentElement.style.setProperty("--ink", "#101010");
    mockAdminFetch((m, p) => (p.startsWith("/dashboard") ? [200, DASHBOARD] : undefined));
    await renderAdmin(<DashboardView />);
    await screen.findByRole("img", { name: /จำนวนรีวิวต่อวัน/ });
    expect(drawn.options.at(-1)!.series[0].itemStyle?.color).toBe("#101010");
    // what the site's theme toggle does: set the attribute (the dark tokens apply) and announce it
    act(() => {
      document.documentElement.style.setProperty("--ink", "#ddeae2");
      document.documentElement.setAttribute("data-theme", "dark");
      window.dispatchEvent(new Event("themechange"));
    });
    await waitFor(() => expect(drawn.options.at(-1)!.series[0].itemStyle?.color).toBe("#ddeae2"));
  });

  it("gives the table-view toggle a 44px target and the shared disclosure chevron", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/dashboard") ? [200, DASHBOARD] : undefined));
    await renderAdmin(<DashboardView />);
    const summary = await screen.findByText("ดูเป็นตาราง");
    expect(summary).toHaveClass("min-h-11");
    expect(summary.querySelector("[data-chevron]")).not.toBeNull(); // a flex summary has no native triangle
    expect(summary.closest("details")).toHaveClass("group"); // the chevron turns with group-open
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
