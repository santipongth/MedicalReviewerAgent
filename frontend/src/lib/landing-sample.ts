// A snapshot of one real public review (colchicine after myocardial infarction, 2026-10-05, Qwen3.5 Flash), trimmed
// to the MACE outcome, for the landing page. Rebuilt only by scripts/landing_sample.py; landing-sample.test.ts fails
// if any number shown is not found verbatim in its source sentence.
import data from "@/data/landing-sample.json";
import type { Paper, Stats } from "./types";

export interface LandingSample {
  topic: string;
  capturedAt: string;
  question: string;
  stats: Stats;
  quality: { numbers_verified: number; numbers_total: number; verification_rate: number };
  papers: Paper[];
}

export const SAMPLE = data as unknown as LandingSample;

// Copy that assumes this particular review (update it if the snapshot is rebuilt from another one): the Thai heading
// and the FOUND wording in components/landing/sample-bench.tsx, the colchicine footnote in mini-forest.tsx, and
// SAMPLE_OUTCOME below. P1 must keep a passed MACE value and a blanked one for components/landing/anatomy.tsx.

/** The plotted outcome (papers word it slightly differently, so rows match on this prefix). */
export const SAMPLE_OUTCOME = "Major Adverse Cardiovascular Events";
