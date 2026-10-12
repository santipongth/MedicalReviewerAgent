import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminGate } from "@/components/admin/admin-gate";
import type { LlmVersion, Page } from "@/lib/admin-types";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { VERSIONS } from "@/test/admin-model-fixtures";
import { ModelsHistory } from "./models-history";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const RESET = "สร้างเวอร์ชันใหม่จาก llm.yaml";
const CONFIRM_RESET = "ยืนยันสร้างเวอร์ชันใหม่";
const CONFLICT = "version 5 is in use now; reload the latest version and try again";

describe("ModelsHistory", () => {
  it("lists versions with their changes and a YAML download", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/llm-config/versions") ? [200, VERSIONS] : undefined));
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    const v3 = await screen.findByRole("listitem", { name: /เวอร์ชัน 3/ });
    expect(v3).toHaveTextContent("active_preset: better → cheap");
    expect(v3).toHaveTextContent("cheaper");
    expect(within(v3).getByRole("link", { name: /YAML/ })).toHaveAttribute("href", "/api/v1/admin/llm-config/versions/3/yaml");
  });

  it("says plainly that a version with no changes has none, instead of an empty list", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/llm-config/versions") ? [200, VERSIONS] : undefined));
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    const v2 = await screen.findByRole("listitem", { name: /เวอร์ชัน 2/ });
    expect(v2).toHaveTextContent("ไม่มีการเปลี่ยนแปลง");
    expect(within(v2).queryByRole("list")).not.toBeInTheDocument();
    const v3 = screen.getByRole("listitem", { name: /เวอร์ชัน 3/ });
    expect(v3).not.toHaveTextContent("ไม่มีการเปลี่ยนแปลง");
  });

  it("restores a version after the in-page confirm, sending the base version", async () => {
    const onChanged = vi.fn();
    const fetch = mockAdminFetch((m, p, body) => {
      if (m === "GET" && p.startsWith("/llm-config/versions")) return [200, VERSIONS];
      if (m === "POST" && p === "/llm-config/versions/2/restore") return [201, { ...VERSIONS.items[0], id: 4, source: "restore", restored_from: 2, body }];
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={onChanged} />);
    const v2 = await screen.findByRole("listitem", { name: /เวอร์ชัน 2/ });
    fireEvent.click(within(v2).getByRole("button", { name: "ย้อนกลับไปเวอร์ชันนี้" }));
    fireEvent.click(within(v2).getByRole("button", { name: "ยืนยันย้อนกลับ" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const post = fetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ base_version: 3 });
  });

  it("explains a conflict and asks the page to re-read, so a retry uses the fresh base", async () => {
    const onChanged = vi.fn();
    mockAdminFetch((m) => {
      if (m === "GET") return [200, VERSIONS];
      if (m === "POST") return [409, { detail: CONFLICT }];
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: RESET }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_RESET }));
    expect(await screen.findByRole("alert")).toHaveTextContent("version 5 is in use now");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("asks the page to re-read after a conflict on a restore too", async () => {
    const onChanged = vi.fn();
    mockAdminFetch((m) => {
      if (m === "GET") return [200, VERSIONS];
      if (m === "POST") return [409, { detail: CONFLICT }];
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={onChanged} />);
    const v2 = await screen.findByRole("listitem", { name: /เวอร์ชัน 2/ });
    fireEvent.click(within(v2).getByRole("button", { name: "ย้อนกลับไปเวอร์ชันนี้" }));
    fireEvent.click(within(v2).getByRole("button", { name: "ยืนยันย้อนกลับ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("version 5 is in use now");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("does not re-read after a failure that is not a conflict", async () => {
    const onChanged = vi.fn();
    mockAdminFetch((m) => {
      if (m === "GET") return [200, VERSIONS];
      if (m === "POST") return [500, { detail: "boom" }];
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: RESET }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_RESET }));
    expect(await screen.findByRole("alert")).toHaveTextContent("(500)");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("keeps the conflict message when the list reloads for the new base", async () => {
    mockAdminFetch((m) => {
      if (m === "GET") return [200, VERSIONS];
      if (m === "POST") return [409, { detail: CONFLICT }];
    });
    const { rerender } = await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: RESET }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_RESET }));
    expect(await screen.findByRole("alert")).toHaveTextContent("version 5 is in use now");
    rerender(<AdminGate><ModelsHistory base={5} onChanged={() => {}} /></AdminGate>);
    await waitFor(() => expect(screen.getByRole("listitem", { name: /เวอร์ชัน 3/ })).not.toHaveTextContent("ใช้งานอยู่"));
    expect(screen.getByRole("alert")).toHaveTextContent("version 5 is in use now");
  });

  it("tells the admin what the new version means before it is created", async () => {
    mockAdminFetch((m, p) => (m === "GET" && p.startsWith("/llm-config/versions") ? [200, VERSIONS] : undefined));
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    expect(screen.queryByText(/LLM_PRESET ภายหลังจะไม่มีผล/)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: RESET }));
    const confirm = screen.getByRole("button", { name: CONFIRM_RESET });
    expect(confirm).toHaveAccessibleDescription(/เวอร์ชันใหม่จาก llm.yaml จะถูกใช้ทันที/);
    expect(confirm).toHaveAccessibleDescription(/การแก้ llm.yaml หรือ LLM_PRESET ภายหลังจะไม่มีผล/);
  });

  it("offers no reset while llm.yaml is already the source (no DB version yet)", async () => {
    mockAdminFetch((m, p) => (m === "GET" && p.startsWith("/llm-config/versions") ? [200, { items: [], next: null }] : undefined));
    await renderAdmin(<ModelsHistory base={null} onChanged={() => {}} />);
    expect(await screen.findByText(/ยังไม่มีเวอร์ชันที่บันทึก/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RESET })).not.toBeInTheDocument();
  });

  it("clears a load error once a later load succeeds", async () => {
    let failing = true;
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/llm-config/versions")) return failing ? [500, { detail: "boom" }] : [200, VERSIONS];
    });
    const { rerender } = await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("(500)");
    failing = false;
    rerender(<AdminGate><ModelsHistory base={4} onChanged={() => {}} /></AdminGate>);
    expect(await screen.findByRole("listitem", { name: /เวอร์ชัน 3/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the restore was saved but the workers could not be told", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/llm-config/versions")) return [200, VERSIONS];
      if (m === "POST" && p === "/llm-config/versions/2/restore") {
        return [201, { ...VERSIONS.items[0], id: 4, source: "restore", restored_from: 2, workers_notified: false }];
      }
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    const v2 = await screen.findByRole("listitem", { name: /เวอร์ชัน 2/ });
    fireEvent.click(within(v2).getByRole("button", { name: "ย้อนกลับไปเวอร์ชันนี้" }));
    fireEvent.click(within(v2).getByRole("button", { name: "ยืนยันย้อนกลับ" }));
    const note = await screen.findByText(/แจ้ง worker ไม่สำเร็จ/);
    expect(note).toHaveTextContent("บันทึกแล้ว แต่แจ้ง worker ไม่สำเร็จ: worker จะใช้เวอร์ชันนี้ภายใน 30 วินาที");
    expect(note).toHaveClass("bg-warn-bg");
  });

  it("moves focus to the notice after a reset, which closes the control that had it", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/llm-config/versions")) return [200, VERSIONS];
      if (m === "POST") return [201, { ...VERSIONS.items[0], id: 4, source: "file", workers_notified: true }];
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: RESET }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_RESET }));
    const notice = await screen.findByRole("status");
    await waitFor(() => expect(notice).toHaveFocus());
    expect(screen.getByRole("button", { name: RESET })).toBeInTheDocument();
    expect(notice).toHaveFocus();
  });

  it("shows no worker warning when the workers were told", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/llm-config/versions")) return [200, VERSIONS];
      if (m === "POST") return [201, { ...VERSIONS.items[0], id: 4, source: "file", workers_notified: true }];
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: RESET }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_RESET }));
    expect(await screen.findByText("สร้างเวอร์ชัน 4 จาก llm.yaml แล้ว")).toBeInTheDocument();
    expect(screen.queryByText(/แจ้ง worker ไม่สำเร็จ/)).not.toBeInTheDocument();
  });
});

