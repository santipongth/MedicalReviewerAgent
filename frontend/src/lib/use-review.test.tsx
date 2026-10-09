import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import type { FollowOptions } from "./events";

const getReview = vi.fn();
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), getReview: (...a: unknown[]) => getReview(...a) }));
const followReview = vi.fn();
vi.mock("./events", () => ({ followReview: (...a: unknown[]) => followReview(...a) }));

import { useReview } from "./use-review";

const base = { id: "r1", topic: "metformin", language: "th", created_at: "", finished_at: null, options: {},
  progress: null, error: null, cost_usd: 0, started_at: null };

beforeEach(() => {
  getReview.mockReset();
  followReview.mockReset();
});

describe("useReview", () => {
  it("shows a finished review straight away without streaming", async () => {
    getReview.mockResolvedValue({ ...base, status: "done", result: { summary: "s" } });
    const { result } = renderHook(() => useReview("r1", { pollMs: 5 }));
    await waitFor(() => expect(result.current.phase).toBe("report"));
    expect(result.current.review?.result?.summary).toBe("s");
    expect(followReview).not.toHaveBeenCalled();
  });

  it("follows live events, then loads the result on done", async () => {
    getReview
      .mockResolvedValueOnce({ ...base, status: "running", result: null })
      .mockResolvedValueOnce({ ...base, status: "done", result: { summary: "final" } });
    followReview.mockImplementation(async (_id: string, opts: FollowOptions) => {
      opts.onEvent({ seq: 1, type: "searching", payload: { found: 12 } });
      opts.onEvent({ seq: 2, type: "done", payload: {} });
      return "terminal";
    });
    const { result } = renderHook(() => useReview("r1", { pollMs: 5 }));
    await waitFor(() => expect(result.current.phase).toBe("report"));
    expect(result.current.run.found).toBe(12);
    expect(result.current.review?.result?.summary).toBe("final");
  });

  it("advances the scene with events and dedupes replays", async () => {
    getReview
      .mockResolvedValueOnce({ ...base, status: "running", result: null })
      .mockResolvedValue({ ...base, status: "done", result: { summary: "x" } });
    followReview.mockImplementation(async (_id: string, opts: FollowOptions) => {
      opts.onEvent({ seq: 1, type: "planning", payload: { queries: ["a", "b"] } });
      opts.onEvent({ seq: 2, type: "searching", payload: { found: 9, queries: 2 } });
      opts.onEvent({ seq: 2, type: "searching", payload: { found: 99, queries: 2 } });
      opts.onEvent({ seq: 1, type: "error", payload: {} });
      return "terminal";
    });
    const { result } = renderHook(() => useReview("r1", { pollMs: 5 }));
    await waitFor(() => expect(result.current.phase).toBe("report"));
    expect(result.current.scene.counts.found).toBe(9);
    expect(result.current.scene.agents.enrich).toBe("working");
    expect(result.current.scene.expectLocalize).toBe(true);
    expect(result.current.scene.lastSeq).toBe(2);
  });

  it("falls back to polling when the stream cannot be kept open", async () => {
    getReview
      .mockResolvedValueOnce({ ...base, status: "running", result: null })
      .mockResolvedValueOnce({ ...base, status: "running", result: null })
      .mockResolvedValue({ ...base, status: "rejected", error: "not a medical topic", result: null });
    followReview.mockResolvedValue("gave_up");
    const { result } = renderHook(() => useReview("r1", { pollMs: 5 }));
    await waitFor(() => expect(result.current.phase).toBe("terminal"));
    expect(result.current.run.status).toBe("rejected");
    expect(result.current.run.message).toBe("not a medical topic");
    expect(result.current.scene.status).toBe("rejected");
    expect(result.current.scene.agents.guard).toBe("failed");
    expect(result.current.connection).toBe("polling");
  });

  it("reports an unknown review", async () => {
    getReview.mockRejectedValue(new ApiError(404, "review not found"));
    const { result } = renderHook(() => useReview("nope", { pollMs: 5 }));
    await waitFor(() => expect(result.current.phase).toBe("notfound"));
    act(() => {});
  });

  it("retry after an unavailable load reaches the report", async () => {
    getReview.mockRejectedValueOnce(new Error("down")).mockResolvedValue({ ...base, status: "done", result: { summary: "s" } });
    const { result } = renderHook(() => useReview("r1", { pollMs: 5 }));
    await waitFor(() => expect(result.current.phase).toBe("unavailable"));
    act(() => result.current.retry());
    expect(result.current.phase).toBe("loading");
    await waitFor(() => expect(result.current.phase).toBe("report"));
  });
});
