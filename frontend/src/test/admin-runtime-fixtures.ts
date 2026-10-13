import type {
  GlossaryState, HarnessCompare, HarnessReportItem, HarnessResultItem, HarnessRun, HarnessState, LoadedWorker, Page,
  RuntimeVersion, SettingSpec, SettingsState,
} from "@/lib/admin-types";

export const WORKER: LoadedWorker = { worker: "worker-1:7", version: "3", preset: "cheap", loaded_at: "2026-10-13T10:00:00Z",
  error: null, settings: "2", glossary: "4", runtime_error: null };

export const SPECS: SettingSpec[] = [
  { name: "review_rate_limit", kind: "rate", group: "limits", applies: "api", min: null, max: null },
  { name: "max_queued_reviews", kind: "int", group: "capacity", applies: "api", min: 1, max: 1000 },
  { name: "max_usd_per_day", kind: "float", group: "capacity", applies: "api", min: 0.1, max: 1000 },
  { name: "llm_concurrency", kind: "int", group: "workers", applies: "worker", min: 1, max: 64 },
];

export const SETTINGS: SettingsState = {
  source: "db", version: 2, specs: SPECS, worst_case_review_usd: 0.4, loaded: [WORKER],
  values: { review_rate_limit: "5/hour", max_queued_reviews: 80, max_usd_per_day: 10, llm_concurrency: 16 },
  overrides: { max_queued_reviews: 80 },
  env: { review_rate_limit: "5/hour", max_queued_reviews: 50, max_usd_per_day: 10, llm_concurrency: 16 },
};

export const SETTINGS_VERSIONS: Page<RuntimeVersion> = {
  items: [
    { version: 2, kind: "settings", created_at: "2026-10-13T10:00:00Z", created_by: "owner", note: "busier",
      source: "edit", restored_from: null, changes: { max_queued_reviews: "50 → 80" } },
    { version: 1, kind: "settings", created_at: "2026-10-12T10:00:00Z", created_by: "owner", note: null,
      source: "edit", restored_from: null, changes: { max_queued_reviews: "env → 50" } },
  ],
  next: null,
};

export const GLOSSARY: GlossaryState = {
  source: "db", version: 4, chars: 52, max_chars: 4000, loaded: [WORKER],
  terms: [
    { en: "hazard ratio", th: "อัตราส่วนฮาซาร์ด", abbr: "HR", note: null },
    { en: "placebo", th: "ยาหลอก", abbr: null, note: "ไม่ใช่ยาจริง" },
  ],
};

export const GLOSSARY_VERSIONS: Page<RuntimeVersion> = {
  items: [{ version: 4, kind: "glossary", created_at: "2026-10-13T09:00:00Z", created_by: "owner", note: null,
    source: "edit", restored_from: null, changes: { added: ["placebo"] } }],
  next: null,
};

export const RUN: HarnessRun = {
  id: 7, run_id: "console-20261013-100000-a1b2", prompt_version: "2026-10-12.1", status: "running", max_usd: 1,
  spent_usd: 0.13, repeats: 2, strata: ["cv"], max_reviews: null, compare_run: null, planned: 6, done: 2, failed: 0,
  skipped: 0, created_by: "owner", created_at: "2026-10-13T10:00:00Z", started_at: "2026-10-13T10:00:05Z",
  finished_at: null, error: null, report: null, config: { llm_config: "db:3", settings_version: "2", glossary: "4" },
};

export const RUN_DONE: HarnessRun = {
  ...RUN, id: 6, run_id: "console-20261012-090000-c3d4", status: "done", done: 6, spent_usd: 0.4,
  finished_at: "2026-10-12T09:20:00Z", report: "2026-10-12.1-console-20261012-090000-c3d4.md",
};

export const HARNESS: HarnessState = {
  available: true, reasons: [], prompt_version: "2026-10-12.1", pool_version: "v1",
  strata: [{ name: "cv", selected: 3, with_fixtures: 3 }, { name: "renal", selected: 1, with_fixtures: 0 }],
  fixtures: { selected: 4, present: 3 }, worker: { worker: "harness-1:9", seen_at: "2026-10-13T10:00:00Z" },
  ceiling_usd: 5, default_usd: 1, per_review_cap_usd: 0.28, typical_review_usd: 0.065, active: null,
};

export const REPORTS: HarnessReportItem[] = [
  { name: "2026-10-11.1-baseline.md", prompt_version: "2026-10-11.1", run_id: "baseline", size: 3635,
    modified_at: "2026-10-12T11:05:00Z" },
];

export const REPORT_TEXT = [
  "# Cochrane harness report: 2026-10-11.1 (run baseline)", "",
  "- git `abc` · preset `budget`", "",
  "## Summary", "",
  "| Metric | This run |", "|---|---|", "| Runs (failed) | 60 (0) |", "| Batch cost | $3.90 |", "",
  "<script>alert(1)</script>", "",
].join("\n");

export const RESULTS: HarnessResultItem[] = [
  { label: "2026-10-11.1/baseline", prompt_version: "2026-10-11.1", run_id: "baseline", files: 60,
    modified_at: "2026-10-12T11:02:00Z" },
  { label: "2026-10-12.1/console-20261012-090000-c3d4", prompt_version: "2026-10-12.1",
    run_id: "console-20261012-090000-c3d4", files: 6, modified_at: "2026-10-12T09:20:00Z" },
];

export const COMPARE: HarnessCompare = {
  a: { label: "2026-10-11.1/baseline", runs: 60 }, b: { label: "2026-10-12.1/console-20261012-090000-c3d4", runs: 6 },
  rows: [{ metric: "Runs (failed)", a: "60 (0)", b: "6 (0)" }, { metric: "Batch cost", a: "$3.90", b: "$0.40" }],
  verdict_changes: ["CD1: consensus:positive → none"],
};
