# Plan 17a — "กำหนดขอบเขตการทบทวน" scope form + qualitative/mixed-methods (limited support)

**Request (2026-10-10):** the user sent a mockup of a numbered form to replace the landing request slip:
1. คำถามหรือวัตถุประสงค์ (textarea, PICO hint)
2. รูปแบบการทบทวน (dropdown + description)
3. หลักฐานและเกณฑ์คัดเลือก (checkboxes: RCT, Cohort, Case-Control, Cross-sectional, ทดลองไม่สุ่ม, Qualitative, Mixed methods, อื่น ๆ — ระบุ)

**User decisions:**
- Umbrella Review: not this time.
- The dropdown = Systematic / Meta-analysis / Scoping / Narrative.
- Qualitative/Mixed methods: include, with limited support (summarised as themes, never effect numbers, labelled).
- Style follows DESIGN.md, not the mockup's grey look.
**Spec:** `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md` (abstract-only; numbers verified against abstracts).

## Global constraints
- **SLR prompts byte-identical** (sha pins in `backend/tests/unit/test_prompts_by_type.py` untouched).
  - The extraction prompt's design_category list (prompts.py ~247) must NOT change for requests without qualitative/mixed.
  - When the user ticks Qualitative or Mixed methods, an appended `OVERRIDE_LEAD` block adds the two categories and their rules.
  - The schema `DesignCategory` Literal gains `qualitative` and `mixed_methods`. This is an additive schema change, like the
    Plan 14a concept/context ruling.
- Qualitative/mixed papers never enter:
  - direction tallies;
  - the direction matrix cells;
  - forest plots;
  - meta-analysis pooling;
  - GRADE baselines.
  They appear in the lit matrix (key findings, no effect columns) and the concept map grouped by design. A report note says
  "งานเชิงคุณภาพสรุปเป็นประเด็นจากบทคัดย่อ ไม่มีค่าผลเชิงตัวเลข".
- Free-text "other" study type: ≤ 60 chars, control characters stripped, and passed to prompts only inside the existing options data
  line (as data). Never an instruction.
- Legacy results and existing types render as before. DESIGN.md flat Theatre Green, 44px targets, axe clean, 390px no page scroll.
- Git: Edit/Write only (LF). Stage only touched files. Leave `infra/searxng/limiter.toml.new` alone. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Task 1: Backend — topic length, canonical study types, qualitative/mixed categories
**Files:** `backend/app/schemas/review.py`, `backend/app/graph/schemas.py` (DesignCategory), `backend/app/harness/design.py` and
`matrix.py`, `backend/app/graph/nodes/synthesis.py` (`_evidence` excludes qualitative/mixed like narrative reviews from direction
evidence), `backend/app/harness/question.py`, `backend/app/graph/prompts.py` (an appended block only when the options contain
qualitative/mixed), `backend/app/harness/meta.py` (never pool them), `grade.py`, `services/report.py` (Markdown/CSV design labels),
`docs/api.md`, tests.
- `CreateReviewRequest.topic` max_length 300 → 600 (the API docs and MCP `start_review` description follow).
- `study_types` canonical values:
  `["RCT", "Cohort", "Case-control", "Cross-sectional", "Non-randomized trial", "Qualitative", "Mixed methods"]`
  plus at most one "Other: <text>" (≤ 60 chars).
  - Normalise case and aliases (e.g. "Case-Control", "case control" → "Case-control"; keep accepting the old "Meta-analysis" and "Systematic review" values for API compatibility).
  - Reject unknown values by clamping them into "Other:".
  - Max 10.
  - The question check (`question_problems`) compares canonical names to `study_designs` loosely (case/hyphen-insensitive).
- Tests:
  - normalisation and aliases;
  - the 600-char topic;
  - SLR pins unchanged with and without new study types (the pin covers the no-option case);
  - the qualitative block appears only when ticked;
  - the matrix, meta and grade exclusion of qualitative/mixed;
  - the Markdown label.

