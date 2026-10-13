import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminReply } from "@/test/admin-fetch";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { NO_SEARXNG, SOURCES, SOURCES_VERSIONS, SOURCES_WORKER, WARN_BIOMEDICAL } from "@/test/admin-sources-fixtures";
import { SourcesView } from "./sources-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/sources" }));

const SEEN = Date.parse(SOURCES_WORKER.loaded_at);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SEEN + 30_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nav.replace.mockReset(); });

const SAVE = { name: "บันทึกเป็นเวอร์ชันใหม่" };
const ALL_ON = Object.fromEntries(SOURCES.sources.map((s) => [s.id, true]));
const routes = (state = SOURCES) => (m: string, p: string): AdminReply | undefined =>
  m === "GET" && p === "/sources" ? [200, state] : m === "GET" && p.startsWith("/sources/versions") ? [200, SOURCES_VERSIONS] : undefined;
const savedAs = (version: number): AdminReply => [201, { ...SOURCES_VERSIONS.items[0], version, workers_notified: true }];
const toggle = (name: string) => fireEvent.click(screen.getByRole("switch", { name: new RegExp(`^${name} (เปิด|ปิด)$`) }));

describe("SourcesView", () => {
  it("lists the SearXNG sources and ThaiJO with their env default, the state and the worker", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<SourcesView />);
    expect(await screen.findByText("ใช้เวอร์ชัน 1 จาก DB")).toBeInTheDocument();
    const searxng = screen.getByRole("list", { name: "ผ่าน SearXNG" });
    expect(within(searxng).getAllByRole("switch")).toHaveLength(8);
    const direct = screen.getByRole("list", { name: "เรียกตรง" });
    expect(within(direct).getByRole("switch", { name: /^ThaiJO (เปิด|ปิด)$/ })).toHaveAttribute("aria-checked", "true");
    expect(direct).toHaveTextContent("ไม่เกิน 1/8 ของ pool");
    const openaire = screen.getByRole("switch", { name: /^OpenAIRE (เปิด|ปิด)$/ });
    expect(openaire).toHaveAttribute("aria-checked", "false");
    const row = openaire.closest("li") as HTMLElement;
    expect(row).toHaveTextContent("ค่า env: เปิด");
    expect(row).toHaveTextContent("ต่างจาก env");
    expect(screen.getByRole("switch", { name: /^Europe PMC (เปิด|ปิด)$/ }).closest("li")).toHaveTextContent("รวม preprint medRxiv/bioRxiv และการค้น RCT");
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent("ตรงกับที่ใช้งาน");
  });

  it("checks a draft and shows the warnings, then the minimum as an error", async () => {
    const checked: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/sources/validate") {
        checked.push(body);
        const sources = (body as { sources: Record<string, boolean> }).sources;
        if (!Object.entries(sources).some(([id, on]) => on && id !== "thaijo")) {
          return [200, { ok: false, errors: [{ field: "sources", message: NO_SEARXNG }], warnings: [], document: null, enabled: null }];
        }
        return [200, { ok: true, errors: [], warnings: [WARN_BIOMEDICAL], document: { sources: {} },
          enabled: Object.keys(sources).filter((id) => sources[id]) }];
      }
      return routes()(m, p);
    });
    await renderAdmin(<SourcesView />);
    await screen.findByRole("switch", { name: /^PubMed (เปิด|ปิด)$/ });
    toggle("PubMed");
    toggle("Europe PMC");
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    const warning = await screen.findByText(WARN_BIOMEDICAL);
    expect(warning.closest("ul")).toHaveClass("bg-warn-bg");
    expect(screen.getByText(/^จะค้น 6 แหล่ง: OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ, ThaiJO$/)).toBeInTheDocument();
    for (const name of ["OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ"]) toggle(name);
    expect(screen.queryByText(WARN_BIOMEDICAL)).toBeNull(); // the check was of another draft
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(NO_SEARXNG);
    expect(checked[1]).toEqual({ sources: { ...ALL_ON, pubmed: false, europepmc: false, openalex: false, semantic_scholar: false,
      crossref: false, arxiv: false, doaj: false, openaire: false } });
  });

  it("saves the whole set on the version the draft came from", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/sources") { posted.push(body); return savedAs(2); }
      return routes()(m, p);
    });
    await renderAdmin(<SourcesView />);
    await screen.findByRole("switch", { name: /^OpenAIRE (เปิด|ปิด)$/ });
    toggle("OpenAIRE");
    expect(screen.getByRole("switch", { name: /^OpenAIRE (เปิด|ปิด)$/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: /^OpenAIRE (เปิด|ปิด)$/ }).closest("li")).not.toHaveTextContent("ต่างจาก env");
    toggle("ThaiJO");
    fireEvent.change(screen.getByLabelText("หมายเหตุ (ไม่บังคับ)"), { target: { value: "openaire is back" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 2 แล้ว")).toBeInTheDocument();
    expect(posted).toEqual([{ sources: { ...ALL_ON, thaijo: false }, base_version: 1, note: "openaire is back" }]);
  });

  it("gives each switch an accessible name that holds its visible state", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<SourcesView />);
    expect(await screen.findByRole("switch", { name: "PubMed เปิด" })).toHaveTextContent("เปิด");
    toggle("PubMed");
    expect(screen.getByRole("switch", { name: "PubMed ปิด" })).toHaveAttribute("aria-checked", "false");
  });

  describe("a save the server refuses with 422", () => {
    const MSG = "sources.pubmed: refused by the server";
    const refuse = (): AdminReply => [422, { detail: MSG, errors: [{ field: "sources.pubmed", message: MSG }] }];
    const slowSave = () => {
      let answer: () => void = () => {};
      const inner = mockAdminFetch((m, p) => (m === "POST" && p === "/sources" ? refuse() : routes()(m, p)));
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") await new Promise<void>((resolve) => { answer = resolve; });
        return inner(input, init);
      });
      return () => answer();
    };

    it("shows the check errors when the draft is unchanged since the save was sent", async () => {
      const answer = slowSave();
      await renderAdmin(<SourcesView />);
      await screen.findByRole("switch", { name: /^PubMed (เปิด|ปิด)$/ });
      toggle("OpenAIRE");
      fireEvent.click(screen.getByRole("button", SAVE));
      await act(async () => { answer(); });
      expect(await screen.findByRole("alert")).toHaveTextContent("ยังบันทึกไม่ได้");
      expect(screen.getByText(MSG)).toHaveAttribute("id", "source-pubmed-error");
    });

    it("shows the generic error notice when the draft was edited while the save was in flight", async () => {
      const answer = slowSave();
      await renderAdmin(<SourcesView />);
      await screen.findByRole("switch", { name: /^PubMed (เปิด|ปิด)$/ });
      toggle("OpenAIRE");
      fireEvent.click(screen.getByRole("button", SAVE));
      toggle("arXiv"); // edited meanwhile
      await act(async () => { answer(); });
      expect(await screen.findByRole("alert")).toHaveTextContent(MSG);
      expect(document.getElementById("source-pubmed-error")).toBeNull();
    });
  });

  it("re-reads after a 409, keeps the draft, and saves on the latest version once asked to", async () => {
    let version = 1;
    const posted: { base_version: number | null }[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p === "/sources") return [200, { ...SOURCES, version }];
      if (m === "POST" && p === "/sources") {
        posted.push(body as { base_version: number | null });
        if (posted.length === 1) { version = 4; return [409, { detail: "version 4 is in use now; reload the latest version and try again" }]; }
        return savedAs(5);
      }
      return routes()(m, p);
    });
    await renderAdmin(<SourcesView />);
    await screen.findByRole("switch", { name: /^arXiv (เปิด|ปิด)$/ });
    toggle("arXiv");
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByRole("alert")).toHaveTextContent("มีผู้ดูแลอีกคนบันทึกเวอร์ชันใหม่ก่อน");
    expect(await screen.findByText("ใช้เวอร์ชัน 4 จาก DB")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /^arXiv (เปิด|ปิด)$/ })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด" }));
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 5 แล้ว")).toBeInTheDocument();
    expect(posted.map((b) => b.base_version)).toEqual([1, 4]);
  });

  it("lists env-only engines read-only, shows a stored version's problem and a lagging or failed worker", async () => {
    mockAdminFetch(routes({ ...SOURCES, extras: ["plos"], error: "the saved version leaves no SearXNG source on",
      loaded: [{ ...SOURCES_WORKER, worker: "behind:1", sources: "env" }, { ...SOURCES_WORKER, worker: "broken:2", runtime_error: "db down" }] }));
    await renderAdmin(<SourcesView />);
    const extras = await screen.findByRole("list", { name: "ตั้งใน env เท่านั้น" });
    expect(extras).toHaveTextContent("plos");
    expect(within(extras).queryByRole("switch")).toBeNull();
    expect(screen.getByText(/เวอร์ชันที่ใช้อยู่มีปัญหา/)).toHaveTextContent("leaves no SearXNG source on");
    expect(screen.getByText(/behind:1/)).toHaveTextContent("ยังใช้ env");
    expect(screen.getByText(/broken:2/)).toHaveTextContent("โหลดไม่สำเร็จ: db down");
  });

  it("shows the history of the sources versions", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<SourcesView />);
    fireEvent.click(await screen.findByRole("button", { name: "ประวัติ" }));
    const item = await screen.findByRole("listitem", { name: "เวอร์ชัน 1" });
    expect(item).toHaveTextContent("openaire: env → off");
  });
});
