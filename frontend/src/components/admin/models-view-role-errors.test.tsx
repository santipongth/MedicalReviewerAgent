import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { REPORT_OK, STATE, VERSIONS } from "@/test/admin-model-fixtures";
import { ModelsView } from "./models-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const HINT = "ต้องใส่ราคา input และ output (USD ต่อ 1M token)";
const ROLE_ERRORS = [{ preset: "cheap", role: "extractor", kind: "price" }];

/** A server whose validate and save answers the test chooses; everything else is the default fixtures. */
function serve(reply: (m: string, p: string) => [number, unknown] | undefined) {
  mockAdminFetch((m, p) => {
    const custom = reply(m, p);
    if (custom) return custom;
    if (m === "GET" && p === "/llm-config") return [200, STATE];
    if (m === "GET" && p.startsWith("/llm-config/versions")) return [200, VERSIONS];
  });
}

async function expectHintOnExtractorRowOnly() {
  const row = await screen.findByRole("row", { name: /extractor/ });
  await waitFor(() => expect(within(row).getByText(HINT)).toBeInTheDocument());
  expect(screen.getAllByText(HINT)).toHaveLength(1);
}

describe("ModelsView role errors (Plan 31)", () => {
  it("shows the price hint on the preset row a validate answer names", async () => {
    serve((m, p) => (p === "/llm-config/validate"
      ? [200, { ...REPORT_OK, ok: false, errors: ["extractor needs a price"], role_errors: ROLE_ERRORS }] : undefined));
    await renderAdmin(<ModelsView />);
    await screen.findByRole("row", { name: /extractor/ });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    await expectHintOnExtractorRowOnly();
  });

  it("shows it too when the save itself is refused with 422 and role_errors", async () => {
    serve((m, p) => {
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") return [422, { detail: "extractor needs a price", role_errors: ROLE_ERRORS }];
    });
    await renderAdmin(<ModelsView />);
    await screen.findByRole("row", { name: /extractor/ });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" }));
    await expectHintOnExtractorRowOnly();
  });
});