## Task 2: Frontend — ScopeForm replaces the request slip
**Files:** `frontend/src/components/landing/request-slip.tsx` (rename or keep the export; the landing page imports it),
`review-type-picker.tsx` (replace it with a select-based field, or delete it if unused), tests, `e2e/app.spec.ts` (landing flows),
`frontend/src/lib/review-type.ts` (reuse `REVIEW_TYPE_LABEL`), glossary `pico`.
- **Header:** "กำหนดขอบเขตการทบทวน" with the "ฟรี · ไม่ต้องสมัคร" tag kept. Three numbered steps (number in `font-display`):
  1. **คำถามหรือวัตถุประสงค์ \*** — a textarea (3–600 chars, counter shown near the limit). Placeholder
     "ต้องการทบทวนเรื่องใด เพื่อหาคำตอบอะไร? เช่น เมตฟอร์มินลดความเสี่ยงมะเร็งลำไส้ใหญ่ในผู้ป่วยเบาหวานหรือไม่". Hint
     "ใช้ PICO ช่วยได้เมื่อถามถึงผลของวิธีการหรือสิ่งแทรกแซง" with a `Term k="pico"`.
  2. **รูปแบบการทบทวน** — a native `<select>` (options from `status.limits.review_types`, falling back to the four; the order is
     Systematic, Meta-analysis, Scoping, Narrative; labels are the Thai name with the English name in brackets). The selected type's
     description (`REVIEW_TYPE_LABEL[...].description`) shows below it in `text-muted text-sm`.
  3. **หลักฐานและเกณฑ์คัดเลือก** — a checkbox grid (3 columns on wide screens, 2 at 390). The labels:
     - RCT
     - Cohort
     - Case-control
     - Cross-sectional
     - ทดลองไม่สุ่ม (Non-randomized)
     - เชิงคุณภาพ (Qualitative)
     - ผสมผสาน (Mixed methods)
     - อื่น ๆ — ระบุ (reveals a text input ≤ 60 chars)

     Note: "เลือกได้หลายแบบ · ไม่เลือก = ไม่จำกัดชนิดงานวิจัย". When Qualitative or Mixed is ticked, show the inline note
     "สรุปเป็นประเด็นจากบทคัดย่อ ไม่มีค่าผลเชิงตัวเลข".
- **"ตัวเลือกเพิ่มเติม"** (collapsed `<details>`): ภาษาของรายงาน, จำนวนงานวิจัยที่วิเคราะห์ and ตั้งแต่ปี, behaving exactly as today.
  The summary line shows the current values.
- **Unchanged:** submit, Turnstile, wait text, errors, example topics ("ลองหัวข้อ" fills step 1), and the API payload shape
  (`topic`, `language`, `options.review_type`, `options.study_types`, `max_papers`, `year_from`).
- **Styling:** DESIGN.md. Flat surface; 1px `rule` borders; 2px corners; labels in Bai Jamjuree; inputs ≥ 44px; focus rings as existing.
- **Tests:**
  - payload per field;
  - other text capped;
  - status-limited options;
  - description switches with the selection;
  - the qualitative note;
  - e2e: landing submit, axe at 1440/390 light/dark, no horizontal scroll.

## Task 3: Report — qualitative/mixed display + docs + verification
**Files:** `frontend/src/lib/charts-data.ts` and i18n (design labels `qualitative` and `mixed_methods`), lit matrix (effect cells "–"
with the note), `bottom-line` / direction tallies (exclude them), concept map (design grouping), the report note, `DESIGN.md` (scope
form entry + Decisions Log 2026-10-10 Plan 17a), `CLAUDE.md` (one line), and the spec revision note.
- Screenshots: the landing form (1440/390 light/dark) and a report with a qualitative paper (a fixture). Read them and fix anything
  wrong.
- Full gates; final whole-branch review; merge; docker rebuild.
