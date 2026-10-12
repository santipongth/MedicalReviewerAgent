import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { AdminGate } from "@/components/admin/admin-gate";

export const ME = { kind: "user", label: "owner" };

/** [status, body?, headers?]; undefined falls through to GET /me (signed in) or a 404. */
export type AdminReply = [number, unknown?, Record<string, string>?];
export type AdminHandler = (method: string, path: string, body: unknown) => AdminReply | undefined;

/** Stubs fetch for the admin API. `path` is relative to /api/v1/admin and keeps its query string. */
export function mockAdminFetch(handler: AdminHandler = () => undefined) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://site.test");
    const path = url.pathname.replace(/^\/api\/v1\/admin/, "") + url.search;
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const [status, payload, headers] = handler(method, path, body)
      ?? (method === "GET" && path === "/me" ? [200, ME] : [404, { detail: `no mock for ${method} ${path}` }]);
    return new Response(status === 204 ? null : JSON.stringify(payload ?? {}), {
      status, headers: { "Content-Type": "application/json", ...headers },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Renders inside the real gate (GET /me answered by the mock) and waits for the admin nav. */
export async function renderAdmin(ui: ReactElement) {
  const result = render(<AdminGate>{ui}</AdminGate>);
  await screen.findByRole("navigation", { name: "ผู้ดูแลระบบ" });
  return result;
}
