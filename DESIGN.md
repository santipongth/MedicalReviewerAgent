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
- The report answers first: the bottom line and key findings lead, methods and references close it.
- Square 2px corners, 1px rules, no shadows.

## Colors

**Strategy:** Committed. Theatre green owns the environment (ground, surface, rail); one darker green is the only action color. Highlight yellow appears only behind a matched span in a source quote. The five finding-direction colors (Okabe-Ito based) use hues the brand does not, so the data never competes with the chrome.
**Light or dark:** light ("Day theatre") is the default for daytime desks and wards; dark ("Night shift") is a deep, clearly green ground for on-call reading at night, not a near-black inversion. Dark tokens are the `dark-*` entries above; surfaces keep their order (ground < surface < rail) in both themes.
Interaction is signalled only by `primary`. Directions always pair a color with a glyph: supports = filled circle, harm = filled diamond, no association = flat bar, mixed = half-filled circle, unclear = dashed ring. Color is never the only cue. One vocabulary for DOM and charts: `src/lib/glyphs.ts` holds the path data, chart markers are its `path://` symbols drawn at their own aspect, and the CSS `.g-*` glyphs draw the same shapes (the flat bar is 14×5, 100×36 in charts). In a chart the flat bar is drawn 1.4× wider with a 2px `surface` outline, so it cuts through its own same-coloured CI line; outlined glyphs (mixed, unclear) get no outline. Qualitative and mixed-methods studies never get a direction glyph anywhere (report, rail, charts, live board): they report themes.

## Typography

