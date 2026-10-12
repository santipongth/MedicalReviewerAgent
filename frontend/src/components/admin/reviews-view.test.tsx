import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { REVIEWS } from "@/test/admin-fixtures";
import { ReviewsView } from "./reviews-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/reviews" }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const [RUNNING, DONE] = REVIEWS.items;
const row = (topic: string) => screen.getByRole("row", { name: new RegExp(topic) });

describe("ReviewsView", () => {
  it("lists reviews with links, statuses and only the actions that apply", async () => {
    mockAdminFetch((m, p) => (m === "GET" && p.startsWith("/reviews") ? [200, REVIEWS] : undefined));
    await renderAdmin(<ReviewsView />);
    expect(await screen.findByRole("link", { name: RUNNING.topic })).toHaveAttribute("href", `/r/${RUNNING.id}`);
    expect(within(row(RUNNING.topic)).getByRole("button", { name: "ยกเลิก" })).toBeInTheDocument();
    expect(within(row(RUNNING.topic)).queryByRole("button", { name: "ลบ" })).not.toBeInTheDocument();
    expect(within(row(DONE.topic)).getByRole("button", { name: "ลบ" })).toBeInTheDocument();
    expect(within(row(DONE.topic)).queryByRole("button", { name: "ยกเลิก" })).not.toBeInTheDocument();
  });

  it("searches with the typed topic and filters", async () => {
    const fetch = mockAdminFetch((m, p) => (m === "GET" && p.startsWith("/reviews") ? [200, REVIEWS] : undefined));
    await renderAdmin(<ReviewsView />);
    await screen.findByRole("link", { name: RUNNING.topic });
    fireEvent.change(screen.getByLabelText("ค้นหาหัวข้อ"), { target: { value: "statins" } });
    fireEvent.change(screen.getByLabelText("สถานะ"), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u) === "/api/v1/admin/reviews?q=statins&status=done")).toBe(true));
  });

  it("hides, cancels and deletes, updating the row each time", async () => {
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p.startsWith("/reviews")) return [200, REVIEWS];
      if (m === "PATCH") return [200, { id: DONE.id, is_listed: (body as { is_listed: boolean }).is_listed }];
      if (m === "POST" && p.endsWith("/cancel")) return [200, { id: RUNNING.id, status: "cancelled" }];
      if (m === "DELETE") return [204];
    });
    await renderAdmin(<ReviewsView />);
    await screen.findByRole("link", { name: DONE.topic });
    fireEvent.click(within(row(DONE.topic)).getByRole("button", { name: "ซ่อน" }));
    expect(await within(row(DONE.topic)).findByRole("button", { name: "แสดง" })).toBeInTheDocument();
    fireEvent.click(within(row(RUNNING.topic)).getByRole("button", { name: "ยกเลิก" }));
    expect(await within(row(RUNNING.topic)).findByText("ยกเลิกแล้ว")).toBeInTheDocument();
    fireEvent.click(within(row(DONE.topic)).getByRole("button", { name: "ลบ" }));
    fireEvent.click(within(row(DONE.topic)).getByRole("button", { name: "ยืนยันลบ" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: DONE.topic })).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("ลบรีวิวแล้ว");
  });

  it("shows a refusal from the API", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/reviews")) return [200, REVIEWS];
      if (m === "POST") return [409, { detail: "review is already done" }];
    });
    await renderAdmin(<ReviewsView />);
    fireEvent.click(within(await screen.findByRole("row", { name: new RegExp(RUNNING.topic) })).getByRole("button", { name: "ยกเลิก" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("review is already done");
  });

  it("sends the admin back to sign-in when the session expired mid-use", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/reviews")) return [200, REVIEWS];
      if (m === "PATCH") return [401, { detail: "sign in required" }];
    });
    await renderAdmin(<ReviewsView />);
    fireEvent.click(within(await screen.findByRole("row", { name: new RegExp(DONE.topic) })).getByRole("button", { name: "ซ่อน" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/admin?expired=1"));
  });

  it("loads the next page", async () => {
    const fetch = mockAdminFetch((m, p) => {
      if (p === "/reviews") return [200, { items: [RUNNING], next: "c1" }];
      if (p === "/reviews?before=c1") return [200, { items: [DONE], next: null }];
    });
    await renderAdmin(<ReviewsView />);
    fireEvent.click(await screen.findByRole("button", { name: "โหลดเพิ่ม" }));
    expect(await screen.findByRole("link", { name: DONE.topic })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "โหลดเพิ่ม" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("ignores a load-more that finishes after a new search started", async () => {
    const STALE = { ...DONE, id: "33333333-3333-4333-8333-333333333333", topic: "Stale page row" };
    const base = mockAdminFetch((m, p) => {
      if (p === "/reviews") return [200, { items: [RUNNING], next: "c1" }];
      if (p === "/reviews?before=c1") return [200, { items: [STALE], next: null }];
      if (p === "/reviews?q=statins") return [200, { items: [DONE], next: "s1" }];
      if (p === "/reviews?q=statins&before=s1") return [200, { items: [RUNNING], next: null }];
    });
    // hold the old query's page and the new search until the test lets them go
    let releaseMore!: () => void;
    let releaseSearch!: () => void;
    const moreGate = new Promise<void>((r) => { releaseMore = r; });
    const searchGate = new Promise<void>((r) => { releaseSearch = r; });
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/reviews?before=c1")) await moreGate;
      if (String(input).endsWith("/reviews?q=statins")) await searchGate;
      return base(input, init);
    });
    vi.stubGlobal("fetch", fetch);
    await renderAdmin(<ReviewsView />);

    fireEvent.click(await screen.findByRole("button", { name: "โหลดเพิ่ม" }));
    fireEvent.change(screen.getByLabelText("ค้นหาหัวข้อ"), { target: { value: "statins" } });
    fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));
    expect(screen.queryByRole("link", { name: RUNNING.topic })).not.toBeInTheDocument();

    // the old page arrives while the new search is still loading: it must not touch rows, cursor or the spinner
    await act(async () => { releaseMore(); await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole("link", { name: STALE.topic })).not.toBeInTheDocument();
    expect(screen.getByText("กำลังโหลด…")).toBeInTheDocument();
    expect(screen.queryByText("ไม่พบรีวิว")).not.toBeInTheDocument();

    await act(async () => { releaseSearch(); await new Promise((r) => setTimeout(r, 20)); });
    expect(await screen.findByRole("link", { name: DONE.topic })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: STALE.topic })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: RUNNING.topic })).not.toBeInTheDocument();

    // the cursor is the new query's, not the stale page's
    fireEvent.click(screen.getByRole("button", { name: "โหลดเพิ่ม" }));
    expect(await screen.findByRole("link", { name: RUNNING.topic })).toBeInTheDocument();
    expect(fetch.mock.calls.some(([u]) => String(u) === "/api/v1/admin/reviews?q=statins&before=s1")).toBe(true);
  });

  it("shows only the error, no old rows and no load-more, when a new search fails", async () => {
    mockAdminFetch((m, p) => {
      if (p === "/reviews") return [200, { items: [RUNNING], next: "c1" }];
      if (p === "/reviews?q=boom") return [409, { detail: "bad filter" }];
    });
    await renderAdmin(<ReviewsView />);
    await screen.findByRole("link", { name: RUNNING.topic });
    fireEvent.change(screen.getByLabelText("ค้นหาหัวข้อ"), { target: { value: "boom" } });
    fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("bad filter");
    expect(screen.queryByRole("link", { name: RUNNING.topic })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "โหลดเพิ่ม" })).not.toBeInTheDocument();
    expect(screen.queryByText("ไม่พบรีวิว")).not.toBeInTheDocument();
  });

  it("moves focus to the notice after a confirmed delete or a cancel removed the focused button", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/reviews")) return [200, REVIEWS];
      if (m === "POST" && p.endsWith("/cancel")) return [200, { id: RUNNING.id, status: "cancelled" }];
      if (m === "DELETE") return [204];
    });
    await renderAdmin(<ReviewsView />);
    await screen.findByRole("link", { name: DONE.topic });
    fireEvent.click(within(row(RUNNING.topic)).getByRole("button", { name: "ยกเลิก" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ยกเลิกรีวิวแล้ว"));
    expect(screen.getByRole("status")).toHaveFocus();
    fireEvent.click(within(row(DONE.topic)).getByRole("button", { name: "ลบ" }));
    fireEvent.click(within(row(DONE.topic)).getByRole("button", { name: "ยืนยันลบ" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ลบรีวิวแล้ว"));
    expect(screen.getByRole("status")).toHaveFocus();
  });
});
