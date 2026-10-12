import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { VERSIONS } from "@/test/admin-model-fixtures";
import { ModelsHistory } from "./models-history";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

describe("ModelsHistory", () => {
  it("lists versions with their changes and a YAML download", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/llm-config/versions") ? [200, VERSIONS] : undefined));
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    const v3 = await screen.findByRole("listitem", { name: /เวอร์ชัน 3/ });
    expect(v3).toHaveTextContent("active_preset: better → cheap");
    expect(v3).toHaveTextContent("cheaper");
    expect(within(v3).getByRole("link", { name: /YAML/ })).toHaveAttribute("href", "/api/v1/admin/llm-config/versions/3/yaml");
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

  it("explains a conflict", async () => {
    mockAdminFetch((m) => {
      if (m === "GET") return [200, VERSIONS];
      if (m === "POST") return [409, { detail: "version 5 is in use now; reload the latest version and try again" }];
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "กลับไปใช้ llm.yaml" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันกลับไปใช้ llm.yaml" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("version 5 is in use now");
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
    fireEvent.click(await screen.findByRole("button", { name: "กลับไปใช้ llm.yaml" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันกลับไปใช้ llm.yaml" }));
    const notice = await screen.findByRole("status");
    await waitFor(() => expect(notice).toHaveFocus());
    expect(screen.getByRole("button", { name: "กลับไปใช้ llm.yaml" })).toBeInTheDocument();
    expect(notice).toHaveFocus();
  });

  it("shows no worker warning when the workers were told", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/llm-config/versions")) return [200, VERSIONS];
      if (m === "POST") return [201, { ...VERSIONS.items[0], id: 4, source: "file", workers_notified: true }];
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "กลับไปใช้ llm.yaml" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันกลับไปใช้ llm.yaml" }));
    expect(await screen.findByText("สร้างเวอร์ชัน 4 จาก llm.yaml แล้ว")).toBeInTheDocument();
    expect(screen.queryByText(/แจ้ง worker ไม่สำเร็จ/)).not.toBeInTheDocument();
  });
});
