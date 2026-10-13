import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import type { LlmConfigDoc, LlmConfigState } from "@/lib/admin-types";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { CONFIG, REPORT_OK, STATE, VERSIONS } from "@/test/admin-model-fixtures";
import { ModelsHeader, ModelsView } from "./models-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));

// The fixtures' workers were last seen at 10:00:00Z. Pin the clock (Date only, so waitFor/findBy keep real timers)
// 30 seconds after that, so the header tests stay about versions and warnings and not about staleness.
const SEEN = Date.parse("2026-10-12T10:00:00Z");
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SEEN + 30_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nav.replace.mockReset(); });

const routes = (state = STATE) => (m: string, p: string) =>
  p === "/llm-config" ? [200, state] as [number, unknown] : p.startsWith("/llm-config/versions") ? [200, VERSIONS] as [number, unknown] : undefined;

describe("ModelsView header", () => {
  it("says which version is in use, the active preset and what each worker loaded", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText(/ใช้เวอร์ชัน 3 จาก DB/)).toBeInTheDocument();
    expect(screen.getByText(/preset ที่ใช้งาน: cheap/)).toBeInTheDocument();
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent("เวอร์ชัน 3");
  });

  it("warns about the file source, LLM_PRESET, missing keys and a worker on another version", async () => {
    mockAdminFetch(routes({
      ...STATE, source: "file", version: null, env_preset: "budget", keys_present: { OPENROUTER_API_KEY: false },
      loaded: [{ worker: "w:1", version: "2", preset: "cheap", loaded_at: "2026-10-12T10:00:00Z", error: "boom" }],
    }));
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText(/ใช้ llm.yaml \(ยังไม่มีเวอร์ชันที่บันทึก\)/)).toBeInTheDocument();
    expect(screen.getByText(/LLM_PRESET=budget/)).toBeInTheDocument();
    expect(screen.getByText(/OPENROUTER_API_KEY ยังไม่ได้ตั้ง/)).toBeInTheDocument();
    expect(screen.getByText(/w:1/)).toHaveTextContent("boom");
    expect(screen.getByText(/w:1/)).toHaveTextContent("ไม่ตรงกับเวอร์ชันที่ใช้");
  });

  it("shows no warning on a worker that is on the active version and reporting", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<ModelsView />);
    const worker = await screen.findByText(/worker-1:7/);
    expect(worker).not.toHaveClass("bg-warn-bg");
    expect(worker).not.toHaveTextContent("ไม่ได้รายงาน");
    expect(worker).not.toHaveTextContent("ไม่ตรงกับเวอร์ชันที่ใช้");
  });
});

describe("ModelsView key warnings", () => {
  // The shipped llm.yaml declares three providers; the active preset uses openrouter only.
  const THREE: LlmConfigDoc = {
    ...CONFIG,
    providers: {
      openrouter: { base_url: "https://openrouter.ai/api/v1", api_key_env: "OPENROUTER_API_KEY" },
      anthropic: { api_key_env: "ANTHROPIC_API_KEY" },
      openai_compatible: { base_url: "http://localhost:11434/v1", api_key_env: "OPENAI_COMPATIBLE_API_KEY" },
    },
  };

  it("does not warn about the key of a provider no role of the active preset uses", async () => {
    mockAdminFetch(routes({ ...STATE, config: THREE, keys_present: {
      OPENROUTER_API_KEY: true, ANTHROPIC_API_KEY: false, OPENAI_COMPATIBLE_API_KEY: false,
    } }));
    await renderAdmin(<ModelsView />);
    await screen.findByText(/ใช้เวอร์ชัน 3 จาก DB/);
    expect(screen.queryByText(/ยังไม่ได้ตั้ง/)).not.toBeInTheDocument();
  });

  it("warns about the key of the provider the roles use, and only that one", async () => {
    mockAdminFetch(routes({ ...STATE, config: THREE, keys_present: {
      OPENROUTER_API_KEY: false, ANTHROPIC_API_KEY: false, OPENAI_COMPATIBLE_API_KEY: false,
    } }));
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText(/OPENROUTER_API_KEY ยังไม่ได้ตั้ง/)).toBeInTheDocument();
    expect(screen.queryByText(/ANTHROPIC_API_KEY/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OPENAI_COMPATIBLE_API_KEY/)).not.toBeInTheDocument();
  });
});

describe("ModelsView with LLM_PRESET on the file source", () => {
  it("shows the running preset and checks the key of the provider that preset uses", async () => {
    const config: LlmConfigDoc = {
      ...CONFIG,
      providers: { ...CONFIG.providers, anthropic: { api_key_env: "ANTHROPIC_API_KEY" } },
      presets: { ...CONFIG.presets, claude: Object.fromEntries(Object.keys(CONFIG.presets.cheap).map((r) => [r, { model: "m", provider: "anthropic" }])) },
    };
    mockAdminFetch(routes({
      ...STATE, source: "file", version: null, config, env_preset: "claude", active_preset: "claude", // as the service reports it
      keys_present: { OPENROUTER_API_KEY: true, ANTHROPIC_API_KEY: false },
      loaded: [{ ...STATE.loaded[0], version: "file" }],
    }));
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText(/preset ที่ใช้งาน: claude/)).toBeInTheDocument();
    expect(screen.getByText(/ANTHROPIC_API_KEY ยังไม่ได้ตั้ง/)).toBeInTheDocument();
    expect(screen.queryByText(/OPENROUTER_API_KEY ยังไม่ได้ตั้ง/)).not.toBeInTheDocument();
  });
});

describe("ModelsView tabs", () => {
  it("shows the history list under the ประวัติ tab", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<ModelsView />);
    const tab = await screen.findByRole("button", { name: "ประวัติ" });
    expect(screen.queryByRole("listitem", { name: /เวอร์ชัน 3/ })).not.toBeInTheDocument();
    fireEvent.click(tab);
    expect(tab).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("listitem", { name: /เวอร์ชัน 3/ })).toHaveTextContent("cheaper");
  });

  it("re-reads the config after a restore, and the history refetches for the new base", async () => {
    let active = 3;
    const calls: string[] = [];
    mockAdminFetch((m, p) => {
      calls.push(`${m} ${p}`);
      if (m === "GET" && p === "/llm-config") {
        return [200, { ...STATE, version: active, loaded: [{ ...STATE.loaded[0], version: String(active) }] }];
      }
      if (m === "GET" && p.startsWith("/llm-config/versions")) {
        const restored = { ...VERSIONS.items[0], id: 4, source: "restore", restored_from: 2 };
        return [200, active === 3 ? VERSIONS : { items: [restored, ...VERSIONS.items], next: null }];
      }
      if (m === "POST" && p === "/llm-config/versions/2/restore") {
        active = 4;
        return [201, { ...VERSIONS.items[0], id: 4, source: "restore", restored_from: 2, workers_notified: true }];
      }
    });
    await renderAdmin(<ModelsView />);
    fireEvent.click(await screen.findByRole("button", { name: "ประวัติ" }));
    const v2 = await screen.findByRole("listitem", { name: /เวอร์ชัน 2/ });
    fireEvent.click(within(v2).getByRole("button", { name: "ย้อนกลับไปเวอร์ชันนี้" }));
    fireEvent.click(within(v2).getByRole("button", { name: "ยืนยันย้อนกลับ" }));
    expect(await screen.findByText(/ใช้เวอร์ชัน 4 จาก DB/)).toBeInTheDocument();
    expect(await screen.findByRole("listitem", { name: /เวอร์ชัน 4/ })).toHaveTextContent("ใช้งานอยู่");
    expect(calls.filter((c) => c === "GET /llm-config")).toHaveLength(2);
    expect(calls.filter((c) => c === "GET /llm-config/versions")).toHaveLength(2);
    expect(calls.indexOf("POST /llm-config/versions/2/restore")).toBeLessThan(calls.lastIndexOf("GET /llm-config"));
  });
});

