# Plan 19 — Engine correctness (from the 2026-10-10 core engine audit)

**Request:** "ตรวจเสร็จแล้วแก้ทั้งหมด แล้ว merge เลย". Fix every engine issue the audit found, then merge.
**Audit:** `D:/MedicalReviewerAgent/.superpowers/audit/engine-audit.md`. It gives each issue an I-n number with evidence and the
proposed fix. Per-run evidence is in `.superpowers/audit/runs/`.
**Spec:** `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md`. Reviews are abstract-only; every number shown is
verified against the abstract; numbers are never guessed.

## Global constraints
- **SLR prompt pins.** `backend/tests/unit/test_prompts_by_type.py` freezes the SLR prompts. Any change to an SLR prompt must be
  deliberate: update the pin in the same commit, give the reason in the commit body, and bump `prompt_version`. Never edit a
  pin silently.
- **Verification is strict.**
  - A number counts as verified only if it appears in the abstract text, in the quote's aligned source window.
  - A changed digit must never pass.
  - Each field is nulled on its own: one bad field does not blank its siblings.
  - Accepted formats: `P = .003`, spaced or comma thousands, decimal commas, the unicode minus and `·` decimals, compared
    after normalising both sides.
- **Unverifiable prose numbers are removed or blanked, never invented.** Pooled numbers stay as in Plan 14b.
- **Keep the existing contracts.** Result keys, events and API/MCP shapes stay as they are. Any addition goes into docs/api.md.
- **Gates.** `cd backend && uv run pytest -q && uv run ruff check .`. If the frontend is touched, also run
  `npm test && npm run lint && npm run typecheck`.
- **Git.** Edit/Write only (LF). Stage only the files you touched. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. This plan works in the worktree `D:/MedicalReviewerAgent/.worktrees/plan-19`
  (branch plan-19-engine-correctness).

## Task 1: Verification soundness (I-1, I-5)
`backend/app/harness/verify.py` and its callers in reading.py:
- Check numbers against the aligned abstract window, not against the model's quote.
- Null fields one at a time.
- Normalise number formats.
- Add regression tests for:
  - the HR 0.86→0.80 case;
  - `P = .003`;
  - `111 725`;
  - `1,234`;
  - `0,85`;
  - `−0.5`;
  - `0·85`.

## Task 2: Comparison-aware extraction and prose checks (I-2a/b/c)
- Outcomes whose comparison is not the review's I vs C are excluded from the matrix, conflicts and pools. They stay
  visible as "other comparisons".
- A post-check on the summary, rationale and conflict text removes or blanks numbers that cannot be traced to verified
  card numbers or pooled values.
- Measure names are checked: "odds ratio" must not describe an RR.
- Claim/population consistency is handled with a grounded-statement check or prompt rules plus a deterministic check where possible.
- GRADE certainty phrasing is used in the summary.

## Task 3: Study types (I-3, I-6)
- Canonical-name matching in refinement uses synonyms: "RCT" ↔ "randomized controlled trial(s)", and so on.
- Refinement fallbacks are reported in `errors` and in quality.
- Selected study types are enforced at screening (prompt + design guess) and at selection: designs that do not match are
  excluded with exclusion_reason `study_design`.

## Task 4: Localization completeness (I-4, I-12)
- A completeness check reports any untranslated card fields and retries them.
- Telemetry counts untranslated strings, not only numbers.
- Citations (`[Pn]`) are preserved after translation; a broken one is restored or the run falls back.
- The localize prompt gets a medical glossary and an academic Thai register.

## Task 5: Design labels, GRADE and conflicts (I-7, I-11, I-13)
- A design-category consistency check against pub types, the study_design text and the sample: a secondary analysis is
  not an SR, a cohort is not an RCT.
- GRADE-lite tiers:
  - primary studies are graded even when an SR exists;
  - inconsistency is judged on the primary outcome only;
  - sample size is counted per outcome.
- Conflict is defined by the side of the effect, not by significance: non-significant vs significant in the same
  direction is not a conflict.
- Direction logic is skipped for non-effect questions (qualitative themes, scoping).
- No "null" placeholder rows.

## Task 6: Recall, models and the rest (I-8, I-9, I-10, I-15, I-17, minors)
- Keep search-rank order through enrichment.
- Better recall for meta_analysis (more queries/pages, a design query, `candidate_limit`).
- "Two models": use a different secondary screener family in the budget preset, with an escalation guard, or change the
  landing copy. Choose and document.
- Scope discipline in the refine/critique prompts: no unrequested safety sub-questions.
- Deterministic pre-clustering before LLM outcome normalisation (latency).
- Every minor I-18 to I-26.

## Task 7: Live verification
- After merge and a docker rebuild, re-run the 4 audit reviews with the same topics and options.
- Compare verification %, refinement success, design labels, Thai completeness, pooling (meta), time and cost against
  `.superpowers/audit/runs/`.
- Record the results in `.superpowers/audit/rerun.md`.
