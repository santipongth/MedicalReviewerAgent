import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { AUDIT } from "@/test/admin-fixtures";
import { AuditView } from "./audit-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/audit" }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

describe("AuditView", () => {
  it("shows who did what with the change", async () => {
    mockAdminFetch((m, p) => (p === "/audit" ? [200, AUDIT] : undefined));
    await renderAdmin(<AuditView />);
    expect(await screen.findByText("แก้ไข API key")).toBeInTheDocument();
    expect(screen.getByText("daily_quota: 10 → 100")).toBeInTheDocument();
    expect(screen.getByText("สร้างบัญชีผู้ดูแล")).toBeInTheDocument();
    expect(screen.getByText("username: owner")).toBeInTheDocument();
    expect(screen.getAllByText(/ผู้ดูแล · owner|CLI · cli/)).toHaveLength(2);
  });

  it("pages with the cursor", async () => {
    mockAdminFetch((m, p) => {
      if (p === "/audit") return [200, { items: [AUDIT.items[0]], next: 2 }];
      if (p === "/audit?before=2") return [200, { items: [AUDIT.items[1]], next: null }];
    });
    await renderAdmin(<AuditView />);
    fireEvent.click(await screen.findByRole("button", { name: "โหลดเพิ่ม" }));
    expect(await screen.findByText("สร้างบัญชีผู้ดูแล")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "โหลดเพิ่ม" })).not.toBeInTheDocument();
  });

  it("moves focus to the first entry loaded when the button it was on goes away", async () => {
    mockAdminFetch((m, p) => {
      if (p === "/audit") return [200, { items: [AUDIT.items[0]], next: 2 }];
      if (p === "/audit?before=2") return [200, { items: [AUDIT.items[1]], next: null }];
    });
    await renderAdmin(<AuditView />);
    fireEvent.click(await screen.findByRole("button", { name: "โหลดเพิ่ม" }));
    await waitFor(() => expect(screen.getByText("สร้างบัญชีผู้ดูแล").closest("li")).toHaveFocus());
  });

  it("says so when there is nothing yet", async () => {
    mockAdminFetch((m, p) => (p === "/audit" ? [200, { items: [], next: null }] : undefined));
    await renderAdmin(<AuditView />);
    expect(await screen.findByText("ยังไม่มีรายการ")).toBeInTheDocument();
  });
});
