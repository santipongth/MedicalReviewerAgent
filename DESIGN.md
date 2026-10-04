---
# gstack: design-md-format=spec
name: Medical Reviewer Agent
description: Theatre Green: a calm operating-theatre instrument where every verified number carries its receipt.
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
  dark-finding-supports: "#56B4E9"
  dark-finding-harm: "#F08A4B"
  dark-finding-none: "#9AA5AD"
  dark-finding-mixed: "#D98BC6"
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
**Mode per surface:** Landing `/`: Persuade, by showing a real receipt rather than claims. Report `/r/[id]`: Read and Operate. Live run: Experience, kept functional. `/about`: Read.
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

- **Report "bench":** a 12-column grid at 1024px and up, with a reading column of 7 columns and a sticky source rail of 5 columns. Below 900px the rail becomes a bottom drawer.
- **Width:** the page is at most 1240px wide, and running text is at most 65 characters.
- **Report density:** comfortable-compact, with 36px table rows and a sticky first column in the comparison matrix. The matrix scrolls horizontally inside its own container.
- **Landing:** left-aligned and generous. The search is a request slip whose PICO fields fill back in after submission, and a real receipt from a public review sits beside it.
- **Gutters:** the side gutter is 16px at every width, and the spacing scale has a 4px base.

## Elevation & Depth

Flat. Depth comes from surface order (ground → surface → rail) and 1px rules, never from shadows or glows. The one exception is the 2px focus ring in `primary`.

## Shapes

2px radius everywhere (cut tape). `full` is reserved for round data glyphs and specimen-tray wells, never for buttons or chips.

## Components

- **Verified number:** Martian Mono with a 4px autoclave-tape underline (135° stripes, `tape-stripe` on `tape`). It is clickable: it selects its source sentence in the rail.
  - During a live run the number first appears in Anuphan with no tape.
  - When verification passes, the face switches and the tape fades in over 400ms.
- **Not verified:** a hatched 45° slot in `hatch` with a dashed border, labelled "ไม่ยืนยัน / not verified". It is never omitted.
- **Uncertain paper:** two models disagreed. It gets a dashed `finding-harm` torn edge on its rail entry or card, plus a warning flag.
- **Source rail:**
  - Shows the paper title, a facts list (year, design, n, risk of bias, direction) and the verbatim quote in Source Serif 4.
  - The matched number in the quote has a `highlight` background, and a "found verbatim in the paper" flag follows the quote.
  - Ends with a link out to PMC, PubMed or the DOI.
- **Comparison matrix:** outcome × paper. Each cell is a glyph button with an aria-label naming the direction. The selected cell gets a `rail` fill and an `ink` border.
- **Forest plot:** log scale, with the null line drawn in `text` and dashed ticks drawn in `rule`. Markers use the direction glyph shapes. Unverified values are omitted and labelled, never estimated.
- **Specimen tray (live run):** 20 wells. A well fills when its candidate is found, empties when it is screened out, and is capped in `primary` for the 8 selected papers.
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
- **Duration:** micro 50–100ms, short 150–250ms (wells, hover), medium 250–400ms (tape fade-in, drawers).
- **The one authored moment:** during a live run, a number appears in plain ink and the autoclave stripes fade in once verification passes.
- **Reduced motion:** `prefers-reduced-motion` removes every transition, and states appear in their final form.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-04 | Initial design system "Theatre Green" | Created by /design-consultation from product context, research on Elicit and Consensus, and three independent proposals. Mine supplied the clinical-instrument direction, Bai Jamjuree with Anuphan, and Okabe-Ito. Codex supplied the provenance-led hero and source sheet. The Claude subagent supplied the theatre green, autoclave tape, Martian Mono rule, Source Serif 4 quotes, glyphs, request slip and showing the gaps. The user approved it after an HTML preview at https://claude.ai/artifact/XUvrWN7gxW3GhzEMrEnNpY |
| 2026-10-04 | Tokens from the approved HTML preview | AI image mockups were unavailable (no OpenAI key), so the HTML preview (Path B) is the source of every token |