/** A server that can move on: tests change `state` (and `reply`) between the page's requests. */
function liveServer() {
  const server = {
    state: STATE as LlmConfigState,
    calls: [] as string[],
    posts: [] as { path: string; body: Record<string, unknown> }[],
    /** answers a request before the defaults do */
    reply: ((): [number, unknown] | undefined => undefined) as (method: string, path: string, body?: unknown) => [number, unknown] | undefined,
  };
  mockAdminFetch((m, p, body) => {
    server.calls.push(`${m} ${p}`);
    if (m === "POST") server.posts.push({ path: p, body: body as Record<string, unknown> });
    const custom = server.reply(m, p, body);
    if (custom) return custom;
    if (m === "GET" && p === "/llm-config") return [200, server.state];
    if (m === "GET" && p.startsWith("/llm-config/versions")) return [200, VERSIONS];
    if (p === "/llm-config/validate") return [200, REPORT_OK];
  });
  return server;
}

/** The server's config at `version`, with the guard role on `guardModel`. */
function movedTo(version: number, guardModel = "vendor/cheap"): LlmConfigState {
  const cheap = { ...CONFIG.presets.cheap, guard: { ...CONFIG.presets.cheap.guard, model: guardModel } };
  return {
    ...STATE, version, config: { ...CONFIG, presets: { ...CONFIG.presets, cheap } },
    loaded: [{ ...STATE.loaded[0], version: String(version) }],
  };
}

const SAVE = { name: "บันทึกเป็นเวอร์ชันใหม่" };
const MOVED = (from: number | string, to: number | string) => `ร่างนี้แก้จากเวอร์ชัน ${from} แต่ตอนนี้ใช้เวอร์ชัน ${to} อยู่`;
const guardModel = () => screen.getByLabelText("model ของ guard");

/** Restores version 2 from the history tab; the server moves to `after`. Lands back on the presets tab. */
async function restoreElsewhere(server: ReturnType<typeof liveServer>, after: LlmConfigState) {
  server.reply = (m, p) => {
    if (m === "POST" && p === "/llm-config/versions/2/restore") {
      server.state = after;
      return [201, { ...VERSIONS.items[0], id: after.version, source: "restore", restored_from: 2, workers_notified: true }];
    }
  };
  fireEvent.click(screen.getByRole("button", { name: "ประวัติ" }));
  const v2 = await screen.findByRole("listitem", { name: /เวอร์ชัน 2/ });
  fireEvent.click(within(v2).getByRole("button", { name: "ย้อนกลับไปเวอร์ชันนี้" }));
  fireEvent.click(within(v2).getByRole("button", { name: "ยืนยันย้อนกลับ" }));
  expect(await screen.findByText(new RegExp(`ใช้เวอร์ชัน ${after.version} จาก DB`))).toBeInTheDocument();
  expect(screen.queryByText(/ร่างนี้แก้จากเวอร์ชัน/)).not.toBeInTheDocument(); // the note belongs to the save bar
  fireEvent.click(screen.getByRole("button", { name: "Presets" }));
}

describe("ModelsView presets editor", () => {
  it("opens on the presets tab with the save bar under it", async () => {
    liveServer();
    await renderAdmin(<ModelsView />);
    expect(await screen.findByLabelText("preset ที่กำลังแก้")).toHaveValue("cheap");
    expect(screen.getByRole("button", SAVE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ประวัติ" }));
    expect(screen.queryByRole("button", SAVE)).not.toBeInTheDocument();
  });

  it("keeps unsaved edits through a reload, says the server moved on, and drops the edits on request", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    await restoreElsewhere(server, movedTo(4, "vendor/restored"));
    expect(guardModel()).toHaveValue("vendor/mine");
    expect(screen.getByText(MOVED(3, 4))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ทิ้งการแก้ไข" }));
    expect(guardModel()).toHaveValue("vendor/mine"); // asks again first
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" }));
    expect(guardModel()).toHaveValue("vendor/restored");
    expect(screen.queryByText(/ร่างนี้แก้จากเวอร์ชัน/)).not.toBeInTheDocument();
    expect(screen.getByText(/ทิ้งการแก้ไขแล้ว: ร่างตรงกับเวอร์ชัน 4/)).toHaveFocus();
  });

  it("lets a clean draft follow the reload", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    expect(await screen.findByLabelText("model ของ guard")).toHaveValue("vendor/cheap");
    await restoreElsewhere(server, movedTo(4, "vendor/restored"));
    expect(guardModel()).toHaveValue("vendor/restored");
    expect(screen.queryByText(/ร่างนี้แก้จากเวอร์ชัน/)).not.toBeInTheDocument();
  });

  it("treats an edit that was put back as clean", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    fireEvent.change(guardModel(), { target: { value: "vendor/cheap" } });
    await restoreElsewhere(server, movedTo(4, "vendor/restored"));
    expect(guardModel()).toHaveValue("vendor/restored");
  });

  it("builds on the latest version when asked, and the next save sends that version as its base", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    await restoreElsewhere(server, movedTo(4, "vendor/restored"));
    server.reply = (m, p) => (m === "POST" && p === "/llm-config" ? [201, { id: 5, workers_notified: true }] : undefined);
    fireEvent.click(screen.getByRole("button", { name: "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด" }));
    expect(screen.queryByText(/ร่างนี้แก้จากเวอร์ชัน/)).not.toBeInTheDocument();
    expect(guardModel()).toHaveValue("vendor/mine");
    expect(screen.getByText(/ร่างนี้ใช้เวอร์ชัน 4 เป็นฐานแล้ว/)).toHaveFocus();
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 5 แล้ว")).toBeInTheDocument();
    const save = server.posts.find((p) => p.path === "/llm-config")!;
    expect(save.body.base_version).toBe(4);
    expect((save.body.config as LlmConfigDoc).presets.cheap.guard.model).toBe("vendor/mine");
  });

  it("without that, a stale draft is saved on its own base and the server's 409 sends it to the YAML tab", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    await restoreElsewhere(server, movedTo(4, "vendor/restored"));
    server.reply = (m, p) => (m === "POST" && p === "/llm-config" ? [409, { detail: "version 4 is in use now" }] : undefined);
    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(screen.getByRole("button", { name: "YAML ขั้นสูง" })).toHaveAttribute("aria-pressed", "true"));
    expect(server.posts.find((p) => p.path === "/llm-config")!.body.base_version).toBe(3);
  });

  it("re-reads after a 409 on save, keeps the draft, and offers both ways forward", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    server.reply = (m, p) => {
      if (m === "POST" && p === "/llm-config") {
        server.state = movedTo(5, "vendor/theirs");
        return [409, { detail: "version 5 is in use now" }];
      }
    };
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText(/ใช้เวอร์ชัน 5 จาก DB/)).toBeInTheDocument();
    expect(server.calls.filter((c) => c === "GET /llm-config")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "YAML ขั้นสูง" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(MOVED(3, 5))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ทิ้งการแก้ไข" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    expect(guardModel()).toHaveValue("vendor/mine");
  });

  it("makes the draft clean after a save, keeps the saved note through the re-read, and names the new version as its base", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    server.reply = (m, p) => {
      if (m === "POST" && p === "/llm-config") {
        server.state = movedTo(4, "vendor/normalised"); // what the server stored
        return [201, { ...VERSIONS.items[0], id: 4, workers_notified: false }];
      }
    };
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText(/ใช้เวอร์ชัน 4 จาก DB/)).toBeInTheDocument();
    expect(guardModel()).toHaveValue("vendor/normalised");
    expect(screen.queryByText(/ร่างนี้แก้จากเวอร์ชัน/)).not.toBeInTheDocument();
    expect(screen.getByText("บันทึกเป็นเวอร์ชัน 4 แล้ว")).toBeInTheDocument();
    expect(screen.getByText(WORKERS_NOT_NOTIFIED)).toBeInTheDocument();
    expect(server.calls.filter((c) => c === "GET /llm-config")).toHaveLength(2);
  });
});

