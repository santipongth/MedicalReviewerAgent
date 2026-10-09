@AGENTS.md

- Next.js 16 — read the bundled docs in `node_modules/next/dist/docs/` before changing framework code (params are Promises, `PageProps<'/r/[id]'>`, no `next lint`). Commands: `npm test`, `npm run lint`, `npm run typecheck` (runs `next typegen`), `npm run e2e`. Verified numbers render only through `VerifiedNumber`; blanked values through `Hole`; charts use only `src/lib/charts-data.ts` (never compute a number shown as if from a paper).

## Design System
Read `../DESIGN.md` before visual or UI work: it defines the fonts, colors, spacing, and
aesthetic direction. Ask the user before departing from it. When reviewing or QA-ing
UI, flag code that doesn't match DESIGN.md.
