# Plan 18 — "ทีมเอเจนต์": the live stage as a team of AI agents that think, analyse, plan and act

**Request (2026-10-10):** "การแสดงผลของ 3D และ 2D เปลี่ยนเป็น AI Agents ที่กำลังคิด วิเคราะห์ วางแผน และ action"
**User decisions:**
- The main view is a team of 5 agents. The current pipeline view stays available as "ขั้นตอน", and 3D as "3D".
- Avatars are flat geometric robot heads, with no glow and no emotional faces.

## Global constraints
- **Events only:** everything is driven by real review events through the existing `Scene` (`frontend/src/lib/agent-scene.ts`,
  `reduceScene`). There are no timers that invent progress and no invented text. Speech lines reuse `agent-thought.ts` data
  and its honesty rules: never claim that a specific paper is being read right now, and a direction is always "ตามที่เอเจนต์อ่าน".
- **Phases are labels:** คิด / วิเคราะห์ / วางแผน / ลงมือ name real pipeline steps. A visible note says:
  "ขั้นคิด/วิเคราะห์/วางแผน/ลงมือ มาจากเหตุการณ์จริงของระบบ ไม่ใช่ความคิดภายในของโมเดล".
- **Flat Theatre Green:** no glow, gradients, bloom or particles; finding colours always come with glyph shapes; ◆ = harm only.
  Motion follows Plan 17b (wakes, ping, CountUp, pops) and disappears under reduced motion.
- **Accessibility:** the stage keeps `role="img"` and `sceneSummary`. Each agent card has an accessible name. The view toggle is a
  group of buttons with `aria-pressed`. Targets are ≥ 44px, and axe passes in light and dark at 1440 and 390. The page never
  scrolls horizontally at 390.
- **Box constancy:** switching team / steps / 3D never changes the stage box height on wide screens. Thai labels are ≥ 12px.
- **Code:** no new dependencies. Pure logic goes in `src/lib/*` with tests. Edit/Write only (LF). Stage only the files you touch. Leave
  `infra/searxng/limiter.toml.new` alone. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Gates** (frontend/): `npm test && npm run lint && npm run typecheck && npm run build:standalone && npm run e2e`.

## Team and phase mapping
| Member | id | Steps (AgentId) | Phase rules (from scene.agents / counts) |
|---|---|---|---|
| ผู้วางแผน | planner | guard, refine, plan | guard active → คิด; refine active → วิเคราะห์; plan active/working → วางแผน; search started → ลงมือ passed, done |
| นักค้นคว้า | researcher | search, enrich | search or enrich active/working → ลงมือ (it has already passed คิด and วางแผน: the queries it received) |
| ผู้คัดกรอง | screener | screen | screen active with 0 batches → คิด; batches > 0 → วิเคราะห์; screen done → วางแผน and ลงมือ passed ("เลือก n จาก m") |
| ผู้อ่าน | reader | read, external | read active and no paper finished → วิเคราะห์; ≥ 1 finished → ลงมือ (ตรวจตัวเลข), with วิเคราะห์ passed |
| ผู้สังเคราะห์ | synthesizer | synth, localize, finish | synth active → คิด; `counts.pools != null` → วิเคราะห์; localize/finish active → ลงมือ; done after finish |

- **Status per member:** idle, working (any of its steps active/working), done (all of its visible steps are done or
  skipped), failed (any step failed), or paused.
- **Speech line:** member-specific, from real data only, for example:
  - the refined question;
  - "ค้น 8 ฐานข้อมูลด้วย 3 คำค้น · พบ 87";
  - "ให้คะแนนชุดที่ 3 จาก 6";
  - "อ่านเสร็จ 12 จาก 30 · P12 ตรงข้าม/อันตราย ตามที่เอเจนต์อ่าน";
  - "เทียบผลจาก 30 ฉบับ".
- **Hand-offs:** a pulse on an edge between steps of two different members becomes a packet between their avatars.