/** Holds the next read of /llm-config after `arm()` until `release()`: what the page does right after a save. */
function holdNextReread() {
  const inner = globalThis.fetch;
  let armed = false;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://site.test").pathname;
    if (armed && path.endsWith("/llm-config") && (init?.method ?? "GET") === "GET") {
      armed = false;
      await gate;
    }
    return inner(input, init);
  }));
  return { arm: () => { armed = true; }, release: () => release() };
}

/** The server accepts a save as version `id`, and from then on serves `afterwards`. */
const acceptsSaveAs = (server: ReturnType<typeof liveServer>, id: number, afterwards: LlmConfigState) => {
  server.reply = (m, p) => {
    if (m === "POST" && p === "/llm-config") {
      server.state = afterwards;
      return [201, { ...VERSIONS.items[0], id, workers_notified: true }];
    }
  };
};
const saveRequests = (server: ReturnType<typeof liveServer>) => server.posts.filter((p) => p.path === "/llm-config");

describe("ModelsView while a save is in flight", () => {
  it("keeps what is typed during the save, and the next save builds on the version just saved", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    acceptsSaveAs(server, 4, movedTo(4, "vendor/mine"));
    const hold = holdNextReread();
    hold.arm();
    fireEvent.click(screen.getByRole("button", SAVE));
    await screen.findByText("บันทึกเป็นเวอร์ชัน 4 แล้ว"); // saved; the re-read is held
    fireEvent.change(guardModel(), { target: { value: "vendor/typed" } });
    await act(async () => { hold.release(); });
    expect(await screen.findByText(/ใช้เวอร์ชัน 4 จาก DB/)).toBeInTheDocument();
    expect(guardModel()).toHaveValue("vendor/typed");
    expect(screen.queryByText(/ร่างนี้แก้จากเวอร์ชัน/)).not.toBeInTheDocument(); // edits on top of its own save are no conflict
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    acceptsSaveAs(server, 5, movedTo(5, "vendor/typed"));
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 5 แล้ว")).toBeInTheDocument();
    expect(saveRequests(server).map((r) => r.body.base_version)).toEqual([3, 4]);
    expect((saveRequests(server)[1].body.config as LlmConfigDoc).presets.cheap.guard.model).toBe("vendor/typed");
  });

  it("keeps a draft typed during the save on its old base when the re-read finds a version another admin saved", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    acceptsSaveAs(server, 4, movedTo(5, "vendor/theirs")); // our save is version 4; by the time of the re-read someone saved 5
    const hold = holdNextReread();
    hold.arm();
    fireEvent.click(screen.getByRole("button", SAVE));
    await screen.findByText("บันทึกเป็นเวอร์ชัน 4 แล้ว");
    fireEvent.change(guardModel(), { target: { value: "vendor/typed" } });
    await act(async () => { hold.release(); });
    expect(await screen.findByText(/ใช้เวอร์ชัน 5 จาก DB/)).toBeInTheDocument();
    expect(guardModel()).toHaveValue("vendor/typed");
    expect(screen.getByText(MOVED(3, 5))).toBeInTheDocument(); // not rebased onto a version it never saw
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    server.reply = (m, p) => (m === "POST" && p === "/llm-config" ? [409, { detail: "version 5 is in use now" }] : undefined);
    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(saveRequests(server)).toHaveLength(2));
    expect(saveRequests(server)[1].body.base_version).toBe(3); // so the server refuses it
  });

  it("replaces a draft that is still what was saved with the server's copy, even when that is a newer version", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    acceptsSaveAs(server, 4, movedTo(5, "vendor/theirs"));
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText(/ใช้เวอร์ชัน 5 จาก DB/)).toBeInTheDocument();
    await waitFor(() => expect(guardModel()).toHaveValue("vendor/theirs"));
    expect(screen.queryByText(/ร่างนี้แก้จากเวอร์ชัน/)).not.toBeInTheDocument();
  });

  it("keeps the save button disabled until the re-read has landed, so a second click cannot send a stale base", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    acceptsSaveAs(server, 4, movedTo(4, "vendor/mine"));
    const hold = holdNextReread();
    hold.arm();
    fireEvent.click(screen.getByRole("button", SAVE));
    await screen.findByText("บันทึกเป็นเวอร์ชัน 4 แล้ว");
    expect(screen.getByRole("button", SAVE)).toBeDisabled();
    expect(screen.getByRole("button", { name: "ตรวจ" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(saveRequests(server)).toHaveLength(1);
    await act(async () => { hold.release(); });
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    expect(screen.getByText(/ใช้เวอร์ชัน 4 จาก DB/)).toBeInTheDocument(); // enabled only after the page knows version 4
  });

  it("a failed re-read after a save does not make a later reload discard a draft with edits", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    let failReread = false;
    server.reply = (m, p) => {
      if (m === "POST" && p === "/llm-config") {
        failReread = true;
        server.state = movedTo(4, "vendor/mine");
        return [201, { ...VERSIONS.items[0], id: 4, workers_notified: true }];
      }
      if (m === "GET" && p === "/llm-config" && failReread) {
        failReread = false;
        return [500, { detail: "boom" }];
      }
    };
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 4 แล้ว")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument(); // the failed re-read
    expect(screen.getByText(/ใช้เวอร์ชัน 3 จาก DB/)).toBeInTheDocument(); // the page never learned version 4
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    // a later reload (a restore in the history tab) must treat the draft as the unsaved edits it is
    await restoreElsewhere(server, movedTo(5, "vendor/restored"));
    expect(guardModel()).toHaveValue("vendor/mine");
    expect(screen.getByText(MOVED(3, 5))).toBeInTheDocument();
  });

  it("drops a test result when the draft is discarded for a server config with another model", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    server.reply = (m, p) => {
      if (m === "POST" && p === "/llm-config") {
        server.state = movedTo(5, "vendor/theirs");
        return [409, { detail: "version 5 is in use now" }];
      }
    };
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText(MOVED(3, 5))).toBeInTheDocument();
    server.reply = (m, p) => (m === "POST" && p === "/llm-models/test"
      ? [200, { ok: true, latency_ms: 812, cost_usd: 0.0002, model: "vendor/mine", error: null }] : undefined);
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    fireEvent.click(within(screen.getByRole("row", { name: /guard/ })).getByRole("button", { name: "ทดสอบ" }));
    expect(await screen.findByText(/ใช้ได้ · 812 ms/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ทิ้งการแก้ไข" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" }));
    expect(guardModel()).toHaveValue("vendor/theirs");
    expect(screen.queryByText(/ใช้ได้ · 812 ms/)).not.toBeInTheDocument();
  });
});

