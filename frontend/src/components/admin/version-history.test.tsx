import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { SETTINGS_VERSIONS } from "@/test/admin-runtime-fixtures";
import { VersionHistory } from "./version-history";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/settings" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const props = { kind: "settings" as const, resetLabel: "กลับไปใช้ค่า env", resetHint: "ทุกค่ากลับไปใช้ env",
  emptyText: "ยังไม่มีเวอร์ชันที่บันทึก" };

describe("VersionHistory", () => {
  it("lists versions with their changes and marks the active one", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/settings/versions") ? [200, SETTINGS_VERSIONS] : undefined));
    await renderAdmin(<VersionHistory {...props} base={2} onChanged={() => {}} />);
    const v2 = await screen.findByRole("listitem", { name: "เวอร์ชัน 2" });
    expect(v2).toHaveTextContent("ใช้งานอยู่");
    expect(v2).toHaveTextContent("max_queued_reviews: 50 → 80");
    expect(within(v2).getByText("max_queued_reviews")).toHaveClass("font-code"); // a setting name, as on the edit tab
    expect(v2).toHaveTextContent("busier");
    expect(within(v2).queryByRole("button", { name: /ย้อนกลับ/ })).toBeNull();
  });

  it("restores after the in-page confirm, sends the base version, says so and re-reads the page", async () => {
    const posted: unknown[] = [];
    const onChanged = vi.fn();
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p.startsWith("/settings/versions")) return [200, SETTINGS_VERSIONS];
      if (m === "POST" && p === "/settings/versions/1/restore") {
        posted.push(body);
        return [201, { ...SETTINGS_VERSIONS.items[0], version: 3, source: "restore", restored_from: 1, workers_notified: false }];
      }
    });
    await renderAdmin(<VersionHistory {...props} base={2} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "ย้อนกลับไปเวอร์ชัน 1" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันย้อนกลับ" }));
    expect(await screen.findByText("สร้างเวอร์ชัน 3 จากเวอร์ชัน 1 แล้ว")).toBeInTheDocument();
    expect(screen.getByText(WORKERS_NOT_NOTIFIED)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([{ base_version: 2 }]);
  });

  it("re-reads the page after a 409 so the next try carries the fresh base", async () => {
    const onChanged = vi.fn();
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/settings/versions")) return [200, SETTINGS_VERSIONS];
      if (m === "POST" && p === "/settings/reset") return [409, { detail: "version 4 is in use now; reload the latest version and try again" }];
    });
    await renderAdmin(<VersionHistory {...props} base={2} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "กลับไปใช้ค่า env" }));
    expect(screen.getByText("ทุกค่ากลับไปใช้ env")).toBeInTheDocument(); // the hint, while asking
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน: กลับไปใช้ค่า env" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("version 4 is in use now");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("offers no reset while the default is in use", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/settings/versions") ? [200, { items: [], next: null }] : undefined));
    await renderAdmin(<VersionHistory {...props} base={null} onChanged={() => {}} />);
    expect(await screen.findByText("ยังไม่มีเวอร์ชันที่บันทึก")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "กลับไปใช้ค่า env" })).toBeNull();
  });
});
