@AGENTS.md

- Next.js 16 — read the bundled docs in `node_modules/next/dist/docs/` before changing framework code (params are Promises, `PageProps<'/r/[id]'>`, no `next lint`). Commands: `npm test`, `npm run lint`, `npm run typecheck` (runs `next typegen`), `npm run e2e`. Verified numbers render only through `VerifiedNumber`; blanked values through `Hole`; every number the system computes only through `ComputedNumber` (meta-analysis pooled values from `src/lib/meta-view.ts`, and since Plan 20 the summary-of-findings participant sum; counts of studies stay plain figures). Chart and report data come only from the view-model modules: `src/lib/charts-data.ts` (chart data, axes, tallies, study map) and `src/lib/report-view.ts` (forest panels, SoF rows, key findings); neither ever computes a number shown as if from a paper.

- Report text (Plan 20): report chrome comes from `src/lib/i18n-report.ts` (a few TH/EN pairs stay beside the data helpers that format them; see DESIGN.md Localisation); a term's name comes from `src/lib/term-names.ts`, shared by the home page's `GLOSS`, the report's `GLOSSARY` and `DESIGN_LABEL` (parity pinned in `glossary.test.ts`). Papers that are not evidence (`isNotEvidence` in `src/lib/trial-reports.ts`: `related_to` or `design_excluded`) are left out of every tally, pool and chart (direction tally, RoB summary, study map, DTA); the lit-matrix and evidence-map still list them as rows; the title block and PRISMA count them.

- Report (Plan 20, frontend): the section order comes from `SECTIONS_BY_TYPE` (answer first). Report chrome is in the
  `frontend/src/lib/i18n-report.ts` string table (new strings go there) and `<html lang>` follows the report's language. Print: always light, controls
  hidden, every disclosure open, verified numbers print with ✓ and blanked ones as "[unverified]". The offline file
  (`/r/{id}/report.html`) makes no network request: it embeds Martian Mono (OFL) and nothing else, and has no links back
  to the service.

- The live stage's team (2D team view and 3D, the default view) reads `Scene` only through `src/lib/agent-team.ts`: phases (คิด/วิเคราะห์/วางแผน/ลงมือ) are labels for real events, never timers or model thoughts, so `PHASE_NOTE` (in `src/lib/team-copy.ts`, with the phase labels, to keep the eager chunk small) renders wherever phases do; the view choice is `mra.stageView` (`src/lib/stage-view-pref.ts`).

## Design System
Read `../DESIGN.md` before visual or UI work: it defines the fonts, colors, spacing, and
aesthetic direction. Ask the user before departing from it. When reviewing or QA-ing
UI, flag code that doesn't match DESIGN.md.
