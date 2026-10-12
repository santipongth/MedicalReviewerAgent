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
    reply: ((): [number, unknown] | undefined => undefined) as (method: string, path: string) => [number, unknown] | undefined,
  };
  mockAdminFetch((m, p, body) => {
    server.calls.push(`${m} ${p}`);
    if (m === "POST") server.posts.push({ path: p, body: body as Record<string, unknown> });
    const custom = server.reply(m, p);
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