describe("ModelsHistory pagination", () => {
  const version = (id: number): LlmVersion => ({
    id, created_at: "2026-10-10T10:00:00Z", created_by: "owner", note: `note ${id}`, source: "edit",
    restored_from: null, active_preset: "cheap", changes: { active_preset: `a → b${id}` },
  });
  const FIRST: Page<LlmVersion> = { items: [version(3)], next: 3 };
  const SECOND: Page<LlmVersion> = { items: [version(2)], next: null };

  it("shows the more control when a page has a next cursor, and appends the next page", async () => {
    const fetch = mockAdminFetch((m, p) => {
      if (m !== "GET") return undefined;
      if (p === "/llm-config/versions") return [200, FIRST];
      if (p === "/llm-config/versions?before=3") return [200, SECOND];
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    expect(await screen.findByRole("listitem", { name: /เวอร์ชัน 3/ })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: /เวอร์ชัน 2/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "โหลดเพิ่ม" }));
    expect(await screen.findByRole("listitem", { name: /เวอร์ชัน 2/ })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /เวอร์ชัน 3/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "โหลดเพิ่ม" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/admin/me", "/api/v1/admin/llm-config/versions", "/api/v1/admin/llm-config/versions?before=3",
    ]);
  });

  it("ignores a page that arrives after the list was reloaded for another base", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetch = mockAdminFetch((m, p) => {
      if (m !== "GET") return undefined;
      if (p === "/llm-config/versions?before=3") return [200, { items: [version(1)], next: null }];
      if (p === "/llm-config/versions") return [200, FIRST];
    });
    const answer = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (input, init) => {
      if (String(input).endsWith("before=3")) await gate;
      return answer(input, init);
    });
    const { rerender } = await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "โหลดเพิ่ม" }));
    rerender(<AdminGate><ModelsHistory base={4} onChanged={() => {}} /></AdminGate>);
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/llm-config/versions"))).toHaveLength(2));
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.queryByRole("listitem", { name: /เวอร์ชัน 1/ })).not.toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /เวอร์ชัน 3/ })).toBeInTheDocument();
  });
});
