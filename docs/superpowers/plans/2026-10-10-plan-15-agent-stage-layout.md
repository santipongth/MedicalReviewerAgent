# Plan 15 — Agent stage composition ("เวทีเอเจนต์")

**Goal:** make the live agent-stage section box balanced, orderly and calm: the stage reads as one centred composition
that uses the box width, every sub-activity sits in one aligned detail band under its agent, nothing is truncated into
nonsense, and the header/thought card/legend have one clear hierarchy. 2D first; the 3D view keeps working.

**Request (2026-10-10):** "ออกแบบและจัดระเบียบในกล่อง section ของ 'เวทีเอเจนต์' ให้สวยงาม จัดสมดุล ออกแบบ UX/UI ให้สวยกว่านี้"

**Spec/authority:** DESIGN.md (Theatre Green: flat, no shadows/gradients/coloured left borders, Okabe-Ito finding colours
always with glyph shapes, ◆ = harm only, touch targets ≥44px, font-display for labels/counts). Plans 11–13 built the stage
(`frontend/src/components/review/stage/*`, `frontend/src/lib/agent-layout.ts`, `agent-scene.ts`, `stage-view.tsx`,
`live-run.tsx`, `thought-card.tsx`). Before screenshots: `.superpowers/stage-before/stage-{1440,390}-{light,dark}*.png`.

## Problems seen (screenshots 2026-10-10, mid-run: 12/30 read)
1. The SVG is capped at `max-w-[960px]` and left-aligned in a ~1170px box: the pipeline sits left, ~25% of the box is empty on the right.
2. The 3D toggle floats beside the thought card at the top right, not aligned with the section label; the label "เวทีเอเจนต์" is a lone tiny caption.
3. Search satellites fan above the search node in a cramped arc; "Semantic Scholar" sits over the connector lines.
4. Query chips are truncated to "metformi…" (unreadable).
5. Screening batches wrap 5+1 checkboxes under the screen node; reads as debris.
6. Reader-pool slot labels ("P13") overflow their circles; the grid hangs under the reader node only, leaving synth/translate/finalize columns empty underneath — lopsided.
7. Node labels break Thai mid-word over two lines ("ค้นฐาน/ข้อมูล", "ดึง/บทคัดย่อ"); counts sit at different heights.
8. Legend is a long flat row of 7 items with no grouping.
9. 390px: satellite labels collide in a row; otherwise OK.

## Global constraints
- Behaviour unchanged: same scene model, statuses, packets, events, aria summary (`sceneSummary`), captions, reduced motion, 3D toggle rules and storage key. Only geometry, composition and styling change.
- `agent-layout.ts` stays pure; segX/segY non-allocating. Layout tests are updated to the new geometry, not deleted; the e2e text-overlap and fit checks (`e2e/live-stage.spec.ts` `stageText`, narrow 390 fit) must keep passing and be extended to the new detail band.
- DESIGN.md compliance as above; dark and light both checked; axe clean at 1440 and 390.
- No new dependencies. Bundle of the stage chunk must not grow by more than ~3 KB.
- Git: Edit/Write only (LF), stage only touched files, leave `infra/searxng/limiter.toml.new` alone; commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands (frontend/): `npm test && npm run lint && npm run typecheck && npm run build:standalone && npm run e2e`.

## Task 1: Stage composition and geometry (wide + narrow)
**Files:** `src/lib/agent-layout.ts` (+test), `src/components/review/stage/*` (agent-node, agent-stage, query-chips, screen-batches, reader-pool, search-satellites, stage-legend, stage-placeholder), `stage-view.tsx`, `live-run.tsx` (section header only), `thought-card.tsx` (spacing only), e2e `live-stage.spec.ts`.
- Section header: one row — `เวทีเอเจนต์` heading (keep `id="h-stage"`), a quiet step indicator (e.g. "ขั้น 7 จาก 10" from existing scene data, `font-display tabular-nums text-muted`), and the 3D toggle right-aligned in the same row (≥44px target). Thought card full width below it.
- Wide viewBox widened so the pipeline spans the box and is centred (`mx-auto`, no left-hanging max width); nodes evenly spaced on one row; uniform tile size.
- Node labels: single line, no mid-word Thai breaks (short labels kept on one line; `AGENT_LABEL` text unchanged unless a shorter synonym is needed — then update tests), count on a fixed second baseline under every node (`font-display tabular-nums`).
- One **detail band** under the node row with a common top edge; each detail aligned to its agent's column:
  - search: the five sources as a compact vertical list (status dot + name) under the search node — no fan above; connectors removed or short.
  - plan: queries as full-text rows (wrap/ellipsis at the column-pair width, ≥ 20 chars visible), "+n" if more than shown; full text in `<title>`.
  - screen: one segmented progress bar (batches) + "ผ่าน n · ตัดออก n" — no wrapping checkbox grid.
  - read: reader-pool grid centred under reader and allowed to span the empty synth/localize/finalize columns so the band is balanced; slot radius/font sized so "P30" fits inside its circle; status glyphs unchanged.
- Legend: two labelled groups ("ขั้นตอน" / "งานวิจัย"), compact, wrapping cleanly; caption under it unchanged.
- Narrow (390): keep the vertical pipeline; sources become a vertical list beside/below search with no label collisions; detail items left-aligned in one column to the right of the spine.
- Placeholder reserves the new aspect so nothing shifts on load.
- **Verify visually:** temporary Playwright spec (template in the controller's scratchpad copy given in the dispatch) at 1440 and 390, light and dark, at three moments (searching, screening, 12/30 read, synthesizing); crop the stage box with PIL, Read the crops, iterate until balanced. Save finals to `.superpowers/stage-after/`. Delete the temp spec.
- **Tests:** layout unit tests (centred span, common detail-band top, no rect overlaps between details of neighbouring columns, slot label fits radius), e2e text overlap incl. detail band, narrow fit.

## Task 2: 3D parity check, docs, DESIGN.md
- 3D view: header row/toggle placement works in 3D mode; legend groups shared.
- DESIGN.md: update the Agent stage component entry (composition, detail band, legend groups) + Decisions Log row (2026-10-10, Plan 15).
- Bundle size before/after of the stage chunk recorded in the report.
- Full verification; screenshot review against DESIGN.md.
