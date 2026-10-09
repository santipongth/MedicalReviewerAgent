---
# gstack: design-md-format=spec
name: Medical Reviewer Agent
description: "Theatre Green: a calm operating-theatre instrument where every verified number carries its receipt."
colors:
  ground: "#E9EFEB"
  surface: "#F8FAF9"
  rail: "#DCE6E0"
  text: "#10241E"
  text-muted: "#4A5E57"
  rule: "#BCCAC1"
  primary: "#0E5A47"
  on-primary: "#FFFFFF"
  highlight: "#F2D16B"
  tape: "#E6DDB8"
  tape-stripe: "#10241E"
  hatch: "#9AA8A0"
  finding-supports: "#0072B2"
  finding-harm: "#D55E00"
  finding-none: "#5F6B73"
  finding-mixed: "#8E3B7E"
  finding-unclear: "#5F6B73"
  success: "#0E5A47"
  warning: "#8A5A00"
  warning-bg: "#F5E7C4"
  error: "#A33A12"
  error-bg: "#F6DDD2"
  info-bg: "#DDE9F3"
  dark-ground: "#14271F"
  dark-surface: "#1B3029"
  dark-rail: "#22392F"
  dark-text: "#DDEAE2"
  dark-text-muted: "#9DB3A8"
  dark-rule: "#2F4A3F"
  dark-primary: "#5FC3A0"
  dark-on-primary: "#0B1F18"
  dark-highlight: "#E9C75A"
  dark-tape: "#3A4A36"
  dark-tape-stripe: "#DDEAE2"
  dark-hatch: "#4F665B"
  dark-finding-supports: "#3B98D4"
  dark-finding-harm: "#DB712F"
  dark-finding-none: "#9AA5AD"
  dark-finding-mixed: "#B05C9E"
  dark-warning: "#E9C75A"
  dark-warning-bg: "#3A3420"
  dark-error: "#F08A4B"
  dark-error-bg: "#3B2A20"
  dark-info-bg: "#1E3342"
typography:
  display:
    fontFamily: Bai Jamjuree
    fontWeight: 700
    fontSize: clamp(2rem, 4.2vw, 3.25rem)
    letterSpacing: 0em
  heading:
    fontFamily: Bai Jamjuree
    fontWeight: 600
    fontSize: 1.125rem
  body:
    fontFamily: Anuphan
    fontSize: 1rem
    lineHeight: 1.7
  body-thai-reading:
    fontFamily: Anuphan
    fontSize: 17px
    lineHeight: 1.75
  label:
    fontFamily: Bai Jamjuree
    fontWeight: 600
    fontSize: 0.75rem
    letterSpacing: 0.04em
  number-verified:
    fontFamily: Martian Mono
    fontWeight: 500
    fontStretch: 87.5%
    fontFeature: tnum
  quote:
    fontFamily: Source Serif 4
    fontSize: 1.05rem
    lineHeight: 1.6
rounded:
  sm: 2px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  4xl: 64px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  button-ghost:
    borderColor: "{colors.rule}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
  input:
    backgroundColor: "{colors.ground}"
    borderColor: "{colors.rule}"
    rounded: "{rounded.sm}"
  reading-surface:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.rule}"
    rounded: "{rounded.sm}"
  source-rail:
    backgroundColor: "{colors.rail}"
  table-row:
    height: 36px
    borderColor: "{colors.rule}"
---

# Medical Reviewer Agent

## Overview

**Creative North Star:** an instrument from the operating theatre and the sterile supply room, not a magazine and not a SaaS dashboard. The people reading these reports work in hospitals; the request slip, the autoclave tape and the green drape are their world, and every design choice serves one promise: every number is verifiable.
**Product context:** public, no-login literature-review agent (web, REST, MCP) for clinicians, researchers and students in Thailand and internationally. Peers: Elicit, Consensus, Scite, OpenEvidence, Cochrane Library.
**Mode per surface:** Landing `/`: Persuade, by showing a real receipt rather than claims. Report `/r/[id]`: Read and Operate. Live run: Experience: a working instrument panel. `/about`: Read.
**Reference sites:** https://elicit.com, https://consensus.app (Scite, OpenEvidence and Cochrane Library were blocked during research on 2026-10-04).
**Key characteristics:**
- A green environment, never white or cream.
- Verified numbers stand out by face and by a striped tape underline before anyone reads them.
- The right-hand source rail always shows the exact sentence behind what you selected.
- Gaps are shown, not hidden: a hatched "not verified" slot replaces any number that failed the check.
- Square 2px corners, 1px rules, no shadows.

