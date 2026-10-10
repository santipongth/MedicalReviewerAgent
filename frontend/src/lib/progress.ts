// Pure reducer: review events (SSE) → what the live-run screen shows. Replayed events (seq ≤ lastSeq) are ignored so
// a reconnect with Last-Event-ID never double-applies anything.
import { asDesign, asDirection } from "./live-evidence";
import type { DesignCategory, Direction, ReviewEvent } from "./types";

export type StepKey = "queue" | "refine" | "search" | "screen" | "read" | "synthesize" | "done";
export const STEPS: StepKey[] = ["queue", "refine", "search", "screen", "read", "synthesize"];
export type RunStatus = "connecting" | "queued" | "running" | "done" | "error" | "rejected" | "cancelled";

export interface ReadingItem {
  ref: string;
  title: string;
  state: "reading" | "ok" | "failed";
  verified?: number;
  uncertain?: boolean;
  direction?: Direction; // the reading model's judgement; absent when failed, missing or unknown
  design?: DesignCategory;
}

export interface RunState {
  status: RunStatus;
  step: StepKey;
  terminal: boolean;
  found: number;
  candidates: number;
  kept: number;
  queries: string[];
  question?: {
    interpretation?: string;
    refined_question?: string;
    sub_questions?: string[];
    assumptions?: string[];
  };
  reading: ReadingItem[];
  externalLookup: boolean;
  elapsed: number;
  message?: string;
  lastSeq: number;
}

export function initialRun(): RunState {
  return {
    status: "connecting", step: "queue", terminal: false, found: 0,
    candidates: 0, kept: 0, queries: [], reading: [], externalLookup: false, elapsed: 0, lastSeq: 0,
  };
}

const STEP_OF: Record<string, StepKey> = {
  checking_topic: "refine", refining: "refine", question_refined: "refine",
  planning: "search", searching: "search", enriching: "search",
  screening: "screen", screened: "screen",
  reading: "read", extracted: "read", external_lookup: "read",
  synthesizing: "synthesize", pooled: "synthesize", localizing: "synthesize", finalizing: "synthesize",
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function reduceRun(state: RunState, ev: ReviewEvent): RunState {
  if (ev.seq <= state.lastSeq) return state;
  const p = ev.payload ?? {};
  const s: RunState = { ...state, lastSeq: ev.seq };
  if (typeof p.elapsed_s === "number") s.elapsed = p.elapsed_s;
  const step = STEP_OF[ev.type];
  if (step) {
    s.step = step;
    s.status = "running";
  }
  switch (ev.type) {
    case "queued":
      s.status = "queued";
      break;
    case "started":
      s.status = "running";
      if (s.step === "queue") s.step = "refine";
      break;
    case "interrupted":
      s.status = "queued";
      break;
    case "question_refined":
      s.question = {
        interpretation: str(p.interpretation), refined_question: str(p.refined_question),
        sub_questions: Array.isArray(p.sub_questions) ? (p.sub_questions as string[]) : [],
        assumptions: Array.isArray(p.assumptions) ? (p.assumptions as string[]) : [],
      };
      break;
    case "planning":
      s.queries = Array.isArray(p.queries) ? (p.queries as string[]) : [];
      break;
    case "searching":
      s.found = num(p.found);
      break;
    case "enriching":
      s.candidates = num(p.candidates);
      break;
    case "screened":
      s.kept = num(p.kept);
      break;
    case "reading": {
      const ref = str(p.ref) ?? "?";
      s.reading = [...s.reading.filter((r) => r.ref !== ref), { ref, title: str(p.title) ?? "", state: "reading" }];
      break;
    }
    case "extracted": {
      const ref = str(p.ref) ?? "?";
      const prev = s.reading.find((r) => r.ref === ref);
      const item: ReadingItem = {
        ref, title: prev?.title ?? "", state: p.ok ? "ok" : "failed",
        verified: typeof p.verified === "number" ? p.verified : undefined, uncertain: Boolean(p.uncertain),
      };
      const direction = p.ok ? asDirection(p.direction) : null;
      const design = p.ok ? asDesign(p.design) : null;
      if (direction) item.direction = direction;
      if (design) item.design = design;
      s.reading = prev ? s.reading.map((r) => (r.ref === ref ? item : r)) : [...s.reading, item];
      break;
    }
    case "external_lookup":
      s.externalLookup = true;
      break;
    case "done":
      s.status = "done";
      s.step = "done";
      s.terminal = true;
      break;
    case "error":
      s.status = "error";
      s.terminal = true;
      s.message = str(p.message);
      break;
    case "rejected":
      s.status = "rejected";
      s.terminal = true;
      s.message = str(p.reason);
      break;
    case "cancelled":
      s.status = "cancelled";
      s.terminal = true;
      break;
  }
  return s;
}

/** Pipeline counts for the live screen. `read` = papers whose read has finished (ok or failed). */
export function readCounts(run: RunState): { found: number; candidates: number; kept: number; read: number } {
  return {
    found: run.found, candidates: run.candidates, kept: run.kept,
    read: run.reading.filter((r) => r.state !== "reading").length,
  };
}

export const TERMINAL_EVENTS = new Set(["done", "error", "rejected", "cancelled"]);