describe("ModelsView worker staleness", () => {
  it("measures a worker's last report against the time the page read it", async () => {
    vi.setSystemTime(SEEN + 3 * 60_000);
    mockAdminFetch(routes());
    await renderAdmin(<ModelsView />);
    const line = await screen.findByText(/worker-1:7/);
    expect(line).toHaveTextContent("ไม่ได้รายงานเกิน 2 นาที (worker อาจหยุดทำงาน)");
    expect(line).toHaveClass("bg-warn-bg");
  });
});

describe("ModelsHeader workers", () => {
  const worker = (loaded_at: string) => ({ ...STATE, loaded: [{ ...STATE.loaded[0], loaded_at }] });

  it("says the time is the last report", () => {
    render(<ModelsHeader state={worker("2026-10-12T10:00:00Z")} now={SEEN + 30_000} />);
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent(/รายงานล่าสุด/);
  });

  it("marks a worker on another version in words as well as colour", () => {
    render(<ModelsHeader state={{ ...STATE, loaded: [{ ...STATE.loaded[0], version: "2" }] }} now={SEEN + 30_000} />);
    const line = screen.getByText(/worker-1:7/);
    expect(line).toHaveTextContent("ไม่ตรงกับเวอร์ชันที่ใช้");
    expect(line).toHaveClass("bg-warn-bg");
  });

  it("marks a worker last seen more than 2 minutes ago", () => {
    render(<ModelsHeader state={worker("2026-10-12T10:00:00Z")} now={SEEN + 3 * 60_000} />);
    const line = screen.getByText(/worker-1:7/);
    expect(line).toHaveTextContent("ไม่ได้รายงานเกิน 2 นาที (worker อาจหยุดทำงาน)");
    expect(line).toHaveClass("bg-warn-bg");
  });

  it("does not mark a worker last seen 30 seconds ago", () => {
    render(<ModelsHeader state={worker("2026-10-12T10:00:00Z")} now={SEEN + 30_000} />);
    const line = screen.getByText(/worker-1:7/);
    expect(line).not.toHaveTextContent("ไม่ได้รายงาน");
    expect(line).not.toHaveClass("bg-warn-bg");
  });

  it("does not mark a worker whose time does not parse", () => {
    render(<ModelsHeader state={worker("not a time")} now={SEEN + 3 * 60_000} />);
    expect(screen.getByText(/worker-1:7/)).not.toHaveTextContent("ไม่ได้รายงาน");
  });
});

const YAML_TAB = { name: "YAML ขั้นสูง" };
const YAML_TAB_PENDING = { name: "YAML ขั้นสูง (มีข้อความที่ยังไม่ได้ใช้)" };
const PENDING_REASON = 'กด "ใช้ YAML นี้" ก่อน เพื่อให้ข้อความในกล่องเป็นร่างที่จะบันทึก';
const yamlBox = () => screen.getByLabelText("YAML ของร่าง");
const guardOf = (config: unknown) => (config as LlmConfigDoc).presets.cheap.guard.model;

/** The validate route: a draft comes back as YAML that names its guard model, so a test can tell which draft a text is from. */
const yamlOfDraft = (body: unknown) => {
  const b = body as { config?: LlmConfigDoc; yaml?: string };
  return b.config ? [200, { ...REPORT_OK, yaml: `guard: ${guardOf(b.config)}\n` }] as [number, unknown] : undefined;
};

/** Opens the YAML tab of a page whose draft has not been edited, and waits for the text. */
async function openYaml(server: ReturnType<typeof liveServer>) {
  server.reply = (m, p, body) => (p === "/llm-config/validate" ? yamlOfDraft(body) : undefined);
  await renderAdmin(<ModelsView />);
  await screen.findByLabelText("preset ที่กำลังแก้");
  fireEvent.click(screen.getByRole("button", YAML_TAB));
  await waitFor(() => expect(yamlBox()).toHaveValue("guard: vendor/cheap\n"));
}

