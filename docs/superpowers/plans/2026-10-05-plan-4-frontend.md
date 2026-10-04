# Plan 4 — Web app: landing, live run and interactive evidence report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public Next.js web app where anyone types a disease, drug or chemical, watches the agent work live, and reads
an interactive evidence report in which every number can be traced to its source sentence.

**Architecture:** `frontend/` is a Next.js 16 App Router app (React 19, TypeScript, Tailwind v4) that talks to the existing
FastAPI backend over REST and SSE (`NEXT_PUBLIC_API_URL`, CORS already open). Pages: `/` (request slip + receipt + recent
reviews), `/r/[id]` (live run, then the report bench), `/about` (REST, MCP, webhook docs). Design tokens come from
`DESIGN.md` ("Theatre Green") as CSS variables with light/dark themes. Charts use Apache ECharts 6; UI motion uses `motion`.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, Tailwind CSS 4.3, ECharts 6.1, motion 14, next/font/google
(Bai Jamjuree, Anuphan, Martian Mono, Source Serif 4), Vitest 5 + Testing Library, Playwright 1.63, npm (no pnpm on host).

**Spec:** `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md` §5 Web; design: `DESIGN.md`;
approved preview: https://claude.ai/artifact/XUvrWN7gxW3GhzEMrEnNpY

**Executor note:** executed inline by the author; tasks give interfaces, decisions and exact tests; code lives in commits.

## Global Constraints

- Follow DESIGN.md exactly: four font families with one job each; Martian Mono + autoclave-tape underline only for
  verified numbers; unverified values render as a hatched "ไม่ยืนยัน / not verified" slot; finding colors always paired
  with glyphs; 2px radius, 1px rules, no shadows/glows/gradients/pills; light default + dark "Night shift".
- Public, no login; Thai and English UI copy (UI language follows the review language; default Thai).
- Every page works at 400px width without horizontal page scroll; matrix scrolls in its own container.
- Accessibility: keyboard reachable controls, visible focus, glyph buttons with accessible names, `prefers-reduced-motion`.
- No secret or API key in the frontend; the browser calls only the public API.

## Review Focus

1. A review that ends `error`, `rejected` or `cancelled`, or an SSE stream that drops mid-run, shows a clear state and
   recovers (reconnect with Last-Event-ID, then fall back to polling GET) instead of hanging.
2. Results with missing data (no papers, a paper with `card: null`, all numbers unverified, no conflicts, no effect sizes)
   render honestly without crashes or empty charts.
3. A number shown in Martian Mono is always a verified, non-null value from the result; nothing is computed client-side
   and shown as if it came from a paper.
4. Rate-limit (429 with Retry-After) and queue errors on submit show an actionable message.
5. Thai text (long words, tone marks) never clips in tables, buttons or the rail at phone width.

---

### Task 1: Backend contract additions for the UI
**Files:** `backend/app/graph/nodes/reading.py`, `backend/app/harness/verify.py`, `backend/app/schemas/review.py`,
`backend/app/api/reviews.py`; tests in `test_nodes_reading.py`, `test_reviews_api.py`.
**Produces:** `papers[].verification.unverified: [{"field": "effect"|"sample_size", "outcome": str|None}]` (values blanked
by the verifier, so the UI can tell "not verified" from "not reported"); `ReviewSummary.verification_rate: float|None` from
`result.quality.verification_rate` for the landing list.
**Tests:** unverifiable effect → listed under `unverified`; verified → empty; recent list exposes the rate.

### Task 2: Frontend scaffold, tokens, fonts and base components
**Files:** `frontend/` (create-next-app 16, TypeScript, App Router, Tailwind v4, ESLint), `src/app/globals.css` (DESIGN.md
tokens), `src/app/layout.tsx` (fonts, theme script), `src/components/ui/*` (Button, Label, VerifiedNumber, Hole, Glyph,
ThemeToggle), Vitest config. **Tests:** VerifiedNumber renders tape + mono only when verified; Hole has the label; Glyph has
an accessible name per direction.

### Task 3: API client, types and live events
**Files:** `src/lib/api.ts` (createReview, getReview, listRecent, ApiError with status/retryAfter), `src/lib/types.ts`
(ReviewResult mirror of `finalize`), `src/lib/events.ts` (fetch-based SSE reader, Last-Event-ID resume, backoff, polling
fallback), `src/lib/progress.ts` (pure reducer events → run state). **Tests:** SSE parser splits/merges chunks; reducer maps
the event sequence to steps, wells and refined question; reconnect sends Last-Event-ID; 429 maps to retryAfter.

### Task 4: Landing page `/`
Request slip (topic, language, papers 3–10, year from, study types) → POST → `/r/{id}`; the slip shows the agent's PICO once
the run reports `question_refined` on the report page (landing just submits); example topics; receipt from the most recent
done review (first verified effect with its quote) and the recent list with verification rate; empty/loading/error states.
**Tests:** submit posts the options and navigates; 429 shows the wait time; receipt picks a verified number only.

### Task 5: `/r/[id]` live run
Specimen tray (20 wells: found/out/capped), step list, refined question card, paper-by-paper reading list, elapsed time;
terminal states: rejected (guard reason), error, cancelled, interrupted→resuming; on `done` loads the result.
**Tests:** reducer-driven render for a recorded event sequence; rejected/error states; stream drop → polling fallback.

### Task 6: Report bench
Question block (refined question, interpretation, PICO, assumptions), summary with clickable citations, evidence strength
(GRADE-lite scale + factors), comparison matrix (glyph buttons), consensus and conflict panels (likely reasons), paper
list, source rail (sticky; bottom drawer < 900px) showing the verbatim quote with the number highlighted, quality block,
TH/EN switch (localized vs `_en` copies), external context notes. **Tests:** clicking a cell/citation fills the rail;
unverified effect shows a Hole; paper with `card: null` shows its error; no-paper result shows the explicit message.

### Task 7: Interactive charts and filters
ECharts: forest plot (log HR/OR/RR axis, CI bars, direction glyph markers, unverified omitted and listed), PRISMA flow
(found → unique → screened → selected → full text → extracted, animated), study map (year × sample size × direction ×
design). Filters/sliders: minimum relevance, year range, risk of bias, study design — applied to matrix, forest and map.
**Tests:** pure option builders to scale (axis contains every CI; unverified excluded); filters reduce rows.

### Task 8: `/about`
How it works, limits ("not medical advice"), REST quick start, API keys and webhook signature verification (Python and Node
snippets), MCP connection (Claude Code command, JSON config), copy buttons. **Tests:** copy button calls clipboard and
falls back to selecting the text.

### Task 9: Container, compose and end-to-end tests
`frontend/Dockerfile` (standalone output), compose service `web` on :3000 with `NEXT_PUBLIC_API_URL`; Playwright e2e with
network mocks (fixture result + scripted SSE) for landing→live→report, rail interaction, 429, rejected, phone width, dark
theme; one live smoke against the stub stack. README/CLAUDE.md updates.

### Task 10: Design review
Run the design-review skill against the running app, fix findings, re-verify.