Each family has exactly one job, so the face itself tells the reader the status of what they see:
- **Bai Jamjuree** (Cadson Demak, Thai + Latin): headings, UI, buttons, labels. Squared counters read like engraved instrument markings. Sentence case; labels get 0.04em tracking.
- **Anuphan** (Cadson Demak, Thai + Latin): all running text. Thai reading text is 17px with 1.75 line-height so tone marks and vowels above and below the line have room.
- **Martian Mono** (wdth 87.5, weight 500, tabular): only numbers that passed verification against the paper text. If a number is not verified it is never set in this face.
- **Source Serif 4**: only verbatim sentences quoted from papers (the paper's own voice). Translated summaries stay in Anuphan.
Loading: Google Fonts via `next/font/google` with `display: swap`, Thai and Latin subsets for Anuphan and Bai Jamjuree, Latin only for Martian Mono and Source Serif 4. Verified 2026-10-04 (all served by fonts.googleapis.com; Martian Mono's width axis included). The offline report file embeds Martian Mono (Latin subset, `frontend/src/standalone/fonts/`, OFL) and loads nothing else: the other faces fall back to system fonts there.

## Layout

- **Report "bench":** one bordered frame. From 1280px three columns: a 10rem table of contents ("สารบัญ", sticky, `aria-current="location"` on the section in view), the reading column, and a 22rem sticky source rail. From 1024px the reading column (7fr) and the rail (5fr), with the sticky "ในรายงานนี้" link row on top. Below 1024px one column; the rail becomes a bottom drawer (a modal dialog with a flat backdrop, focus on its heading, Esc or a backdrop tap to close). A review with no included study has no rail and no left contents: the short top link row stays at every width. The rail starts empty ("แตะตัวเลขหรือรหัสงานวิจัยเพื่อดูประโยคต้นฉบับ") until the reader picks a study or number.
- **Report order:** answer first, from one list (`SECTIONS_BY_TYPE` in `src/lib/review-type.ts`; the contents and the page are built from it, and a section with nothing to show is left out): title block, bottom line, key findings, summary of findings (SLR and meta-analysis), study selection (PRISMA flow), study characteristics (evidence map for scoping, literature matrix), results by outcome (findings by study, forest panels, the pooled block), risk of bias, consistency and conflicts, evidence landscape (concept map, citation network), limitations, research gaps, discussion, methods, references, downloads and how to cite, and the verified-numbers appendix last. Narrative and scoping skip what they do not appraise (no SoF; scoping has no results group or risk of bias); a legacy result keeps its own short list. With no included study the selection flow comes right after the answer and is followed by "ลองแบบนี้".
- **Width:** the page is at most 1240px wide, and running text is at most 65 characters.
- **Report density:** comfortable-compact, with 36px table rows. A table that can be wider than the column (findings by study, evidence map) scrolls inside its own labelled region with a sticky first column and an edge fade; the summary of findings and the literature matrix fit the column and never scroll the page sideways (checked at 390).
- **Landing:** left-aligned and generous. The headline sits beside "ระบบนี้คืออะไร" (what the system is, in plain Thai), with the scope form at full content width under them; then the plain-language intro "รู้จักระบบนี้ใน 1 นาที" (five steps, benefits, a `warning-bg` limits note, and a "คำที่จะเจอในรายงาน" disclosure), a sample report from a real review (forest rows and numbers tap to show their source sentence in a rail), the capabilities band, then how a number earns its tape, the run timeline, the agent band and recent public reviews. The site footer carries the disclaimer and data sources.
- **Gutters:** the side gutter is 16px at every width, and the spacing scale has a 4px base.

## Elevation & Depth

Flat. Depth comes from surface order (ground → surface → rail) and 1px rules, never from shadows or glows. The one exception is the 2px focus ring in `primary`.

## Shapes

2px radius everywhere (cut tape). `full` is reserved for round data glyphs (packet dots, reader slots, search-engine satellites), never for buttons or chips.

## Components

- **Verified number:** Martian Mono with a 4px autoclave-tape underline (135° stripes, `tape-stripe` on `tape`). It is clickable: it selects its source sentence in the rail.
  - During a live run the number first appears in Anuphan with no tape.
  - When verification passes, the face switches and the tape fades in over 400ms.
- **Not verified (`Hole`):** a hatched 45° slot in `hatch` with a dashed border, labelled "ไม่ยืนยัน / not verified" with a "ทำไม?" term. It is never omitted. On paper it prints "[ไม่ได้ตรวจ]" / "[unverified]".
- **Computed number (`ComputedNumber`):** any number the system calculated, never one read from a paper: the meta-analysis values (pooled estimate and CI, I², τ², Q, p, SE, weights) and, since Plan 20, sums such as the summary-of-findings participants (the sum of verified sample sizes, with its "รวมจากที่ตรวจได้ m จาก n" note). Counts of studies stay plain display-face figures. Bai Jamjuree semibold tabular figures, no tape, never Martian Mono, plus a small outlined "คำนวณ" tag (0.68rem, `muted` text, 1px `rule` border, 2px corners). Its accessible name always says "คำนวณโดยระบบ ไม่ใช่ตัวเลขจากงานวิจัย"; the visible tag may be left off only in a column whose header already says "(คำนวณ)". Not clickable: it has no source sentence.
- **Meta-analysis section:** after the evidence charts. An `info-bg` status block whose bold label is exactly "คำนวณโดยระบบจากตัวเลขที่ตรวจกับบทคัดย่อแล้ว — ไม่ใช่ผลจากงานวิจัยฉบับใด", with the method limits listed once; then per pool the computed estimate, an I²/τ²/k/Q line (`font-display tabular-nums`), pool-specific cautions in a `warning-bg` block, the pooled forest plot, and a "วิธีคำนวณ" disclosure listing every input (ref, verified effect and CI, computed SE and weight) with the method and version. SR/MA rows are references (verified paper numbers, never pooled); exclusions are summarised by reason with counts and refs.
- **Pooled lozenge:** the pooled estimate in its forest plot is an outlined lozenge (stroke only in `text`, 2px, no fill) spanning the pooled CI, centred on the estimate, on its own bold "ค่ารวม (คำนวณ)" row under the studies. It is never the solid ◆, which keeps meaning harm. Study markers keep their direction glyphs, sized by weight; the null line is at 1 on a log axis for ratios, at 0 otherwise.
- **Uncertain paper:** two models disagreed. It gets a dashed `finding-harm` torn edge on its rail entry or card, plus a warning flag (`UncertainFlag`, a small flag icon with a text label). The ◆ glyph is reserved for the harm direction and is never used for "uncertain".
- **Source rail:**
  - Shows the paper title, a facts list (year, design, n, risk of bias, direction) and the verbatim quote in Source Serif 4.
  - The matched number in the quote has a `highlight` background, and a "found verbatim in the paper" flag follows the quote.
  - Ends with a link out to PMC, PubMed or the DOI.
- **Findings by study (comparison matrix):** outcome × paper. Each cell is a glyph button with an aria-label naming the direction. The selected cell gets a `rail` fill and an `ink` border. A qualitative or mixed-methods study's cell is a theme, not a direction: a small bordered word mark "พบ"/"found" (`font-display` semibold 0.75rem, 1px `ink` border, 2px corners, `aria-hidden`; the cell's aria-label says "พบประเด็นนี้ (งานเชิงคุณภาพ ไม่มีทิศทางผล)"), and the row header adds "พบใน k การศึกษา" in `muted`. The legend lists the mark next to the glyphs. Themes are counted, never called "supports". The concept map shows them as one neutral "พบใน k การศึกษา" group (pin marker, no direction colour), and the bottom line and live board count them aside ("…สรุปเป็นประเด็น ไม่นับตามทิศทางผล").
- **Meta-analysis without a pooled estimate:** two honest states, with one copy source (`META_POOL_COPY` in `src/lib/copy.ts`). "รวมผลไม่ได้" (the step ran; no outcome had ≥ 3 primary studies with the same measure and verified numbers) and "รวมผลไม่สำเร็จ" (the step did not complete; the cause is never claimed). Each shows as a suffix on the type in the title block, a `warn-bg` label chip with one reason line in the bottom line, and the section heading; the section body is a `warn-bg` note (no computed-number banner, no "estimates above" line), then results not pooled and SR/MA reference rows. The evidence strength stays as words but loses its graded bar ("จากงานแต่ละฉบับ ไม่มีค่ารวม").
- **Report section nav and contents:** below 1280px a sticky row of anchor links under the site header (`nav` labelled "ในรายงานนี้" / "In this report") that scrolls sideways with an edge fade; from 1280px a left table of contents (`nav` "สารบัญ" / "Contents"). Both list the same sections in `SECTIONS_BY_TYPE` order (anchors in `SECTION_ANCHOR`), mark the current one with `aria-current`, and are plain text links on `surface`, with no pills.
- **Glossary term:** a jargon word shown as a dotted-underline button (`Term`) that toggles a short Thai/English explanation. On a phone the explanation is a bottom sheet, from `sm` up a 288px popover under the word. Tap or click toggles it (`aria-expanded`), Esc or an outside tap closes it, and an open term takes the Esc before any drawer around it. It is flat, with a 1px `rule` border.
- **Forest panels (Plan 20):** one panel per outcome and per measure (never two measures or scales on one axis), drawn as DOM rows of label · plot · numbers so each row's numbers sit on it. The numeric column ("HR (95% CI)") is a `VerifiedNumber` (a `Hole` when blanked); that column is the only Martian Mono in a chart. Ratios on a log axis with the null line at 1, differences linear at 0, drawn in `text`; ticks (0.25 · 0.5 · 1 · 2 · 4, or 1-2-5 steps) and their dashed lines in `rule`, labels in Bai Jamjuree with tabular figures. Under the axis, its title (the measure's name) and the two sides in measure terms only: "< 1 · ต่ำกว่าในกลุ่ม<I>" ← → "> 1 · สูงกว่าในกลุ่ม<I>" (or "กลุ่มที่ได้รับการรักษา/สัมผัส"); never "favours", since the result does not say whether lower is better. Primary studies first; each pooled estimate in its own block listing exactly the studies it combined (with its lozenge under them), the rest under "ไม่ได้รวมผล", systematic reviews in their own block last. Markers use the direction glyph shapes. Unverified values are a labelled gap, never estimated. Other charts (ECharts) keep their text in Bai Jamjuree and carry no Martian Mono, since a tooltip has no tape.
- **Scope form ("กำหนดขอบเขตการทบทวน", Plan 17a; full width since Plan 20 Task 12):** the form spans the content width. Three numbered steps, each number in a 28px square with a 1px `ink` border (`font-display` semibold tabular): **1 คำถามหรือวัตถุประสงค์** (textarea, 3–600 chars, a plain hint with PICO glossed, character counter near the limit); **2 รูปแบบการทบทวน** (a native `<select>` ordered Systematic, Meta-analysis, Scoping, Narrative, Thai name + English name, with the chosen type's plain-language description always visible under it via `aria-describedby`); **3 หลักฐานและเกณฑ์คัดเลือก** (study designs as checkbox tiles, ≥44px, of equal height where they form a two-column grid and natural height in a one-column list, `ground` fill and 1px `rule` border, checked = `primary` border on `rail`: the Thai name first, then "term · plain words" smaller in `muted`; one column under 640px and from 1024px, two columns between; "อื่น ๆ — ระบุ" opens a ≤60-char input; ticking qualitative or mixed shows the limited-support note). A tile's accessible name is the Thai name + term; its plain words are the description. From 1024px steps 1–2 sit left and step 3 right of a 1px `rule` divider (1:1 at 1024, 3:2 from 1280), and the question box grows so both columns end level; below 1024px one column. Both landing disclosures (options, "คำที่จะเจอในรายงาน") have a flex summary, so they carry an explicit `aria-hidden` chevron (▸, a quarter turn when open; under reduced motion it never rotates, the glyph switches to ▾); the options summary adds a "แก้ไข" link-styled word while closed. Language, number of papers (the value shown in a bordered box beside the slider) and start year fold into "ตัวเลือกเพิ่มเติม" with a live summary chip, laid out in one aligned row from 1024px; the options sit after step 3 in the DOM, so they run full width under both columns and the keyboard order is unchanged. A full-width submit row ends the form: "ฟรี · ไม่ต้องสมัคร" with the typical duration on the left, a large primary button on the right (full width on a phone). Flat surface, 1px `rule` borders, 2px corners, ≥44px targets.
- **Plain-language gloss (`Gloss`, Plan 20 Task 12):** on the landing and About pages a jargon word is followed by its plain meaning in brackets at first use in a section, always visible: "RCT (การทดลองแบบสุ่มและมีกลุ่มควบคุม)". The words come from one module (`GLOSS` in `src/lib/glossary.ts`), and a term's name is shared with the report's glossary and design labels (`src/lib/term-names.ts`); the short term never wraps (`nw`), the bracket text wraps at Thai word boundaries. No hover or tap needed; the report keeps its tap-to-open `Term`.
- **Capabilities band (landing, Plan 17a):** after the sample report, "รีวิวได้ 4 แบบ รายงานมีอะไรบ้าง": the four review types with their descriptions, the six report views, and the eight search sources as plain bordered chips (no logos). Ruled lists only, no cards with shadows.
- **Literature review matrix (Plan 20):** one row per paper in six compact columns: study (ref, first author and year, and the cited-by count when the review has counts), design, population/sample (n under it), intervention (comparator under it), outcomes (clamped to two lines, "แสดงทั้งหมด (n)" opens the paper in the rail) and direction with risk of bias under it. From 1280px it is a fixed-layout table that fits the reading column with no sideways scroll (sticky first column, inside a bordered scroll region that cues only if a long word ever overflows); below 1280px every paper is a ruled card with the same fields. 15 papers a page. Column labels follow the question's framework (PICO, PCC, PICo for qualitative, SPIDER-like with mixed methods); key findings and limitations stay in the rail and the CSV link. Numbers only via `VerifiedNumber`/`Hole`; scoping hides direction and risk of bias, a themes review hides the direction and keeps a risk-of-bias column.
- **Concept map:** an ECharts tree (question, framework parts, outcomes, grouped study leaves) inside a scrollable region, with "ดูเป็นตาราง" switching to a nested outline whose paper refs open the rail. Edges come only from comparison cells; counts use `font-display tabular-nums`, never the verified-number face.
- **Citation network:** an ECharts graph with a fixed layout (no force simulation): x = publication year (papers with no year in a "ไม่ทราบปี" column at the left, behind a dashed `rule` line), y = lanes by design then ref. Arrows run citing → cited in `muted`, each bent just enough to clear the markers it passes; marker size is the sqrt of the cited-by count, capped. Design groups use neutral fills and a shape each, never direction colours or the chart's direction shapes: trials an `ink` circle, observational and other a `muted` hexagon, reviews a `hatch`-filled rounded square with an `ink` edge. A paper with no reference data is hollow with a dashed edge, captioned "ไม่มีข้อมูล ≠ ไม่อ้างอิง". Each column gets at least 64px, in a scroll region on narrow screens. Clicking a marker opens the paper in the rail; the markers are not focusable, so the "ดูเป็นตาราง" twin (paper buttons, years, cites, cited by, counts with their source, coverage) is the keyboard and screen-reader path. Counts use `font-display tabular-nums`; in the literature matrix the count sits in the study cell as "ถูกอ้างอิง n" (shown only when some paper has a count), tagged "OA"/"EPMC" with the full source name for screen readers.
- **Evidence map (scoping):** count tables of concept and year × study design, counts only, scrollable region with sticky row headers; labelled as counts of studies, not an appraisal.
- **Not-graded strength line:** when `evidence_strength` is null the summary says "ไม่ได้ประเมินความแข็งแรงของหลักฐาน" with the review type, never a meter or "very low".
- **Agent stage (live run):** by default the team view (below); the "ขั้นตอน" view is a flat 2D SVG of the pipeline, driven only by real review events. Node tiles are 44px with 2px corners. Stage text is at least 12px effective (reader refs 11px).
  - **Panel composition (top-down):** one header row (the section label "เวทีเอเจนต์", a quiet step indicator "· ขั้น n จาก N" in regular-weight `font-display` tabular figures, `text-muted`, and the three-way view toggle right-aligned with 44px targets; the row keeps its 44px height whether or not the toggle shows), then the thought block at full width, then the stage, then the legend under a `rule` line. The step counts the steps the lane draws; a step it does not draw keeps the last drawn one.
  - **Wide (≥1024px, the same `lg` breakpoint as the rail/drawer; one 960-wide viewBox per run):** the box height follows only the run's requested paper count (Plan 21, `stageSizeFor` in `src/lib/stage-size.ts`): 960×288 up to 30 papers, one 28-unit reader-pool row taller per 10 above (960×344 at 50). It is known before any paper arrives and is the same in the team, steps and 3D views and from the loading placeholder to the live box; nothing a run turns on changes it, so the page never shifts mid-run or on a view switch. The external-tools node, when shown, sits in the headroom the box always keeps, between the read and synth tiles with its label to the right. The SVG spans the panel, centred, never a left-hanging max width. One row of uniform, evenly spaced tiles with low arcs; every label is one line (never broken inside a Thai word) with the count on a fixed second baseline under every tile. Under the row is one **detail band** with a common top edge, each block in its agent's column: the queries right-aligned to the plan tile (full text, ✓, "+n" beyond four), the eight search engines (PubMed, Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ, OpenAIRE; one row each, the tallest block up to 30 papers, which sets the 288 base height) as a list of status dot + name hanging from the search tile (idle dots in `muted`, lit dots solid `primary`; no fan, no connectors, no per-source counts), screening as one segmented bar (outlined pending, solid `primary` active, solid `ink` done) with "ผ่าน n · ตัดออก n" under it, and the reader pool in 10 columns across the read..finish columns (it reserves max(3, ceil(N / 10)) rows for the requested count N), with the synth caption under it.
  - **Narrow (<1024px, 390 first):** a vertical lane (the external-tools node joins the lane between read and synth, below the pool; the page is a scrolling column, so this one step lengthens it) with single-line labels right of the tiles; every detail is left-aligned in one column right of the spine, under its agent: query rows, the engines in two columns (4 + 4), the bar with its split on the same line, the 10-column pool, and room reserved for the two-line synth caption so nothing shifts.
  - **Legend:** two labelled groups, "ขั้นตอน" (tile states) and "งานวิจัย" (paper slots), used by the steps view (the team view has its own "ขั้นคิด" + papers legend, and the 3D team a tile variant of it); it wraps cleanly at 390.
  - Status vocabulary: active = solid `primary`; working = marching dashed `primary`, the indeterminate state, used only for phases without progress events; done = `ink` + ✓; failed = `err` + ✕; skipped = dashed `rule`; paused = `warn-bg`.
  - Edges are `rule`, ghost (visited) edges `ink`, the live edge `primary`.
  - Packets are 7px round dots, signals of real events only, at most 8 per event and 24 on screen. The shown number is the event's payload count, never the dot count.
  - The reader pool is round slots (full radius allowed), one per paper, with the flag for uncertain papers. A slot means reading or queued, never in flight.
  - A trace log ("บันทึกการทำงาน") lists every event, and one throttled milestone announcer (`role="status"`) speaks for screen readers. The text ledger always stays below the stage.
  - **Optional 3D view:** an opt-in third button ("3D") in the three-way view toggle (ทีมเอเจนต์ / ขั้นตอน / 3D), offered only on wide screens (≥1024px) with WebGL and without `prefers-reduced-motion`; the team view stays the default, and team and steps are the only views on mobile, under reduced motion and without WebGL (a failing canvas falls back to the team view with a note). Since Plan 18 it shows the same five-member team as the team view, driven only by real events: flat geometric robots (a box head with two sphere eyes, a stick antenna with a ball, an 8-sided cylinder body) standing on an arc behind a low round table, outlined like the 2D avatars (speaking or working = solid `primary`, done = `ink` outline + ✓ by the name, idle = a `rule` body outlined in `muted`, failed = `err` + ✕, paused `warn`, stopped `muted`); a working member's antenna sends out a thin fading ring. Four flat phase tiles sit on a shallow arc above each head, left to right คิด / วิเคราะห์ / วางแผน / ลงมือ (active raised and `primary`, passed `ink`, rest `rule` with a `muted` outline so it stays visible in dark), keyed by the team legend's tile variant with the honesty note under it. Names are DOM labels under the feet (the speaker's adds its phase); only the speaker gets a speech bubble in the 2D bubble's style (`primary` border, tail down, 3 lines max, 260px; the end members' bubbles grow inward from a lifted tail on a hairline `rule` leader). The camera eases toward the speaker (a partial pan, plus framing that speaker's bubble), hand-off packets with their wake arc between antennas, and the direction piles sit on the table. The wrapper's `role="img"` label is the team summary. Robots, tiles and the table are drawn unlit so each token shows exactly (a lit fill went darker than the dark theme's background; idle `rule` and done `surface` bodies stay distinct), packets keep simple shading; still no glow, bloom, post-processing, starfield, particles or gradients. The background is the `surface` token, and Thai labels are DOM text (≥12px), never canvas text. The canvas is `aria-hidden`. It takes the run's box, the same as the 2D views (full width, centred, 960/288 up to 30 papers and taller with the requested count, borderless; its loading placeholder is the same box) under the same header row, so toggling never shifts the page; the camera (30° vertical FOV, about 24° above the horizon) fits that box's aspect with an 8% side margin and a 2% vertical one, so the team uses most of the width.
  - **Team view (Plan 18, the default):** the run as five AI agents (planner, researcher, screener, reader, synthesizer), flat and built from existing tokens only (no glow, gradients or shadows). Wide: five bordered cards in a row inside the same run box as the steps and 3D views (the reader's card is wider and holds the reader pool, which reserves the run's rows); narrow: a vertical list.
    - **Avatar:** a flat robot head (34px square, 2px corners, two eye dots, antenna, mouth bar) in the card; working = `primary` outline with a blinking eye and a `stage-ping` ring on the antenna, done = ✓ badge, failed = ✕ badge, paused = warn background, idle = `muted` outline, stopped = dashed. The sender glances toward the receiver while its packet flies.
    - **Phase ring:** four arcs clockwise around the head for คิด / วิเคราะห์ / วางแผน / ลงมือ (active `primary` 4px, passed `ink`, rest `rule`); the phase names are also text (marker shapes: filled square now, check passed, hollow square rest; `aria-current="step"` on the active one), so state is never colour alone.
    - **Speech bubble:** bordered box with a tail, no shadow, no live region; text comes only from received events (the planner quotes the refined question). A changed live line types in over 0.35 to 1.1s, the full text staying in the DOM; reduced motion and replays show it at once. Long lines are clamped to 3 or 4 lines with an "อ่านต่อ" / "ย่อ" toggle (`aria-expanded`, 44px tall on touch) that appears only when text is cut off; on wide it opens over the cards below so the box never grows.
    - **Hand-off packets:** the stage's round packet dots with the two-ghost wake fly between avatar centres (measured at launch) when a hand-off event arrives; history at mount never animates, and none show under reduced motion.
    - **Honesty note:** always under the legend: "ขั้นคิด/วิเคราะห์/วางแผน/ลงมือ มาจากเหตุการณ์จริงของระบบ ไม่ใช่ความคิดภายในของโมเดล". Phases are derived from real events, never the model's inner thoughts.
    - **Text sizes:** 12px minimum for names, tallies, phases and bubbles; reader refs in the pool are at least 11px effective (the pool scales with its card, so the ref font is enlarged in user units to compensate).
    - **Toggle and default:** `role="group"` "มุมมองเวที", buttons ทีมเอเจนต์ / ขั้นตอน / 3D (3D only when offered), `aria-pressed`, min 44×44. Stored in `mra.stageView`; the Plan 12 key `mra.stage3d === "1"` migrates to "3d". Default "team"; a stored "3d" where 3D is not offered shows team.
  - **Thought block:** a `rail` strip (no border, never a nested card) at full width under the stage panel's header row, with the status mark, the label "เอเจนต์กำลังทำ" and the current step heading, plus a body of at most 3 lines on a phone. It is built only from received events (current agent, counts, queries, finished papers, step start time); it never says a paper is "being read now" (all readers start together), only finished papers or "กำลังอ่านหรือรอคิว". A labelled region with no live region; `MilestoneStatus` stays the only announcer.
  - **Live evidence board:** a `surface` block under the stage with per-direction chips of finished reads, in the fixed order positive, negative, null, mixed, unclear (as in the report), each with its glyph and accessible name; counts in Bai Jamjuree tabular figures, no percentages, no ranking, no highlighted largest column. Always titled "ตามที่เอเจนต์อ่าน" (a model judgement) and "ยังไม่ใช่ข้อสรุป". Papers with no (or unknown) direction are counted aside as "ไม่มีข้อมูลทิศทาง", never as unclear; uncertain papers carry the flag; the SR/MA overlap note shows whenever a pooled design is on the board. Below 1024px the chip detail is collapsed behind a "ดูรายฉบับ" toggle (44px target) and only the counts show.
  - **Grouped log:** the trace log groups consecutive rows by step, with a header (status mark, icon, step title, summary from counts, "ใช้เวลา m:ss"). Durations are the difference of two received `elapsed_s` values; a running step shows only its start ("เริ่ม m:ss"), never a ticking counter. Finished groups are collapsed behind "ดู n รายการ", the current one is open.
  - **3D piles:** per-direction piles of flat tokens on the team's table (5 high, later stacks behind), shape-coded with the same glyph shapes and colours as the board, each labelled on one line with a DOM glyph, count and flag count, over the "ทิศทางผลตามที่เอเจนต์อ่าน" caption; new tokens fly in from the reader's antenna. DOM text, `aria-hidden`.
- **Buttons:** primary is solid `primary` (hover brightens, disabled at 45% opacity). Ghost has a 1px `rule` border that turns `text` on hover. Focus-visible is a 2px `primary` outline at 2px offset.
- **Status blocks:** a background tint plus a bold label. Success uses a `success` tint, warning `warning-bg`, error `error-bg`, info `info-bg`. Never a colored left border.

## Report (Plan 20, finished)

The report is a reading document first: answer, evidence, method. Every part below follows the number rules: a number read from a paper is a `VerifiedNumber` (or a `Hole`), a number the system computed is a `ComputedNumber`, and a count of studies or records is a plain display-face figure with tabular numerals. Martian Mono never appears on an unverified number, a chart tick, a PRISMA count or an axis.

- **Number faces.** `VerifiedNumber`: Martian Mono, the 4px tape underline, a button that opens its source sentence in the rail. `Hole`: the hatched not-verified slot. `ComputedNumber`: display face, no tape, the outlined "คำนวณ" tag, an accessible name saying it was computed; never clickable. A sentence of prose never shows an unverified paper number (the engine strips them; the UI adds none).
- **Glyph vocabulary (one set for DOM and charts, `src/lib/glyphs.ts`).** Supports = filled circle (`finding-supports`), opposite/harm = filled diamond ◆ (`finding-harm`, reserved for harm only), no association = flat bar, mixed = half-filled circle, unclear = dashed ring; always with a text label or accessible name. Themes (qualitative, mixed methods) get the bordered word mark "พบ" / "found", never a direction glyph. Uncertain reading = the small flag "สองโมเดลอ่านต่างกัน" / "two readings disagree". Certainty = four circles, the first n with a plus (⊕⊕○○ ต่ำ), in `ink`. The pooled estimate = an outlined lozenge, never ◆. Citation-network design groups use neutral shapes (circle, hexagon, hatched square), never direction colours.
- **Title block.** The refined question as the H1; "คำถามที่คุณพิมพ์" under it; a metadata row (type, search date, studies included with "อ่านไม่สำเร็จอีก n" aside, sources, language, review id in the code face); the `info-bg` status block "อัตโนมัติ · อ่านเฉพาะบทคัดย่อ · ไม่ใช่คำแนะนำทางการแพทย์"; actions (ดาวน์โหลด ▸ menu, คัดลอกลิงก์, พิมพ์, ภาษาไทย/English); "เอเจนต์ตีความคำถามอย่างไร" as a disclosure.
- **Bottom line and key findings.** The direct answer at the reading size, then the certainty line (⊕ marks, level word, "ตัวเลขตรวจผ่าน m/n") and its rationale behind a disclosure, then the direction tally as plain counts. A meta-analysis with no pool says "รวมผลไม่ได้" or "รวมผลไม่สำเร็จ" here. Key findings: 3–5 outcomes, each a statement, "k การศึกษา", the verified or computed number when one exists, and study chips that open the rail.
- **Summary of findings (SLR, meta-analysis).** A real table (caption, scoped headers, explicit `role`s so the stacked cards below 768px stay a table to assistive tech): outcome · studies and participants (k, designs with counts, participants as a computed sum with "รวมจากที่ตรวจได้ m จาก n", "ไม่ได้รายงาน" or "—" for SR/MA only) · effect (pooled computed value, else the verified range of one named measure, else one verified value, else why there is none) · certainty (⊕ and "ระดับของทั้งรีวิว": the grade is the review's, not per outcome), then a full-width "ความหมาย" line clamped to three lines with an "อ่านต่อ" / "ย่อลง" button (`aria-expanded`, 44px on touch) when it is cut; print shows it whole. The GRADE-lite note says it is a language-model judgement, not an expert GRADE assessment.
- **Study selection (PRISMA 2020; PRISMA-ScR wording for scoping).** Ruled boxes in four stages (การระบุ, การคัดกรอง, การคัดเลือก, ที่รวมในการทบทวน) on a left stage band, exclusion boxes to the right (`ground` fill), one connector per stage (a line that fills a tall row, then the arrow); below a 34rem container one column with the exclusions hanging off each stage. Counts come only from `result.stats` and the per-source counts; a count the result does not record reads "ไม่ทราบ". With further reports of a trial, the box counts studies, and "ในจำนวนนี้ เป็นรายงานเพิ่มเติม…" sits directly under "รายงานของการศึกษาที่รวม". The same flow is a captioned table behind "ดูแผนภาพนี้เป็นตาราง" (screen only; the boxes print).
- **Study characteristics.** The literature matrix (see Components) and the scoping evidence map (counts only).
- **Risk of bias.** Its own section after Results: the design × risk-of-bias counts, with notes for the papers left out (further reports of a trial, and papers read as a design outside the ticked study types, which are not evidence).
- **Results by outcome.** Findings by study (outcome × study glyph matrix, k, the legend), forest panels, then for a meta-analysis the pooled block (banner, computed estimate, I²/τ²/k/Q line, cautions, the "วิธีคำนวณ" inputs). A themes review shows the "พบใน k การศึกษา" rows instead of directions.
- **Forest panels.** One panel per outcome and measure, DOM rows of label · plot · numbers; the numeric column is the only Martian Mono in a figure. Axis wording is neutral: the measure's name, and "< 1 · ต่ำกว่าในกลุ่ม…" / "> 1 · สูงกว่าในกลุ่ม…" in measure terms, never "favours". Nice ticks (0.25 · 0.5 · 1 · 2 · 4 on a log axis, 1-2-5 steps otherwise), the null line in `text`. Each figure has a "ดูเป็นตาราง" twin.
- **Matrices.** The literature matrix is a fixed-layout table from 1280px (column shares sized so no header word breaks) and ruled cards below; findings by study and the evidence map scroll inside their own region. Thai cell text wraps only between words.
- **Consistency and conflicts, limitations, gaps, discussion, methods.** Agreement and conflict in two columns of blocks (agree on `ground`, conflict on `warning-bg`, a review-discordant conflict on `info-bg` with a border and its own label); limitations and methods are plain lists at the reading size; the discussion says it was written by the model.
- **References.** Vancouver text in the reading face (titles never translated), DOI/PMID/PMCID links, a 44px "คัดลอกการอ้างอิง" button, the study button that opens the rail, further reports under their primary, and the records excluded at screening (counts by reason) behind a disclosure.
- **Downloads and how to cite.** Markdown, CSV, JSON and the offline HTML file, each labelled with its format; a citation of the report with its question, type, date, id and URL.
- **Appendix: verified numbers.** Every verified number with its study, outcome and source sentence (`font-quote`, the matched span marked), and for a meta-analysis the computed numbers apart; collapsed on screen, open in print.
- **Disclosures.** Every disclosure whose summary is a flex row carries the shared `DisclosureChevron` (▸, a quarter turn when open; ▾ under reduced motion; hidden in print), so it reads as something that opens.
- **Print.** A4 with margin boxes (short title, review id, "หน้า X จาก Y"); always the light theme with colours kept (`print-color-adjust: exact`); controls hidden; every disclosure open and every clamp lifted; SoF and literature matrix as whole tables with repeated headers; charts redrawn at 660px as vectors that scale down; a verified number prints with a solid underline and ✓, a hole as "[ไม่ได้ตรวจ]", and a print-only key says so. Checked by reading the PDF text back (no text drawn over text, no empty page inside).
- **Offline file.** One HTML file built from `review.result` alone that asks the network for nothing: Martian Mono embedded (Latin subset, OFL), the other faces fall back to system fonts, a metadata line (review id, type, search and generated dates, language, prompt version), the theme toggle, and the same print stylesheet.
- **Localisation.** All chrome comes from `src/lib/i18n-report.ts`, apart from a few TH/EN pairs kept beside the data helpers that format them (`trial-reports.ts` related-report labels, `prisma-flow.ts` box labels, `citation.ts` type names, `offline-meta.ts` metadata line); a Thai report is all Thai (English only for glossed abbreviations, framework letters, study labels and source names), an English report all English, and `<html lang>` follows the report so the site header and footer switch with it. Untranslated card fields keep their text and carry their own `lang`.
- **Thai line breaking.** Chromium breaks Thai inside words and ignores `word-break: keep-all` for Thai, so `ThaiText` keeps each Intl.Segmenter word whole (`.th-w`, nowrap, `<wbr>` between words) plus the report words the dictionary splits (`THAI_KEEP_WHOLE`: ยาหลอก, อภิมาน, เบาหวาน, หลักฐาน, การศึกษา…, and compounds whose first part is a bound prefix such as ผู้เชี่ยวชาญ, ผู้ใช้, ตีพิมพ์, ตัววัด; breaks after การ/ความ are ordinary Thai and stay; the text between kept words is segmented on its own), and keeps each token that holds a digit whole (`.th-n`: "0.77–0.96", "1,234", "(0.71–0.97)", "COVID-19"; "HR 0.83 (0.71–0.97)" may still break at its spaces, never inside a number). Plain Latin words stay wrappable, so a narrow clamped cell breaks a long word rather than clipping it; a run over 24 characters, such as a URL, stays breakable with its numbers whole. `ThaiNodes` applies it to list prose with mixed content. Short chips never wrap; a design count keeps a no-break space before it.
- **Glossary.** In the report a jargon word is a `Term` (dotted underline, tap to open a short explanation); on the landing and About pages a `Gloss` shows the plain meaning in brackets, always visible.

## Accessibility

- axe (WCAG 2 A/AA) is clean for every review type in Thai and English at 1440 and 390, light and dark (e2e `report-matrix.spec.ts`); no page-level horizontal scroll at 390.
- Every table has a caption and scoped headers; every figure has a table twin; every target is at least 44px on touch; focus-visible is the 2px `primary` ring.
- **ThaiText and screen readers (to check before release).** ThaiText splits Thai into inline nowrap spans with `<wbr>` between them. Chromium and its accessibility tree read these as one run of text, and the Playwright accessible-name checks pass, but no iOS device was available. Before release, check with iOS VoiceOver that a summary-of-findings cell, a PRISMA box note and an H2 are read as words and sentences, not letter by letter or with pauses at each span. An `aria-label` with the unsplit text on each segmented element was considered and rejected: it would hide the inner study and number buttons from the accessibility tree, duplicate every Thai string in the DOM, and drift from the visible text; inline-block word spans were rejected too, because Chromium then inserts spaces into a heading's accessible name.

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
- **The second authored moment:** the agent stage. Packets travel 700ms ease-in-out along curved edges (120ms stagger) when an event arrives; a working phase is a 1.2s marching outline; the reader pulse marks a paper being read. Bursts and replays collapse to the final state. Plan 17b adds motion only, no new decoration: each packet trails two smaller, fading ghosts (a short flat wake); an edge that goes live draws its primary stroke from sender to receiver (600ms); the agent at work sends out a thin stroke-only ring every 1.8s (`stage-ping`); counts under the agents count up to their new value (600ms, display only, the final text is always rendered); reader slots pop into each new state with a spring and ripple in ref order when reading starts. In 3D, packets carry the same two-ghost wake in the muted tone and a working member's antenna sends out a fading ring. All of it is driven by real events and disappears under reduced motion.
- **Reduced motion:** `prefers-reduced-motion` removes every transition, and states appear in their final form. On the stage: no packets, no loops, final states only. JS motion goes through `MotionConfig reducedMotion="user"` plus `useReducedMotion`.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-04 | Initial design system "Theatre Green" | Created by /design-consultation from product context, research on Elicit and Consensus, and three independent proposals. Mine supplied the clinical-instrument direction, Bai Jamjuree with Anuphan, and Okabe-Ito. Codex supplied the provenance-led hero and source sheet. The Claude subagent supplied the theatre green, autoclave tape, Martian Mono rule, Source Serif 4 quotes, glyphs, request slip and showing the gaps. The user approved it after an HTML preview at https://claude.ai/artifact/XUvrWN7gxW3GhzEMrEnNpY |
| 2026-10-04 | Tokens from the approved HTML preview | AI image mockups were unavailable (no OpenAI key), so the HTML preview (Path B) is the source of every token |
| 2026-10-05 | Landing direction C: "อย่าเพิ่งเชื่อเรา แตะที่ตัวเลขดูก่อน" | Chosen from three HTML mockups (https://claude.ai/artifact/JWBF5BDC9c2Hb1uenjivpG). The receipt is a committed snapshot of a real review (MACE rows of the colchicine review) rendered by the same components as the report, so the landing shows rather than claims; a test pins every shown number to its quote |
| 2026-10-05 | Code gets its own face (`--font-code`: ui-monospace stack) | Martian Mono stays exclusive to verified numbers; code samples, ref chips and pipeline counts had borrowed it, which diluted the signal |
| 2026-10-05 | Dark finding colors re-stepped to #3B98D4 / #DB712F / #B05C9E | dataviz validator: the preview's dark set failed the dark lightness band (L 0.48–0.67) and was in the CVD floor band; the new set passes all checks on #1B3029 (light set passes unchanged) |
| 2026-10-09 | Plan 10 (UX clarity): rail/drawer breakpoint stays at 1024px; report is answer-first; agree/conflict moves above the matrix; section nav, glossary term and UncertainFlag added | Readers could not tell where the answer was or what the jargon meant. The nav and glossary are plain, flat and keyboard operable; the warning flag replaces ◆ for "uncertain" so ◆ keeps meaning harm only. (Plan 20 replaced this section order with the answer-first `SECTIONS_BY_TYPE` order; see Layout and Report) |
| 2026-10-09 | Plan 11: the live run's step list + specimen tray are replaced by a real-time 2D agent stage (SVG + motion), text ledger kept | The user approved; adapted from sakshigupta372/AI-Agent-observatory (graph of agents, curved edges with travelling packets, planner task chips, ghost edges, trace panel) to Theatre Green: flat, 2D, no bob or glow, driven only by real events, reduced-motion and mobile first |
| 2026-10-09 | Plan 12: an optional 3D view of the agent stage (wide screens, WebGL, no reduced motion; opt-in toggle, 2D stays default) | The user approved depth and simple shading for this view only (one ambient + one directional light, flat colours); glow, bloom, post-processing and starfields stay out. Adapted from the observatory's 3D node, arc, packet and camera ideas; the scene, status vocabulary and Thai DOM labels are the same as 2D, and three.js loads only in a lazy chunk |
| 2026-10-09 | Plan 13: live-run polish: thought block, live evidence board, grouped log with real durations, 3D direction piles and thought label | The stage showed activity but not what the agent was thinking or finding. Everything added traces to a received event (`extracted` now carries the card's direction and design); direction is always labelled as the agent's reading, the board never ranks or concludes, and no client-side ticking time is shown |
| 2026-10-10 | Plan 14a: review types (narrative, SLR, scoping), literature review matrix, concept map, evidence map, not-graded strength line | Different questions need different reviews, and an honest report must not grade what it did not appraise. New views reuse existing tokens: flat tables and an ECharts tree with outline twins, glyph-shaped finding colours, counts in the display face so the verified-number face keeps meaning "checked against the abstract" |
| 2026-10-10 | Plan 15: agent stage composition: one header row (label, step, 3D toggle), full-width centred stage, single-line labels with fixed count baselines, one detail band aligned to the agent columns, legend in two groups; 3D takes the same box | The user asked for a beautiful, balanced, orderly stage panel. The old stage hung left in its box, fanned the sources over the edges, truncated queries and broke Thai labels mid-word. Structure now comes from alignment and spacing only (flat, existing tokens, no new decoration), behaviour and events unchanged |
| 2026-10-10 | Plan 14b, approved departure: computed pooled estimate, labelled | The user approved computing a pooled estimate for the meta-analysis review type, a departure from "never compute a number shown as if from a paper". It stays honest by form: `ComputedNumber` (display face, no tape, "คำนวณ" tag, computed accessible name), the fixed banner, an outlined lozenge (never the harm ◆), the I²/τ²/k/Q line, every input listed under "วิธีคำนวณ", and cautions for abstract-only inputs, small k, high I² and unknown adjustment |
| 2026-10-10 | Plan 14b: citation network | Citation metadata (who cites whom among the review's own papers, cited-by counts) comes from OpenAlex, with Europe PMC as fallback; it is metadata only and a missing record is "no data", never "cites nothing". The figure is an ECharts graph with a fixed year x design layout and a table twin; nodes use neutral fills and shapes so direction colours and the harm ◆ keep their meaning |
| 2026-10-10 | Plan 17a: scope form + qualitative/mixed-methods (limited) | The user proposed a numbered "กำหนดขอบเขตการทบทวน" form (question → review type → study designs). Adopted in Theatre Green with Meta-analysis added and Umbrella deferred (no backend support yet); the review-type radio rows became a select with a visible description. Qualitative and mixed-methods studies get neutral design labels and never a direction glyph, forest row or pooled input |
| 2026-10-10 | Plan 18: the agent team (2D team view is the default; steps and 3D kept; 3D is a team around a table) | The user asked for the run to read as a team of AI agents. The stage now has three views (ทีมเอเจนต์ / ขั้นตอน / 3D), stored in `mra.stageView` with the Plan 12 `mra.stage3d = "1"` migrated to "3d"; the team view is the default and the 3D pipeline is replaced by five robots around a low table. Robots stay flat (no glow, no emotional faces; state is shown by outline, fill, ✓/✕ and text, never colour alone). Four phases (คิด / วิเคราะห์ / วางแผน / ลงมือ) are labels derived from real events in `src/lib/agent-team.ts`, never the model's inner thoughts, so the honesty note "ขั้นคิด/วิเคราะห์/วางแผน/ลงมือ มาจากเหตุการณ์จริงของระบบ ไม่ใช่ความคิดภายในของโมเดล" renders wherever phases do (team and 3D views); only a working member speaks, with lines built from received events. A 3-line 3D bubble is sized for the narrowest 3D stage (1024px) so it never clips. |
| 2026-10-10 | Plan 17b: agent stage motion (2D + 3D) | The user asked for a "wow" stage and chose motion over decoration: packet wakes, edges that draw in, a working ping ring, count-up numbers, slot pops and a reading ripple; 3D gets packet wakes and a working ping. Still flat (no glow, gradients, bloom or particles), event-driven and off under reduced motion |
| 2026-10-10 | Plan 20 P0 honesty: theme mark, no-pool states, one glyph vocabulary, no Martian Mono in charts | The audit found qualitative studies drawn with direction glyphs, a meta-analysis that pooled nothing reading as normal, chart glyphs (triangle, square) that disagreed with the legend, and Martian Mono on ticks and counts. Themes now get a neutral word mark and "found in k studies"; the no-pool and pool-failed states say which happened; charts draw the legend's own shapes; Martian Mono appears only on taped verified numbers |
| 2026-10-10 | Plan 20: `ComputedNumber` covers every system-computed number, not only meta-analysis pools | The summary-of-findings table adds up verified sample sizes per outcome. That sum is calculated, so it takes the computed face and tag like a pooled value; a sample size the abstracts never reported reads "ไม่ได้รายงาน" in plain text, a row of only SR/MA shows "—" with a note, and the not-verified slot stays for verification failures only |
| 2026-10-10 | Plan 20 Task 5: an edge fade on scroll regions is allowed | A table or nav that scrolls inside its own region fades its trailing edge with a `mask-image` on the content (no colour is painted) while more content sits off to that side, with a "เลื่อนดู →" hint. It is a functional scroll cue, not decoration, so it does not break "no gradients"; the sticky first column's edge never fades and keyboard focus drops the mask |
| 2026-10-10 | Plan 20 Task 5: forest plots are DOM panels with a verified numeric column; axis sides in measure terms, never "favours" | A per-row numbers column must line up with its row and stay a tapeable `VerifiedNumber`; "favours" needs an outcome's polarity (good or bad), which the result does not carry, so the sides only say lower or higher with the intervention |
| 2026-10-11 | Plan 20 Task 6: one interaction for study codes; references are the destination | A `[Pn]` code anywhere in the report stays a button that opens the paper in the source rail (the reading context, with its verified sentences); it does not jump. The rail ends with "ดูในเอกสารอ้างอิง (Pn)", a plain link to `#ref-Pn`, and in each numbered reference the study button opens the rail again. Following the link closes the drawer on a phone and focuses the reference. References are Vancouver text in the reading face with identifier links and a 44px "คัดลอกการอ้างอิง" button; titles are never translated |
| 2026-10-11 | Plan 20 Task 12: home page in plain Thai; scope form at full width | The user asked for the home page to say what the system is, what it does and why it helps in words a non-researcher understands, with every English term or abbreviation glossed in Thai, and for the scope form to span the page. Glosses are always-visible bracket text from one module (no hover); study designs became equal-height tiles; the options row runs under both columns so the keyboard order did not change |
| 2026-10-11 | Plan 20 Task 7: the report speaks one language; Thai never breaks inside a word | All report chrome comes from one string table (`src/lib/i18n-report.ts`), and `<html lang>` follows the language shown, so the site header and footer switch with an English report; untranslated card fields keep their text and carry their own `lang`. Chromium breaks Thai inside words on its own and ignores `word-break: keep-all` for Thai, so `ThaiText` keeps each Intl.Segmenter word whole (plus report words the dictionary splits, such as ยาหลอก and อภิมาน) with a `<wbr>` between words; short chips never wrap. Running prose uses `.reading`: 17px / 1.75 in a Thai report, the 1rem / 1.7 body in English |
| 2026-10-11 | Plan 20 Task 8: the report prints as a report; the offline file asks the network for nothing | Print is light whatever the screen theme (charts redrawn at 660px, no animation), controls are `print:hidden`, every disclosure opens and every clamp lifts, the summary of findings and the literature matrix print as tables (every row, header repeated), and A4 `@page` margin boxes carry the short title, the review id and "page X of Y" (nothing faked where a browser has no margin boxes). Paper cannot show the striped tape or the hatch, so a verified number prints with a solid underline and ✓, a blanked value as "[ไม่ได้ตรวจ]" / "[unverified]", and a print-only key says so; `ComputedNumber` keeps its tag. A verified-numbers appendix (collapsed on screen, open in print) keeps each number's source sentence on paper. The offline file embeds Martian Mono (Latin subset, OFL) so verified numbers keep their face; the other faces fall back to system fonts; its header has a metadata line and the theme toggle |
| 2026-10-11 | Plan 20 Task 9: the finished report is documented here (section "Report"); hardening | DESIGN.md now describes the report as built: section order from `SECTIONS_BY_TYPE`, number faces, glyph vocabulary, SoF, PRISMA, forest panels with neutral axis wording, matrices, references, print, offline, localisation and Thai line breaking. Hardening from the final screenshot pass (and review round 1: digit-only `.th-n`, bound-prefix compounds kept whole, plain Thai PCC labels แนวคิด / บริบท): SoF stacked cards keep explicit table roles and the clamped "ความหมาย" line gets an "อ่านต่อ" button; every flex disclosure shows the shared chevron; Thai number and Latin runs never break inside (`.th-n`); a few more report words are kept whole; the literature matrix intervention column is wider so no header word breaks |
