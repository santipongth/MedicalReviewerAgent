import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { KEYS } from "@/test/admin-fixtures";
import { KeysView } from "./keys-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/keys" }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const MINTED = { ...KEYS[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", key_prefix: "mra_newnewne", name: "new lab",
  daily_quota: 20, reviews_24h: 0, key: "mra_newnewnewSECRETSECRETSECRET" };

/** Fills the mint form and submits it. */
function mintNewLab() {
  fireEvent.change(screen.getByLabelText("ชื่อ key"), { target: { value: "new lab" } });
  fireEvent.change(screen.getByLabelText("โควตาต่อวัน"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "สร้าง key" }));
}

describe("KeysView", () => {
  it("lists keys with prefix, quota and use", async () => {
    mockAdminFetch((m, p) => (m === "GET" && p === "/keys" ? [200, KEYS] : undefined));
    await renderAdmin(<KeysView />);
    const row = await screen.findByRole("row", { name: /partner lab/ });
    expect(row).toHaveTextContent("mra_abcdefgh");
    expect(row).toHaveTextContent("100");
    expect(row).toHaveTextContent("ใช้งานอยู่");
  });

  it("shows a dash for an old key without a prefix", async () => {
    mockAdminFetch((m, p) => (m === "GET" && p === "/keys" ? [200, [{ ...KEYS[0], key_prefix: null }]] : undefined));
    await renderAdmin(<KeysView />);
    expect(await screen.findByRole("row", { name: /partner lab/ })).toHaveTextContent("—");
  });

  it("mints a key, shows it once, and forgets it when closed", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "POST" && p === "/keys") { posted.push(body); return [201, MINTED]; }
    });
    await renderAdmin(<KeysView />);
    await screen.findByRole("row", { name: /partner lab/ });
    mintNewLab();
    expect(await screen.findByText(MINTED.key)).toBeInTheDocument();
    expect(screen.getByText(/แสดงครั้งเดียว/)).toBeInTheDocument();
    expect(posted).toEqual([{ name: "new lab", daily_quota: 20, is_admin: false }]);
    expect(screen.getByRole("row", { name: /new lab/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "เก็บแล้ว ปิด" }));
    expect(screen.queryByText(MINTED.key)).not.toBeInTheDocument();
  });

  it("mints once however many times the button is pressed", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "POST" && p === "/keys") { posted.push(body); return [201, MINTED]; }
    });
    await renderAdmin(<KeysView />);
    await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.change(screen.getByLabelText("ชื่อ key"), { target: { value: "new lab" } });
    const create = screen.getByRole("button", { name: "สร้าง key" });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(await screen.findByText(MINTED.key)).toBeInTheDocument();
    expect(posted).toHaveLength(1);
  });

  it("moves focus to the shown-once panel after a mint, and back to the name field when it is closed", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "POST" && p === "/keys") return [201, MINTED];
    });
    await renderAdmin(<KeysView />);
    await screen.findByRole("row", { name: /partner lab/ });
    mintNewLab();
    await waitFor(() => expect(screen.getByRole("group", { name: /แสดงครั้งเดียว/ })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "เก็บแล้ว ปิด" }));
    await waitFor(() => expect(screen.getByLabelText("ชื่อ key")).toHaveFocus());
  });

  it("edits the quota inline", async () => {
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "PATCH") return [200, { ...KEYS[0], ...(body as object) }];
    });
    await renderAdmin(<KeysView />);
    const row = await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.click(within(row).getByRole("button", { name: "แก้ไข" }));
    fireEvent.change(within(row).getByLabelText("โควตาต่อวันของ partner lab"), { target: { value: "250" } });
    fireEvent.click(within(row).getByRole("button", { name: "บันทึก" }));
    // the saved row is a new element (its key changes), so look it up again instead of searching inside the old one
    await waitFor(() => expect(within(screen.getByRole("row", { name: /partner lab/ })).getByText("250")).toBeInTheDocument());
  });

  it("moves focus to the notice after a saved edit remounts the row", async () => {
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "PATCH") return [200, { ...KEYS[0], ...(body as object) }];
    });
    await renderAdmin(<KeysView />);
    const row = await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.click(within(row).getByRole("button", { name: "แก้ไข" }));
    fireEvent.change(within(row).getByLabelText("โควตาต่อวันของ partner lab"), { target: { value: "250" } });
    fireEvent.click(within(row).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(screen.getByText("บันทึกการแก้ไข key แล้ว")).toHaveFocus());
  });

  it("opens the editor on its first field and returns to the edit button on cancel", async () => {
    mockAdminFetch((m, p) => (m === "GET" && p === "/keys" ? [200, KEYS] : undefined));
    await renderAdmin(<KeysView />);
    const row = await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.click(within(row).getByRole("button", { name: "แก้ไข" }));
    await waitFor(() => expect(within(row).getByLabelText("ชื่อของ partner lab")).toHaveFocus());
    fireEvent.click(within(row).getByRole("button", { name: "ยกเลิก" }));
    await waitFor(() => expect(within(row).getByRole("button", { name: "แก้ไข" })).toHaveFocus());
  });

  it("saving without a change sends nothing and closes the editor", async () => {
    const fetch = mockAdminFetch((m, p) => (m === "GET" && p === "/keys" ? [200, KEYS] : undefined));
    await renderAdmin(<KeysView />);
    const row = await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.click(within(row).getByRole("button", { name: "แก้ไข" }));
    fireEvent.click(within(row).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(within(row).getByRole("button", { name: "แก้ไข" })).toHaveFocus());
    expect(fetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")).toBe(false);
  });

  it("revokes after the in-page confirm", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "POST" && p.endsWith("/revoke")) return [200, { ...KEYS[0], revoked_at: "2026-10-12T11:00:00Z" }];
    });
    await renderAdmin(<KeysView />);
    const row = await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.click(within(row).getByRole("button", { name: "เพิกถอน" }));
    fireEvent.click(within(row).getByRole("button", { name: "ยืนยันเพิกถอน" }));
    await waitFor(() => expect(screen.getByRole("row", { name: /partner lab/ })).toHaveTextContent("เพิกถอนแล้ว"));
    expect(within(screen.getByRole("row", { name: /partner lab/ })).queryByRole("button", { name: "แก้ไข" })).not.toBeInTheDocument();
  });

  it("moves focus to the notice after a revoke removes the controls of the row", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "POST" && p.endsWith("/revoke")) return [200, { ...KEYS[0], revoked_at: "2026-10-12T11:00:00Z" }];
    });
    await renderAdmin(<KeysView />);
    const row = await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.click(within(row).getByRole("button", { name: "เพิกถอน" }));
    fireEvent.click(within(row).getByRole("button", { name: "ยืนยันเพิกถอน" }));
    await waitFor(() => expect(screen.getByText("เพิกถอน key แล้ว")).toHaveFocus());
  });

  it("shows a validation refusal", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "POST") return [422, { detail: "name must not be blank" }];
    });
    await renderAdmin(<KeysView />);
    await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.change(screen.getByLabelText("ชื่อ key"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้าง key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("name must not be blank");
  });
});
