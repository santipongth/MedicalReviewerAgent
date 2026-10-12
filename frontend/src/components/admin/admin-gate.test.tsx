import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin-api";
import { NOT_BEHIND_SITE } from "@/lib/admin-copy";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { AdminGate, useAdmin } from "./admin-gate";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/keys" }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

function ExpiresOnClick() {
  const { fail } = useAdmin();
  return <button type="button" onClick={() => fail(new AdminApiError(401, "sign in required"))}>ทำรายการ</button>;
}

describe("AdminGate", () => {
  it("shows the nav, the current page and the signed-in admin", async () => {
    mockAdminFetch();
    await renderAdmin(<p>เนื้อหา</p>);
    expect(screen.getByText("เนื้อหา")).toBeInTheDocument();
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "API keys" })).toHaveAttribute("aria-current", "page");
  });

  it("sends a signed-out visitor to the sign-in page", async () => {
    mockAdminFetch(() => [401, { detail: "sign in required" }]);
    render(<AdminGate><p>secret</p></AdminGate>);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/admin"));
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("explains a missing admin API (not behind the site address)", async () => {
    mockAdminFetch(() => [404, { detail: "Not Found" }]);
    render(<AdminGate><p>secret</p></AdminGate>);
    expect(await screen.findByRole("alert")).toHaveTextContent(NOT_BEHIND_SITE);
  });

  it("sends the admin back to sign-in when a later call finds the session expired", async () => {
    mockAdminFetch();
    await renderAdmin(<ExpiresOnClick />);
    fireEvent.click(screen.getByRole("button", { name: "ทำรายการ" }));
    expect(nav.replace).toHaveBeenCalledWith("/admin?expired=1");
  });

  it("signs out and returns to the sign-in page", async () => {
    const fetch = mockAdminFetch((m, p) => (m === "DELETE" && p === "/session" ? [204] : undefined));
    await renderAdmin(<p>เนื้อหา</p>);
    fireEvent.click(screen.getByRole("button", { name: "ออกจากระบบ" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/admin"));
    expect(fetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(true);
  });
});