## Colors

**Strategy:** Committed. Theatre green owns the environment (ground, surface, rail); one darker green is the only action color. Highlight yellow appears only behind a matched span in a source quote. The five finding-direction colors (Okabe-Ito based) use hues the brand does not, so the data never competes with the chrome.
**Light or dark:** light ("Day theatre") is the default for daytime desks and wards; dark ("Night shift") is a deep, clearly green ground for on-call reading at night, not a near-black inversion. Dark tokens are the `dark-*` entries above; surfaces keep their order (ground < surface < rail) in both themes.
Interaction is signalled only by `primary`. Directions always pair a color with a glyph: supports = filled circle, harm = filled diamond, no association = flat bar, mixed = half-filled circle, unclear = dashed ring. Color is never the only cue.

## Typography

Each family has exactly one job, so the face itself tells the reader the status of what they see:
- **Bai Jamjuree** (Cadson Demak, Thai + Latin): headings, UI, buttons, labels. Squared counters read like engraved instrument markings. Sentence case; labels get 0.04em tracking.
- **Anuphan** (Cadson Demak, Thai + Latin): all running text. Thai reading text is 17px with 1.75 line-height so tone marks and vowels above and below the line have room.
- **Martian Mono** (wdth 87.5, weight 500, tabular): only numbers that passed verification against the paper text. If a number is not verified it is never set in this face.
- **Source Serif 4**: only verbatim sentences quoted from papers (the paper's own voice). Translated summaries stay in Anuphan.
Loading: Google Fonts via `next/font/google` with `display: swap`, Thai and Latin subsets for Anuphan and Bai Jamjuree, Latin only for Martian Mono and Source Serif 4. Verified 2026-10-04 (all served by fonts.googleapis.com; Martian Mono's width axis included).

## Layout

- **Report "bench":** a 12-column grid at 1024px and up, with a reading column of 7 columns and a sticky source rail of 5 columns. Below 1024px the rail becomes a bottom drawer: a modal dialog with a flat backdrop, focus on its heading, and Esc or a backdrop tap to close.
- **Report order:** the answer comes first: bottom line, then where studies agree and conflict, the comparison matrix, charts, gaps, papers, and last the method and downloads. A sticky section nav lets the reader jump between them.
- **Width:** the page is at most 1240px wide, and running text is at most 65 characters.
- **Report density:** comfortable-compact, with 36px table rows and a sticky first column in the comparison matrix. The matrix scrolls horizontally inside its own container.
- **Landing:** left-aligned and generous. The headline sits beside the request slip; below them a sample report from a real review (forest rows and numbers tap to show their source sentence in a rail), then how a number earns its tape, the run timeline, the agent band and recent public reviews. The site footer carries the disclaimer and data sources.
- **Gutters:** the side gutter is 16px at every width, and the spacing scale has a 4px base.

## Elevation & Depth

Flat. Depth comes from surface order (ground → surface → rail) and 1px rules, never from shadows or glows. The one exception is the 2px focus ring in `primary`.

## Shapes

2px radius everywhere (cut tape). `full` is reserved for round data glyphs (packet dots, reader slots, search-engine satellites), never for buttons or chips.

## Components

- **Verified number:** Martian Mono with a 4px autoclave-tape underline (135° stripes, `tape-stripe` on `tape`). It is clickable: it selects its source sentence in the rail.
  - During a live run the number first appears in Anuphan with no tape.
  - When verification passes, the face switches and the tape fades in over 400ms.
- **Not verified:** a hatched 45° slot in `hatch` with a dashed border, labelled "ไม่ยืนยัน / not verified". It is never omitted.
- **Uncertain paper:** two models disagreed. It gets a dashed `finding-harm` torn edge on its rail entry or card, plus a warning flag (`UncertainFlag`, a small flag icon with a text label). The ◆ glyph is reserved for the harm direction and is never used for "uncertain".
- **Source rail:**
  - Shows the paper title, a facts list (year, design, n, risk of bias, direction) and the verbatim quote in Source Serif 4.
  - The matched number in the quote has a `highlight` background, and a "found verbatim in the paper" flag follows the quote.
  - Ends with a link out to PMC, PubMed or the DOI.
- **Comparison matrix:** outcome × paper. Each cell is a glyph button with an aria-label naming the direction. The selected cell gets a `rail` fill and an `ink` border.
- **Report section nav:** a sticky row of anchor links under the site header (`nav` labelled "ในรายงานนี้") to each report section. It scrolls horizontally on a phone, and the current section is marked with `aria-current`. It is a plain text link row on `surface` (the reading column it sits in), with no pills.
- **Glossary term:** a jargon word shown as a dotted-underline button (`Term`) that toggles a short Thai/English explanation. On a phone the explanation is a bottom sheet, from `sm` up a 288px popover under the word. Tap or click toggles it (`aria-expanded`), Esc or an outside tap closes it, and an open term takes the Esc before any drawer around it. It is flat, with a 1px `rule` border.
- **Forest plot:** log scale, with the null line drawn in `text` and dashed ticks drawn in `rule`. Markers use the direction glyph shapes. Unverified values are omitted and labelled, never estimated.
- **Review-type picker:** a fieldset ("รูปแบบการทบทวน") of three radio rows (name, English name, one-line description) on the request slip, always visible, never folded into the extra options. Selected row gets a `primary` border; rows are ≥44px tall and the whole row is clickable. Distinct from the study-type filter ("ชนิดงานวิจัยที่จะรวม").
- **Literature review matrix:** one row per paper in a table that scrolls inside its own bordered container (sticky first column, never page scroll), with clamped cells, filters and a CSV link. Numbers only via `VerifiedNumber`/`Hole`; scoping hides direction and risk of bias.
- **Concept map:** an ECharts tree (question, framework parts, outcomes, grouped study leaves) inside a scrollable region, with "ดูเป็นตาราง" switching to a nested outline whose paper refs open the rail. Edges come only from comparison cells; counts use `font-display tabular-nums`, never the verified-number face.
- **Evidence map (scoping):** count tables of concept and year × study design, counts only, scrollable region with sticky row headers; labelled as counts of studies, not an appraisal.
- **Not-graded strength line:** when `evidence_strength` is null the summary says "ไม่ได้ประเมินความแข็งแรงของหลักฐาน" with the review type, never a meter or "very low".
- **Agent stage (live run):** a flat 2D SVG of the pipeline, driven only by real review events. Node tiles are 44px with 2px corners. The wide layout (≥1024px, the same `lg` breakpoint as the rail/drawer; 960×330 viewBox) is a horizontal lane with the external-tools node above it; narrow (<1024px) is a vertical lane with the external-tools node in the lane. Both layouts draw the five search engines (PubMed, arXiv, Semantic Scholar, OpenAlex, Crossref) as satellites of the search node: on an arc above it (wide) or in a row under its label (narrow). Stage text is at least 12px effective (reader refs 11px).
  - Status vocabulary: active = solid `primary`; working = marching dashed `primary`, the indeterminate state, used only for phases without progress events; done = `ink` + ✓; failed = `err` + ✕; skipped = dashed `rule`; paused = `warn-bg`.
  - Edges are `rule`, ghost (visited) edges `ink`, the live edge `primary`.
  - Packets are 7px round dots, signals of real events only, at most 8 per event and 24 on screen. The shown number is the event's payload count, never the dot count.
  - The reader pool is round slots (full radius allowed), one per paper, with the flag for uncertain papers. A slot means reading or queued, never in flight.
  - A trace log ("บันทึกการทำงาน") lists every event, and one throttled milestone announcer (`role="status"`) speaks for screen readers. The text ledger always stays below the stage.
  - **Optional 3D view:** an opt-in toggle ("มุมมอง 3D" / "มุมมอง 2D", a real button with `aria-pressed`) shown only on wide screens (≥1024px) with WebGL and without `prefers-reduced-motion`; 2D stays the default and is the only view on mobile, under reduced motion and without WebGL (a failing canvas falls back to 2D with a note). It shows the same scene and the same status vocabulary (done = ring + ✓ in the label, failed = ✕, uncertain = flag, working = dashed ring), driven only by real events. Depth and simple shading are allowed here (one ambient and one directional light, flat colours); still no glow, bloom, post-processing, starfield, particles or gradients. The background is the `surface` token, and Thai labels are DOM text (≥12px), never canvas text. The wrapper keeps the 2D `role="img"` label; the canvas is `aria-hidden`.
  - **Thought block:** a `rail` strip (no border, never a nested card) at the head of the stage panel row, with the status mark, the label "เอเจนต์กำลังทำ" and the current step heading, plus a body of at most 3 lines on a phone. It is built only from received events (current agent, counts, queries, finished papers, step start time); it never says a paper is "being read now" (all readers start together), only finished papers or "กำลังอ่านหรือรอคิว". A labelled region with no live region; `MilestoneStatus` stays the only announcer.
  - **Live evidence board:** a `surface` block under the stage with per-direction chips of finished reads, in the fixed order positive, negative, null, mixed, unclear (as in the report), each with its glyph and accessible name; counts in Bai Jamjuree tabular figures, no percentages, no ranking, no highlighted largest column. Always titled "ตามที่เอเจนต์อ่าน" (a model judgement) and "ยังไม่ใช่ข้อสรุป". Papers with no (or unknown) direction are counted aside as "ไม่มีข้อมูลทิศทาง", never as unclear; uncertain papers carry the flag; the SR/MA overlap note shows whenever a pooled design is on the board. Below 1024px the chip detail is collapsed behind a "ดูรายฉบับ" toggle (44px target) and only the counts show.
  - **Grouped log:** the trace log groups consecutive rows by step, with a header (status mark, icon, step title, summary from counts, "ใช้เวลา m:ss"). Durations are the difference of two received `elapsed_s` values; a running step shows only its start ("เริ่ม m:ss"), never a ticking counter. Finished groups are collapsed behind "ดู n รายการ", the current one is open.
  - **3D piles and thought label:** per-direction piles of flat tokens on a tray plane, shape-coded with the same glyph shapes and colours as the board and labelled with a DOM glyph, count and "ทิศทางผลตามที่เอเจนต์อ่าน" caption; a thought label (same short text as the thought block) floats over the current node on a hairline `rule` leader. Both are DOM text, `aria-hidden`.
- **Buttons:** primary is solid `primary` (hover brightens, disabled at 45% opacity). Ghost has a 1px `rule` border that turns `text` on hover. Focus-visible is a 2px `primary` outline at 2px offset.
- **Status blocks:** a background tint plus a bold label. Success uses a `success` tint, warning `warning-bg`, error `error-bg`, info `info-bg`. Never a colored left border.

## Do's and Don'ts

- Do set every verified number in Martian Mono with tape, and every unverified value as a hatched slot.
- Do pair each finding color with its glyph and an accessible name.
- Do keep the brand colors (greens, highlight yellow) out of charts.
- Do show the source sentence for any selected number in the rail.
- Do design empty, loading, error and long-content states for each component.
- Don't use shadows, glows, gradients or pill-shaped buttons.
- Don't use a logo wall or testimonial row; use a real receipt from a public review.
- Don't use green or red for benefit or harm; use blue and vermillion with glyphs.
- Don't nest cards or put rounded drop-shadow cards around everything.
- Don't center-align body content or put a kicker above headings.

## Motion

- **Approach:** minimal-functional.
- **Easing:** enter ease-out, exit ease-in, move ease-in-out.
- **Duration:** micro 50–100ms, short 150–250ms (stage status changes, hover), medium 250–400ms (tape fade-in, drawers).
- **The one authored moment:** during a live run, a number appears in plain ink and the autoclave stripes fade in once verification passes.
- **The second authored moment:** the agent stage. Packets travel 700ms ease-in-out along curved edges (120ms stagger) when an event arrives; a working phase is a 1.2s marching outline; the reader pulse marks a paper being read. Bursts and replays collapse to the final state.
- **Reduced motion:** `prefers-reduced-motion` removes every transition, and states appear in their final form. On the stage: no packets, no loops, final states only. JS motion goes through `MotionConfig reducedMotion="user"` plus `useReducedMotion`.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-04 | Initial design system "Theatre Green" | Created by /design-consultation from product context, research on Elicit and Consensus, and three independent proposals. Mine supplied the clinical-instrument direction, Bai Jamjuree with Anuphan, and Okabe-Ito. Codex supplied the provenance-led hero and source sheet. The Claude subagent supplied the theatre green, autoclave tape, Martian Mono rule, Source Serif 4 quotes, glyphs, request slip and showing the gaps. The user approved it after an HTML preview at https://claude.ai/artifact/XUvrWN7gxW3GhzEMrEnNpY |
| 2026-10-05 | Landing direction C: "อย่าเพิ่งเชื่อเรา แตะที่ตัวเลขดูก่อน" | Chosen from three HTML mockups (https://claude.ai/artifact/JWBF5BDC9c2Hb1uenjivpG). The receipt is a committed snapshot of a real review (MACE rows of the colchicine review) rendered by the same components as the report, so the landing shows rather than claims; a test pins every shown number to its quote |
| 2026-10-05 | Code gets its own face (`--font-code`: ui-monospace stack) | Martian Mono stays exclusive to verified numbers; code samples, ref chips and pipeline counts had borrowed it, which diluted the signal |
| 2026-10-05 | Dark finding colors re-stepped to #3B98D4 / #DB712F / #B05C9E | dataviz validator: the preview's dark set failed the dark lightness band (L 0.48–0.67) and was in the CVD floor band; the new set passes all checks on #1B3029 (light set passes unchanged) |
| 2026-10-09 | Plan 10 (UX clarity): rail/drawer breakpoint stays at 1024px; report is answer-first; agree/conflict moves above the matrix; section nav, glossary term and UncertainFlag added | Readers could not tell where the answer was or what the jargon meant. The nav and glossary are plain, flat and keyboard operable; the warning flag replaces ◆ for "uncertain" so ◆ keeps meaning harm only |
| 2026-10-09 | Plan 11: the live run's step list + specimen tray are replaced by a real-time 2D agent stage (SVG + motion), text ledger kept | The user approved; adapted from sakshigupta372/AI-Agent-observatory (graph of agents, curved edges with travelling packets, planner task chips, ghost edges, trace panel) to Theatre Green: flat, 2D, no bob or glow, driven only by real events, reduced-motion and mobile first |
| 2026-10-09 | Plan 12: an optional 3D view of the agent stage (wide screens, WebGL, no reduced motion; opt-in toggle, 2D stays default) | The user approved depth and simple shading for this view only (one ambient + one directional light, flat colours); glow, bloom, post-processing and starfields stay out. Adapted from the observatory's 3D node, arc, packet and camera ideas; the scene, status vocabulary and Thai DOM labels are the same as 2D, and three.js loads only in a lazy chunk |
| 2026-10-09 | Plan 13: live-run polish: thought block, live evidence board, grouped log with real durations, 3D direction piles and thought label | The stage showed activity but not what the agent was thinking or finding. Everything added traces to a received event (`extracted` now carries the card's direction and design); direction is always labelled as the agent's reading, the board never ranks or concludes, and no client-side ticking time is shown |
| 2026-10-10 | Plan 14a: review types (narrative, SLR, scoping), literature review matrix, concept map, evidence map, not-graded strength line | Different questions need different reviews, and an honest report must not grade what it did not appraise. New views reuse existing tokens: flat tables and an ECharts tree with outline twins, glyph-shaped finding colours, counts in the display face so the verified-number face keeps meaning "checked against the abstract" |
| 2026-10-04 | Tokens from the approved HTML preview | AI image mockups were unavailable (no OpenAI key), so the HTML preview (Path B) is the source of every token |
