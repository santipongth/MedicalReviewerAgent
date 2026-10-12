import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch } from "@/test/admin-fetch";
import { NOT_BEHIND_SITE } from "@/lib/admin-copy";
import { SignInForm } from "./sign-in-form";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin" }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); window.history.replaceState(null, "", "/"); });

function fill(username: string, password: string) {
  fireEvent.change(screen.getByLabelText("ชื่อผู้ใช้"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("รหัสผ่าน"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
}

describe("SignInForm", () => {
  it("signs in and goes to the dashboard", async () => {
    let signedIn = false;
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/me") return signedIn ? [200, { kind: "user", label: "owner" }] : [401, { detail: "sign in required" }];
      if (m === "POST" && p === "/session") { signedIn = true; return [204]; }
    });
    render(<SignInForm />);
    fill("owner", "correct horse battery staple");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/admin/dashboard"));
  });

  it("says the credentials are wrong and clears the password", async () => {
    mockAdminFetch((m, p) => (p === "/me" ? [401, {}] : m === "POST" ? [401, { detail: "invalid username or password" }] : undefined));
    render(<SignInForm />);
    fill("owner", "wrong password");
    expect(await screen.findByRole("alert")).toHaveTextContent("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    expect(screen.getByLabelText("รหัสผ่าน")).toHaveValue("");
  });

  it("shows the lockout wait", async () => {
    mockAdminFetch((m, p) => (p === "/me" ? [401, {}] : [429, { detail: "locked" }, { "Retry-After": "300" }]));
    render(<SignInForm />);
    fill("owner", "whatever password");
    expect(await screen.findByRole("alert")).toHaveTextContent("ลองใหม่ได้ในอีก 5 นาที");
  });

  it("explains when the page is not behind the site address", async () => {
    mockAdminFetch(() => [404, { detail: "Not Found" }]);
    render(<SignInForm />);
    expect(await screen.findByRole("alert")).toHaveTextContent(NOT_BEHIND_SITE);
  });

  it("says the session expired when sent back from the console", async () => {
    window.history.replaceState(null, "", "/admin?expired=1");
    mockAdminFetch((_, p) => (p === "/me" ? [401, {}] : undefined));
    render(<SignInForm />);
    expect(await screen.findByRole("status")).toHaveTextContent("หมดเวลาเข้าสู่ระบบ");
  });
});