## Task 1: Pure team model
**Files:** new `frontend/src/lib/agent-team.ts` and `agent-team.test.ts`.
- `TEAM`: the 5 members `{id, name, role, steps: AgentId[]}`.
- `PHASES = ["think", "analyse", "plan", "act"]` with Thai labels คิด / วิเคราะห์ / วางแผน / ลงมือ.
- `teamOf(scene)` returns `{members: [{id, status, phase, passed: Phase[], line, tally}], speaking}`.
  - It implements the mapping table.
  - The speech `line` comes from the scene only. Reuse `thoughtFor` / `STEP_TITLE` / `latestFinished` / `paperLines`
    from `agent-thought.ts`. For a member that is not current, the line is its last real result (e.g. "พบ 87 รายการ"),
    or its role while idle.
  - Scoping (`scene.directionless`) never mentions a direction.
- `handoffs(scene)` maps pulses whose edge crosses two members to member→member pairs.
- `teamSummary(scene)` gives a one-sentence accessible description.
- **Tests:**
  - every event's phase, including failure, cancel, skipped localize, external, a `pooled` meta run, a scoping run and replay;
  - the honesty rules for lines;
  - hand-off mapping.

## Task 2: 2D team view + view toggle
**Files:** new `frontend/src/components/review/team/{team-stage,agent-avatar,phase-ring,speech-bubble}.tsx` (+ tests).
Also `stage-view.tsx` (a three-way toggle replaces the 3D toggle) and `stage-placeholder.tsx`.
- **Wide layout:** 5 cards in a row inside the same box as the pipeline. The Reader card holds the existing reader pool,
  scaled. Hand-off packets travel along simple arcs between avatars (reuse the `PacketLayer` approach, or a small team
  version) with wakes.
- **Narrow (390):** a vertical list, with the box height following the narrow stage rules.
- **Avatar:** an SVG square head with 2px corners, two eye dots, an antenna and a mouth line; the strokes use tokens.
  - Eyes blink about every 4–6 s while working (CSS; off under reduced motion) and shift toward the receiver during a
    hand-off.
  - The antenna pings while working (`stage-ping`).
  - Done: a ✓ badge. Failed: ✕.
- **Phase ring:** four labelled segments: active = primary fill, passed = ink, rest = rule. The labels are text, not colour alone.
- **Speech bubble:** a bordered box with a tail, no shadow, `aria-live` off (no new live regions). It types its text in
  under motion, but the final text is always in the DOM.
- **Toggle:**
  - a button group "ทีมเอเจนต์ · ขั้นตอน · 3D" (3D shown only where it is offered today);
  - `aria-pressed`;
  - persisted with the same storage pattern as the 3D preference (new key `mra.stageView`; migrate `mra.stage3d=1` → "3d");
  - the box height stays constant on wide screens.
- **Note:** under the stage, "ขั้นคิด/วิเคราะห์/วางแผน/ลงมือ มาจากเหตุการณ์จริงของระบบ ไม่ใช่ความคิดภายในของโมเดล".

## Task 3: 3D team
**Files:** `frontend/src/components/review/stage3d/*`, a new team scene (e.g. `team-3d.tsx`), and `lib/agent-layout-3d.ts`
(team positions).
- The 5 members stand around a low round table: a box head with sphere eyes and a stick antenna on a cylinder body.
- Phase tiles: four small flat tiles in an arc above each head. The active tile is raised and uses primary; passed tiles
  use ink.
- Speech bubbles are DOM labels (`Html`, Thai ≥ 12px).
- The camera eases toward the speaking member (reuse `CameraRig` with team goals).
- Packets with wakes arc between heads (reuse `Packets3D` with team arcs). The evidence piles move onto the table.
- Tokens, lights and no-glow rules are as today.

## Task 4: e2e, docs, verification
- **e2e:**
  - the team view on a streamed run: phases change, speech lines show real data;
  - the toggle keeps the box height and persists;
  - reduced motion; 390px with no horizontal scroll; axe in light and dark at 1440 and 390;
  - the 3D team renders (SwiftShader).
- **Docs:** DESIGN.md (agent team section, avatar rules, Decisions Log 2026-10-10 Plan 18), CLAUDE.md (one line).
- **Screenshots:** 4 run moments × 1440/390 × light/dark, plus a 3D frame sheet, checked by eye.