describe("ModelsView YAML tab", () => {
  it("blocks the save while the text is not applied, says why, and saves the applied text once it is", async () => {
    const server = liveServer();
    const applied: LlmConfigDoc = { ...CONFIG, presets: { ...CONFIG.presets, cheap: { ...CONFIG.presets.cheap, guard: { model: "vendor/yaml" } } } };
    await openYaml(server);
    expect(screen.getByRole("button", SAVE)).toBeEnabled();
    expect(screen.queryByText(PENDING_REASON)).not.toBeInTheDocument();
    fireEvent.change(yamlBox(), { target: { value: "guard: vendor/yaml\n" } });
    expect(screen.getByRole("button", SAVE)).toBeDisabled();
    expect(screen.getByText(PENDING_REASON)).toBeVisible();
    expect(screen.getByRole("button", { name: "ตรวจ" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(saveRequests(server)).toHaveLength(0); // the old draft is not saved behind the admin's back
    server.reply = (m, p, body) => (p === "/llm-config/validate" && (body as { yaml?: string }).yaml !== undefined
      ? [200, { ...REPORT_OK, config: applied, yaml: "guard: vendor/yaml\n" }] : undefined);
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    expect(screen.queryByText(PENDING_REASON)).not.toBeInTheDocument();
    acceptsSaveAs(server, 4, movedTo(4, "vendor/yaml"));
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 4 แล้ว")).toBeInTheDocument();
    expect(saveRequests(server)).toHaveLength(1);
    expect(guardOf(saveRequests(server)[0].body.config)).toBe("vendor/yaml");
    expect(saveRequests(server)[0].body.base_version).toBe(3); // applying text does not change the version the draft is built on
  });

  it("keeps the typed text when the tab is left, marks the tab, and still blocks the save on the presets tab", async () => {
    const server = liveServer();
    await openYaml(server);
    fireEvent.change(yamlBox(), { target: { value: "guard: typed\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    expect(screen.getByRole("button", YAML_TAB_PENDING)).toHaveTextContent("•");
    expect(screen.getByTitle("มีข้อความ YAML ที่ยังไม่ได้ใช้")).toBeInTheDocument();
    expect(yamlBox()).not.toBeVisible();
    expect(screen.getByRole("button", SAVE)).toBeDisabled();
    expect(screen.getByText(PENDING_REASON)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "ประวัติ" }));
    expect(screen.getByRole("button", YAML_TAB_PENDING)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", YAML_TAB_PENDING));
    expect(yamlBox()).toBeVisible();
    expect(yamlBox()).toHaveValue("guard: typed\n");
    expect(screen.getByRole("button", SAVE)).toBeDisabled();
  });

  it("builds the text from the draft again on each visit when nothing is pending", async () => {
    const server = liveServer();
    await openYaml(server);
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    expect(screen.queryByLabelText("YAML ของร่าง")).not.toBeInTheDocument(); // nothing to keep, so nothing stays
    fireEvent.change(guardModel(), { target: { value: "vendor/edited" } });
    fireEvent.click(screen.getByRole("button", YAML_TAB));
    await waitFor(() => expect(yamlBox()).toHaveValue("guard: vendor/edited\n"));
  });

  it("treats an applied text that equals the version it was loaded from as a clean draft", async () => {
    const server = liveServer();
    await openYaml(server);
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    fireEvent.change(guardModel(), { target: { value: "vendor/mine" } });
    fireEvent.click(screen.getByRole("button", YAML_TAB));
    await waitFor(() => expect(yamlBox()).toHaveValue("guard: vendor/mine\n"));
    fireEvent.change(yamlBox(), { target: { value: "guard: vendor/cheap\n" } });
    server.reply = (m, p, body) => (p === "/llm-config/validate" && (body as { yaml?: string }).yaml !== undefined
      ? [200, { ...REPORT_OK, config: CONFIG, yaml: "guard: vendor/cheap\n" }] : undefined);
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    await restoreElsewhere(server, movedTo(4, "vendor/restored"));
    expect(guardModel()).toHaveValue("vendor/restored"); // no edits left to protect, so the draft follows the server
    expect(screen.queryByText(/ร่างนี้แก้จากเวอร์ชัน/)).not.toBeInTheDocument();
  });

  it("drops the typed text with the rest of the draft when the admin discards the edits", async () => {
    const server = liveServer();
    await openYaml(server);
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    fireEvent.change(guardModel(), { target: { value: "vendor/mine" } });
    await restoreElsewhere(server, movedTo(4, "vendor/theirs"));
    server.reply = (m, p, body) => (p === "/llm-config/validate" ? yamlOfDraft(body) : undefined);
    fireEvent.click(screen.getByRole("button", YAML_TAB));
    await waitFor(() => expect(yamlBox()).toHaveValue("guard: vendor/mine\n"));
    fireEvent.change(yamlBox(), { target: { value: "guard: typed\n" } });
    expect(screen.getByRole("button", SAVE)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "ทิ้งการแก้ไข" }));
    expect(screen.getByText(/รวมถึงข้อความ YAML ที่พิมพ์ไว้แต่ยังไม่ได้ใช้/)).toBeInTheDocument(); // the hint says what goes
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" }));
    await waitFor(() => expect(yamlBox()).toHaveValue("guard: vendor/theirs\n"));
    expect(screen.getByRole("button", SAVE)).toBeEnabled();
    expect(screen.queryByText(PENDING_REASON)).not.toBeInTheDocument();
    expect(screen.getByRole("button", YAML_TAB)).toBeInTheDocument(); // no pending mark
  });
});

describe("ModelsView refused save", () => {
  /** Edits the guard model, saves, and the server refuses with 409 (it has moved to version 5). The first check of the
   * draft (the save's own) returns the refused text; every later one returns "later: <the draft's guard model>". */
  async function refused() {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    let checks = 0;
    server.reply = (m, p, body) => {
      if (p === "/llm-config/validate" && (body as { config?: unknown }).config) {
        return [200, { ...REPORT_OK, yaml: ++checks === 1 ? "refused: draft\n" : `later: ${guardOf((body as { config: unknown }).config)}\n` }];
      }
      if (m === "POST" && p === "/llm-config") {
        server.state = movedTo(5, "vendor/theirs");
        return [409, { detail: "version 5 is in use now" }];
      }
    };
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText(MOVED(3, 5))).toBeInTheDocument(); // the re-read that follows the 409 has landed
    return server;
  }

  it("shows the refused draft as YAML, and it is still there after the re-read that follows", async () => {
    const server = await refused();
    expect(server.calls.filter((c) => c === "GET /llm-config")).toHaveLength(2);
    expect(screen.getByRole("button", YAML_TAB)).toHaveAttribute("aria-pressed", "true");
    expect(yamlBox()).toHaveValue("refused: draft\n");
    fireEvent.click(screen.getByRole("button", { name: "Presets" })); // the draft is unchanged, so the text still describes it
    fireEvent.click(screen.getByRole("button", YAML_TAB));
    expect(yamlBox()).toHaveValue("refused: draft\n");
  });

  it("forgets the refused text once the draft changes, because it no longer describes the draft", async () => {
    await refused();
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    fireEvent.change(guardModel(), { target: { value: "vendor/edited-again" } });
    fireEvent.click(screen.getByRole("button", YAML_TAB));
    await waitFor(() => expect(yamlBox()).toHaveValue("later: vendor/edited-again\n"));
  });

  it("forgets the refused text when the admin discards the draft", async () => {
    await refused();
    fireEvent.click(screen.getByRole("button", { name: "ทิ้งการแก้ไข" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" }));
    await waitFor(() => expect(yamlBox()).toHaveValue("later: vendor/theirs\n"));
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    fireEvent.click(screen.getByRole("button", YAML_TAB));
    await waitFor(() => expect(yamlBox()).toHaveValue("later: vendor/theirs\n"));
  });

  it("forgets the refused text when the admin restarts the text from the draft", async () => {
    await refused();
    fireEvent.click(screen.getByRole("button", { name: "เริ่มจากร่างปัจจุบัน" }));
    await waitFor(() => expect(yamlBox()).toHaveValue("later: vendor/mine\n"));
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    fireEvent.click(screen.getByRole("button", YAML_TAB));
    await waitFor(() => expect(yamlBox()).toHaveValue("later: vendor/mine\n"));
  });

  it("forgets the refused text after a successful save", async () => {
    const server = await refused();
    fireEvent.click(screen.getByRole("button", { name: "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด" }));
    expect(yamlBox()).toHaveValue("refused: draft\n"); // building on the latest changes the base, not the draft
    const refusal = server.reply;
    server.reply = (m, p, body) => {
      if (m === "POST" && p === "/llm-config") {
        server.state = movedTo(6, "vendor/mine");
        return [201, { ...VERSIONS.items[0], id: 6, workers_notified: true }];
      }
      return refusal(m, p, body);
    };
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 6 แล้ว")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    fireEvent.click(screen.getByRole("button", YAML_TAB));
    await waitFor(() => expect(yamlBox()).toHaveValue("later: vendor/mine\n"));
  });
});

describe("ModelsView catalog tab", () => {
  it("puts a catalog model into the draft, which the presets tab then shows and the save sends", async () => {
    const server = liveServer();
    server.reply = (m, p) => (p.startsWith("/llm-models")
      ? [200, { items: [{ id: "qwen/qwen3.5-flash", context_length: 128000, price_in_per_m: 0.1, price_out_per_m: 0.4, structured: true, tools: true, reasoning: true }], available: true }]
      : undefined);
    await renderAdmin(<ModelsView />);
    await screen.findByLabelText("preset ที่กำลังแก้");
    fireEvent.click(screen.getByRole("button", { name: "Catalog" }));
    expect(screen.queryByRole("button", SAVE)).not.toBeInTheDocument();
    const row = await screen.findByRole("row", { name: /qwen\/qwen3\.5-flash/ });
    fireEvent.change(screen.getByLabelText("ใส่ใน role"), { target: { value: "cheap.guard" } });
    fireEvent.click(within(row).getByRole("button", { name: "ใช้กับ role ที่เลือก" }));
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    expect(guardModel()).toHaveValue("qwen/qwen3.5-flash");
    acceptsSaveAs(server, 4, movedTo(4, "qwen/qwen3.5-flash"));
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 4 แล้ว")).toBeInTheDocument();
    expect(guardOf(saveRequests(server)[0].body.config)).toBe("qwen/qwen3.5-flash");
  });
});

describe("ModelsView YAML text and edits made in other tabs", () => {
  const CONFIRM = { name: "ใช้ YAML นี้ และทับการแก้ไขในแท็บอื่น" };
  const DIVERGED = "ร่างเปลี่ยนไปหลังจากโหลดข้อความนี้ (เช่น แก้ในแท็บ Presets หรือ Catalog) การใช้ YAML นี้จะทับการแก้ไขนั้น";
  const applied: LlmConfigDoc = { ...CONFIG, presets: { ...CONFIG.presets, cheap: { ...CONFIG.presets.cheap, guard: { model: "vendor/yaml" } } } };
  /** Checking the draft returns its YAML; checking text returns `applied`. */
  const appliesYaml = (server: ReturnType<typeof liveServer>) => {
    server.reply = (m, p, body) => (p !== "/llm-config/validate" ? undefined
      : (body as { yaml?: string }).yaml !== undefined ? [200, { ...REPORT_OK, config: applied, yaml: "guard: vendor/yaml\n" }] : yamlOfDraft(body));
  };

  it("asks before it replaces an edit made in the presets tab, and the draft is untouched until the admin confirms", async () => {
    const server = liveServer();
    await openYaml(server);
    fireEvent.change(yamlBox(), { target: { value: "guard: vendor/yaml\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    fireEvent.change(guardModel(), { target: { value: "vendor/elsewhere" } });
    fireEvent.click(screen.getByRole("button", YAML_TAB_PENDING));
    appliesYaml(server);
    expect(screen.getByText(DIVERGED)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    expect(screen.getByRole("button", CONFIRM)).toBeInTheDocument();
    expect(screen.getByRole("button", SAVE)).toBeDisabled(); // nothing applied yet
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    expect(guardModel()).toHaveValue("vendor/elsewhere");
    fireEvent.click(screen.getByRole("button", YAML_TAB_PENDING));
    fireEvent.click(screen.getByRole("button", CONFIRM));
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    expect(screen.queryByText(DIVERGED)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" })); // the draft is the text's now: no second question
    expect(screen.queryByRole("button", CONFIRM)).not.toBeInTheDocument();
    await screen.findByText(/ใช้ YAML นี้เป็นร่างแล้ว/);
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    expect(guardModel()).toHaveValue("vendor/yaml");
  });

  it("asks as well when the draft was replaced by a history restore", async () => {
    const server = liveServer();
    await openYaml(server);
    fireEvent.change(yamlBox(), { target: { value: "guard: vendor/yaml\n" } });
    await restoreElsewhere(server, movedTo(4, "vendor/restored")); // a clean draft follows the server
    expect(guardModel()).toHaveValue("vendor/restored");
    appliesYaml(server);
    fireEvent.click(screen.getByRole("button", YAML_TAB_PENDING));
    expect(screen.getByText(DIVERGED)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    expect(screen.getByRole("button", CONFIRM)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    expect(guardModel()).toHaveValue("vendor/restored"); // still the server's
  });
});

describe("ModelsView refused save of a draft without edits", () => {
  it("forgets the refused text when the re-read replaces the draft", async () => {
    const server = liveServer();
    await renderAdmin(<ModelsView />);
    await screen.findByLabelText("model ของ guard");
    let checks = 0;
    server.reply = (m, p, body) => {
      if (p === "/llm-config/validate" && (body as { config?: unknown }).config) {
        return [200, { ...REPORT_OK, yaml: ++checks === 1 ? "refused: draft\n" : `later: ${guardOf((body as { config: unknown }).config)}\n` }];
      }
      if (m === "POST" && p === "/llm-config") {
        server.state = movedTo(5, "vendor/theirs");
        return [409, { detail: "version 5 is in use now" }];
      }
    };
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText(/ใช้เวอร์ชัน 5 จาก DB/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    expect(guardModel()).toHaveValue("vendor/theirs"); // a draft without edits follows the server
    fireEvent.click(screen.getByRole("button", YAML_TAB));
    await waitFor(() => expect(yamlBox()).toHaveValue("later: vendor/theirs\n")); // not the text of the draft that was replaced
  });
});

describe("ModelsView with LLM_PRESET on the file source: the draft starts from the preset the workers run", () => {
  // llm.yaml says cheap, LLM_PRESET=better is what the workers run (the service reports it as active_preset)
  const onBetter: LlmConfigState = {
    ...STATE, source: "file", version: null, env_preset: "better", active_preset: "better",
    loaded: [{ ...STATE.loaded[0], version: "file", preset: "better" }],
  };

  it("marks the running preset in the presets tab, like the header, and a first save keeps it", async () => {
    const server = liveServer();
    server.state = onBetter;
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText(/preset ที่ใช้งาน: better/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "better (ใช้งาน)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "cheap" })).toBeInTheDocument();
    expect(screen.queryByText(/ร่างนี้แก้จากเวอร์ชัน/)).not.toBeInTheDocument();
    acceptsSaveAs(server, 1, { ...movedTo(1), env_preset: "better", active_preset: "cheap" });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 1 แล้ว")).toBeInTheDocument();
    const sent = saveRequests(server)[0].body;
    expect((sent.config as LlmConfigDoc).active_preset).toBe("better");
    expect(sent.base_version).toBeNull();
  });

  it("lets the admin change the active preset, which then differs from what was running", async () => {
    const server = liveServer();
    server.state = onBetter;
    await renderAdmin(<ModelsView />);
    await screen.findByLabelText("preset ที่กำลังแก้");
    fireEvent.change(screen.getByLabelText("preset ที่กำลังแก้"), { target: { value: "cheap" } });
    fireEvent.click(screen.getByRole("button", { name: "ตั้งเป็น preset ที่ใช้งาน" }));
    acceptsSaveAs(server, 1, movedTo(1));
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 1 แล้ว")).toBeInTheDocument();
    expect((saveRequests(server)[0].body.config as LlmConfigDoc).active_preset).toBe("cheap");
  });

  it("counts the seeded draft as clean, so a reload still follows the server", async () => {
    const server = liveServer();
    server.state = onBetter;
    await renderAdmin(<ModelsView />);
    expect(await screen.findByLabelText("model ของ guard")).toHaveValue("vendor/better");
    await restoreElsewhere(server, movedTo(4, "vendor/restored"));
    expect(guardModel()).toHaveValue("vendor/restored"); // an origin without the seed would make the draft look edited
    expect(screen.queryByText(/ร่างนี้แก้จากเวอร์ชัน/)).not.toBeInTheDocument();
  });

  it("does not seed when a DB version is in use (LLM_PRESET has no effect then)", async () => {
    const server = liveServer();
    server.state = { ...STATE, env_preset: "better", active_preset: "cheap" };
    await renderAdmin(<ModelsView />);
    expect(await screen.findByRole("option", { name: "cheap (ใช้งาน)" })).toBeInTheDocument();
  });

  it("does not seed a preset that does not exist, and the header warns that the workers cannot start", async () => {
    const server = liveServer();
    server.state = { ...STATE, source: "file", version: null, env_preset: "nope", active_preset: "nope" };
    await renderAdmin(<ModelsView />);
    const warning = await screen.findByText("LLM_PRESET=nope ไม่มีใน presets: worker จะเริ่มไม่ได้");
    expect(warning).toHaveClass("bg-warn-bg");
    expect(screen.queryByText(/มีผลอยู่ \(ใช้ llm.yaml\)/)).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "cheap (ใช้งาน)" })).toBeInTheDocument(); // the file's own preset, not "nope"
  });
});

describe("ModelsHeader LLM_PRESET line", () => {
  it("is the info line for a preset that exists and the warning for one that does not", () => {
    const base = { ...STATE, source: "file" as const, version: null };
    const { rerender } = render(<ModelsHeader state={{ ...base, env_preset: "better" }} now={SEEN + 30_000} />);
    expect(screen.getByText("LLM_PRESET=better มีผลอยู่ (ใช้ llm.yaml)")).toHaveClass("bg-info-bg");
    rerender(<ModelsHeader state={{ ...base, env_preset: "constructor" }} now={SEEN + 30_000} />);
    expect(screen.getByText("LLM_PRESET=constructor ไม่มีใน presets: worker จะเริ่มไม่ได้")).toHaveClass("bg-warn-bg");
  });
});

describe("ModelsHeader right after this page's own write", () => {
  const behind = { ...STATE, loaded: [{ ...STATE.loaded[0], version: "2" }] };

  it("says the worker is changing instead of warning, while it settles", () => {
    render(<ModelsHeader state={behind} now={SEEN + 30_000} settling />);
    const line = screen.getByText(/worker-1:7/);
    expect(line).toHaveTextContent(" · กำลังเปลี่ยนเป็นเวอร์ชัน 3 (ภายใน 30 วินาที)");
    expect(line).not.toHaveTextContent("ไม่ตรงกับเวอร์ชันที่ใช้");
    expect(line).not.toHaveClass("bg-warn-bg");
  });

  it("still warns about an error or a silent worker while it settles", () => {
    render(<ModelsHeader state={{ ...behind, loaded: [{ ...behind.loaded[0], error: "boom" }] }} now={SEEN + 30_000} settling />);
    expect(screen.getByText(/worker-1:7/)).toHaveClass("bg-warn-bg");
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent("error: boom");
  });

  it("warns as before when it is not settling", () => {
    render(<ModelsHeader state={behind} now={SEEN + 30_000} />);
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent("ไม่ตรงกับเวอร์ชันที่ใช้");
  });
});

/** The page after a save, with the clock under test: setInterval/setTimeout/Date are fake, microtasks and the DOM are real. */
describe("ModelsView re-reads while a worker is catching up", () => {
  const TICK = 10_000;
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], now: SEEN + 30_000 });
    // Testing Library only waits through fake timers when it finds a `jest` global; vitest's clock is the same library
    vi.stubGlobal("jest", { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  });
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  /** One worker that heartbeats on every read (loaded_at is "now") and runs `worker`; the server is on `version`. */
  function pollingServer(start: { version: number; worker: string; seenAgoMs?: number }) {
    const s = { version: start.version, worker: start.worker, gets: 0, posts: 0 };
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/llm-config") {
        s.gets += 1;
        const loaded_at = new Date(Date.now() - (start.seenAgoMs ?? 0)).toISOString();
        return [200, { ...STATE, version: s.version, loaded: [{ ...STATE.loaded[0], version: s.worker, loaded_at }] }];
      }
      if (m === "GET" && p.startsWith("/llm-config/versions")) return [200, VERSIONS];
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") { s.posts += 1; s.version += 1; return [201, { ...VERSIONS.items[0], id: s.version, workers_notified: true }]; }
    });
    return s;
  }
  const worker = () => screen.getByText(/worker-1:7/);

  async function saveOnce() {
    fireEvent.click(screen.getByRole("button", SAVE));
    await screen.findByText(/บันทึกเป็นเวอร์ชัน \d+ แล้ว/);
    await advance(0);
  }

  it("polls every 10 s after a save until the workers report the new version, then stops", async () => {
    const s = pollingServer({ version: 3, worker: "3" });
    await renderAdmin(<ModelsView />);
    await screen.findByText(/ใช้เวอร์ชัน 3 จาก DB/);
    await saveOnce();
    expect(worker()).toHaveTextContent(" · กำลังเปลี่ยนเป็นเวอร์ชัน 4 (ภายใน 30 วินาที)");
    const afterSave = s.gets;
    await advance(TICK);
    expect(s.gets).toBe(afterSave + 1);
    expect(worker()).toHaveTextContent("กำลังเปลี่ยนเป็นเวอร์ชัน 4");
    s.worker = "4";
    await advance(TICK);
    expect(s.gets).toBe(afterSave + 2);
    expect(worker()).not.toHaveTextContent("กำลังเปลี่ยน");
    expect(worker()).not.toHaveClass("bg-warn-bg");
    await advance(5 * 60_000);
    expect(s.gets).toBe(afterSave + 2);
  });

  it("gives up after 2 minutes and brings the warning back after 60 s", async () => {
    const s = pollingServer({ version: 3, worker: "3" });
    await renderAdmin(<ModelsView />);
    await screen.findByText(/ใช้เวอร์ชัน 3 จาก DB/);
    await saveOnce();
    const afterSave = s.gets;
    await advance(59_000);
    expect(worker()).toHaveTextContent("กำลังเปลี่ยนเป็นเวอร์ชัน 4");
    await advance(2_000);
    expect(worker()).toHaveTextContent("ไม่ตรงกับเวอร์ชันที่ใช้");
    expect(worker()).toHaveClass("bg-warn-bg");
    expect(worker()).not.toHaveTextContent("กำลังเปลี่ยน");
    await advance(70_000);
    const polled = s.gets - afterSave;
    expect(polled).toBeGreaterThanOrEqual(10);
    expect(polled).toBeLessThanOrEqual(12);
    await advance(10 * 60_000);
    expect(s.gets - afterSave).toBe(polled);
  });

  it("starts a fresh 2 minutes with the next save", async () => {
    const s = pollingServer({ version: 3, worker: "3" });
    await renderAdmin(<ModelsView />);
    await screen.findByText(/ใช้เวอร์ชัน 3 จาก DB/);
    await saveOnce();
    await advance(5 * 60_000);
    const idle = s.gets;
    await advance(TICK);
    expect(s.gets).toBe(idle);
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    await saveOnce();
    const afterSecond = s.gets;
    await advance(TICK);
    expect(s.gets).toBe(afterSecond + 1);
  });

  it("does not read while a save is in flight, and reads again once it has finished", async () => {
    const s = pollingServer({ version: 3, worker: "2" }); // a worker is behind from the start: the page is already polling
    await renderAdmin(<ModelsView />);
    await screen.findByText(/ใช้เวอร์ชัน 3 จาก DB/);
    await advance(TICK);
    expect(s.gets).toBe(2);
    const inner = globalThis.fetch;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST" && new URL(String(input), "http://site.test").pathname.endsWith("/llm-config")) await gate;
      return inner(input, init);
    }));
    fireEvent.click(screen.getByRole("button", SAVE));
    await advance(0); // the check is answered, the save is held
    expect(s.posts).toBe(0);
    await advance(35_000);
    expect(s.gets).toBe(2); // three ticks came and went without a read
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    await screen.findByText("บันทึกเป็นเวอร์ชัน 4 แล้ว");
    expect(s.gets).toBe(3); // the save's own re-read
    await advance(TICK);
    expect(s.gets).toBe(4);
  });

  it("drops a read that began before a save, so it cannot land ahead of the save's own re-read", async () => {
    const s = pollingServer({ version: 3, worker: "2" });
    await renderAdmin(<ModelsView />);
    await screen.findByText(/ใช้เวอร์ชัน 3 จาก DB/);
    const inner = globalThis.fetch;
    const gates: (() => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const get = (init?.method ?? "GET") === "GET" && new URL(String(input), "http://site.test").pathname.endsWith("/llm-config");
      if (get) await new Promise<void>((resolve) => gates.push(resolve)); // every read waits for its turn
      return inner(input, init);
    }));
    await advance(TICK); // the poll's read starts and waits
    expect(gates).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", SAVE));
    await advance(0); // the check and the save are answered (version 4), the save's re-read waits
    expect(s.posts).toBe(1);
    expect(gates).toHaveLength(2);
    await act(async () => { gates[0](); await vi.advanceTimersByTimeAsync(0); }); // the poll's read is answered with version 4
    expect(screen.getByText(/ใช้เวอร์ชัน 3 จาก DB/)).toBeInTheDocument(); // ... and dropped: the page waits for its own re-read
    await act(async () => { gates[1](); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText(/ใช้เวอร์ชัน 4 จาก DB/)).toBeInTheDocument();
  });

  it("keeps unsaved edits through a background read", async () => {
    const s = pollingServer({ version: 3, worker: "2" });
    await renderAdmin(<ModelsView />);
    fireEvent.change(await screen.findByLabelText("model ของ guard"), { target: { value: "vendor/mine" } });
    await advance(TICK);
    expect(s.gets).toBe(2);
    expect(guardModel()).toHaveValue("vendor/mine");
  });

  it("does not poll for a worker that has gone quiet", async () => {
    const s = pollingServer({ version: 3, worker: "2", seenAgoMs: 5 * 60_000 });
    await renderAdmin(<ModelsView />);
    const line = await screen.findByText(/worker-1:7/);
    expect(line).toHaveTextContent("ไม่ได้รายงานเกิน 2 นาที");
    await advance(60_000);
    expect(s.gets).toBe(1);
  });

  it("clears its timers when the page goes away", async () => {
    const s = pollingServer({ version: 3, worker: "2" });
    const { unmount } = await renderAdmin(<ModelsView />);
    await screen.findByText(/ใช้เวอร์ชัน 3 จาก DB/);
    const running = vi.getTimerCount();
    unmount();
    expect(vi.getTimerCount()).toBeLessThan(running); // the poller's timer went with the page
    await advance(60_000);
    expect(s.gets).toBe(1);
  });

  it("also settles after a restore from the history tab", async () => {
    const s = pollingServer({ version: 3, worker: "3" });
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://site.test").pathname;
      if ((init?.method ?? "GET") === "POST" && path.endsWith("/versions/2/restore")) {
        s.version = 4;
        return new Response(JSON.stringify({ ...VERSIONS.items[0], id: 4, source: "restore", restored_from: 2, workers_notified: true }),
          { status: 201, headers: { "Content-Type": "application/json" } });
      }
      return base(input, init);
    }));
    await renderAdmin(<ModelsView />);
    fireEvent.click(await screen.findByRole("button", { name: "ประวัติ" }));
    const v2 = await screen.findByRole("listitem", { name: /เวอร์ชัน 2/ });
    fireEvent.click(within(v2).getByRole("button", { name: "ย้อนกลับไปเวอร์ชันนี้" }));
    fireEvent.click(within(v2).getByRole("button", { name: "ยืนยันย้อนกลับ" }));
    await screen.findByText(/ใช้เวอร์ชัน 4 จาก DB/);
    await advance(0);
    expect(worker()).toHaveTextContent("กำลังเปลี่ยนเป็นเวอร์ชัน 4");
    const afterRestore = s.gets;
    s.worker = "4";
    await advance(TICK);
    expect(s.gets).toBe(afterRestore + 1);
    expect(worker()).not.toHaveTextContent("กำลังเปลี่ยน");
  });
});

describe("ModelsView with a configuration that no longer passes the checks", () => {
  it("says why and offers the history to restore or rebuild, with no editor", async () => {
    const unreadable = { ...STATE, version: 4, config: { active_preset: "cheap" } as LlmConfigDoc, keys_present: {},
      error: "version 4: harness.screen_borderline must be [low, high] with 0 <= low <= high <= 100" };
    mockAdminFetch(routes(unreadable));
    await renderAdmin(<ModelsView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("เวอร์ชัน 4 ที่ใช้อยู่ไม่ผ่านการตรวจตามกฎปัจจุบันแล้ว");
    expect(screen.getByRole("alert")).toHaveTextContent("screen_borderline");
    expect(screen.queryByRole("button", { name: "Presets" })).toBeNull();
    expect(screen.queryByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" })).toBeNull();
    expect(await screen.findByRole("listitem", { name: /เวอร์ชัน 3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "สร้างเวอร์ชันใหม่จาก llm.yaml" })).toBeInTheDocument();
  });
});
