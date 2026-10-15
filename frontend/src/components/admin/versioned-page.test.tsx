import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminGate } from "@/components/admin/admin-gate";
import type { LoadedWorker } from "@/lib/admin-types";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { DraftStatus, type VersionedSpec, useVersionedPage } from "./versioned-page";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

/** A document that is one string, read from a queue of answers (the last one repeats). */
interface FakeState { version: number | null; loaded: LoadedWorker[]; text: string; error: string | null }
const answers: FakeState[] = [];
const state = (version: number | null, text: string, error: string | null = null): FakeState =>
  ({ version, loaded: [], text, error });

const SPEC: VersionedSpec<FakeState, string> = {
  read: async () => (answers.length > 1 ? answers.shift()! : answers[0]),
  docOf: (s) => s.text,
  same: (a, b) => a === b,
  workerVersion: (w) => w.version,
  wanted: (s) => String(s.version),
  versionName: (v) => (v === null ? "ตั้งต้น" : String(v)),
};

function FakePage({ blockers, onDiscard }: { blockers?: (string | null)[]; onDiscard?: () => void }) {
  const page = useVersionedPage(SPEC, { error: (s) => s.error, blockers, onDiscard });
  return (
    <div>
      <p data-testid="doc">{page.draft?.doc ?? "-"}</p>
      <p data-testid="refused">{page.draft?.refused ?? "-"}</p>
      <p data-testid="state-error">{page.stateError ?? "-"}</p>
      <p data-testid="blocked">{page.blocked ?? "-"}</p>
      <button type="button" onClick={() => page.edit((d) => `${d}!`)}>edit</button>
      <button type="button" onClick={() => page.setRefused("yaml text")}>refuse</button>
      <button type="button" onClick={page.reload}>reload</button>
      {page.state && page.draft && (
        <DraftStatus moved={page.moved} base={page.draft.base} current={page.state.version} note={page.draftNote}
          onDiscard={page.discard} onRebase={page.rebase} versionName={SPEC.versionName} hint="ทิ้งทั้งร่างและข้อความ YAML" />
      )}
    </div>
  );
}

async function renderPage(...states: FakeState[]) {
  answers.splice(0, answers.length, ...states);
  mockAdminFetch();
  return renderAdmin(<FakePage />);
}

describe("useVersionedPage extension points", () => {
  it("leaves the draft alone on a read whose state has an error, and exposes the error", async () => {
    await renderPage(state(1, "a"), state(2, "b", "broken"), state(3, "c"));
    await waitFor(() => expect(screen.getByTestId("doc")).toHaveTextContent("a"));
    fireEvent.click(screen.getByRole("button", { name: "reload" }));
    await waitFor(() => expect(screen.getByTestId("state-error")).toHaveTextContent("broken"));
    expect(screen.getByTestId("doc")).toHaveTextContent("a"); // a draft without edits would follow the server
    fireEvent.click(screen.getByRole("button", { name: "reload" }));
    await waitFor(() => expect(screen.getByTestId("doc")).toHaveTextContent("c"));
    expect(screen.getByTestId("state-error")).toHaveTextContent("-");
  });

  it("blocks the save with the first extra blocker", async () => {
    answers.splice(0, answers.length, state(1, "a"));
    mockAdminFetch();
    const { rerender } = await renderAdmin(<FakePage blockers={[null, "ใช้ YAML ก่อน", "อื่น"]} />);
    await waitFor(() => expect(screen.getByTestId("blocked")).toHaveTextContent("ใช้ YAML ก่อน"));
    rerender(<AdminGate><FakePage blockers={[null]} /></AdminGate>);
    await waitFor(() => expect(screen.getByTestId("blocked")).toHaveTextContent("-"));
  });

  it("drops the refused YAML with every new draft: an edit or a discard", async () => {
    await renderPage(state(1, "a"), state(2, "b"));
    await waitFor(() => expect(screen.getByTestId("doc")).toHaveTextContent("a"));
    fireEvent.click(screen.getByRole("button", { name: "refuse" }));
    expect(screen.getByTestId("refused")).toHaveTextContent("yaml text");
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByTestId("refused")).toHaveTextContent("-");
    // an edited draft keeps its refused YAML across a read; the discard that follows drops it
    fireEvent.click(screen.getByRole("button", { name: "refuse" }));
    fireEvent.click(screen.getByRole("button", { name: "reload" }));
    fireEvent.click(await screen.findByRole("button", { name: "ทิ้งการแก้ไข" }));
    expect(screen.getByTestId("refused")).toHaveTextContent("yaml text");
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" }));
    await waitFor(() => expect(screen.getByTestId("doc")).toHaveTextContent("b"));
    expect(screen.getByTestId("refused")).toHaveTextContent("-");
  });

  it("runs onDiscard on a discard and shows the page's own hint while asking", async () => {
    const onDiscard = vi.fn();
    answers.splice(0, answers.length, state(1, "a"), state(2, "b"));
    mockAdminFetch();
    await renderAdmin(<FakePage onDiscard={onDiscard} />);
    await waitFor(() => expect(screen.getByTestId("doc")).toHaveTextContent("a"));
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.click(screen.getByRole("button", { name: "reload" }));
    fireEvent.click(await screen.findByRole("button", { name: "ทิ้งการแก้ไข" }));
    const confirm = screen.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" });
    expect(confirm).toHaveAccessibleDescription("ทิ้งทั้งร่างและข้อความ YAML");
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onDiscard).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent("ทิ้งการแก้ไขแล้ว: ร่างตรงกับเวอร์ชัน 2");
  });
});

