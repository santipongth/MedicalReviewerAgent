# Plan 31: Cleanup Round 2 — Design

**สรุป (ภาษาไทย).** แผนนี้เก็บงานเล็กที่พักไว้จากแผน 22a–30 และ 23e ให้จบ ตามที่เจ้าของสั่งเมื่อ 2026-10-15 (กลุ่ม 3 ทั้งหมด
ยกเว้นเทสต์ที่ขาด 3 ชุดและการวัดต้นทุนจริงของถามเร็ว, รวมงานเล็กที่ไม่ได้อยู่ในรายการ ยกเว้นข้อที่ต้องตัดสินใจเรื่องดีไซน์, และลบไฟล์
`limiter.toml.new`) งานหลัก: ธงแดงจับคำพิมพ์ผิด ประโยคที่เชื่อมด้วย "and" และไม่ปฏิเสธคำถามปฐมพยาบาลทั่วไปแบบ "someone"
โดยวัดกับชุดทดสอบสังเคราะห์ (ไม่มีค่าใช้จ่าย); citation ที่ขึ้นต้นประโยคถัดไปไม่ถูกย้ายผิดเมื่อข้อความใช้ citation ในจุด; ตัวกรองคำแนะนำของถามเร็ว
แม่นขึ้น; รีวิวที่รันต่อจากจุดพักไม่ถูกนำกลับมาใช้; error สาธารณะไม่เปิดเผย host ของ provider; ไม่ตาม redirect ของ provider
ที่ไม่ใช่ OpenRouter; session แอดมินหมดอายุเมื่อเปลี่ยนรหัสผ่าน; ปุ่มทดสอบบอกค่าใช้จ่ายตามจริง; ใส่คีย์ให้ provider แบบ local/legacy ได้;
ลบ provider ที่บันทึกแล้วได้; error ราคาแสดงที่แถวของ role; error 422 ของ harness แสดงข้างช่อง; ModelsView ใช้ helper ร่วม;
แยกทิศทางข้อความ (bidi) ในรายงาน; ตรวจคำเตือนขนาดยาครบทุกส่วน; ชื่อแท็บไม่กระพริบ; และงาน eval/ops เล็กน้อย
เปลี่ยนข้อความที่เก็บไว้ (citation และคำแนะนำ) จึงขยับ prompt_version เป็น 2026-10-15.1 ไม่มีค่าใช้จ่าย LLM

---

## 1. Scope

The owner (2026-10-15) asked for the parked small work: group 3 of the pending list (the Plan 30 deferrals and the Plan
23e minors), **except** the three missing test sets of 23e (the harness/eval_main ring, concurrent reload triggers,
MGET raising) and measuring the quick answer's real cost (a paid batch). The owner also took the other parked items
found while surveying, **except** those that need a design decision. Plus: remove `infra/searxng/limiter.toml.new`. Then
merge and rebuild docker.

**Out of scope (owner's choice or design decision):** the `bg-rail` notice tint (DESIGN.md:183 sanctions it), turning
the providers list into a table at 1440 px (spec 23e §8), hiding `result.pipeline_version`, the three 23e test sets, a
paid measurement of anything, clause-level misattribution inside one sentence (needs a model), Plans 28/29, ops
(domain, HTTPS, Turnstile, backups).

Every item was checked against master `7ea9d51` on 2026-10-15 (three surveys; findings quoted in §3).

## 2. Decisions (Claude, on the owner's standing instruction)

| # | Item | Decision | Why |
|---|---|---|---|
| D1 | Red-flag typos | `red_flag` matches on `fold_typos(normalize(topic))`: a fixed table of whole-word misspellings of red-flag words only (cnt/cannt → cant; breath/breth/brethe after cant/cannot/unable to/struggling to → breathe; breating/brething → breathing; chest pian/pane, chset pain → chest pain; unconcious/unconsious/unconscous → unconscious; siezure/seizur/sezure/seisure → seizure; chocking/chokeing → choking; bleding/bledding/bleedin → bleeding; overdoze → overdose, overdozed → overdosed; poisend/posioned → poisoned; colapsed/collasped → collapsed; heart atack/attak, hart attack → heart attack; alot → a lot), runs of three or more identical letters collapsed to one (helppp, หายใจไม่ออกกก, อยากตายยย), and Thai เจบหน้าอก → เจ็บหน้าอก. `pls`/`plz` join `CUES_EN`. `normalize()` itself is unchanged. | Each entry is a misspelling with no research reading, so precision cannot fall; the fold runs before every list, so the always-phrases gain too. |
| D2 | And-framed phrasing | On the no-anchor English path an `and` that joins a red flag (a flag ending at most one word before it, or starting at most one word after it: "collapsed and not breathing", "chest pain and sweating", "fell and is bleeding heavily", "face drooping and cant talk") is not a framer. Every other framer still blocks. No new anchors. | The flag itself carries the emergency; titles such as "chest pain and anxiety" still need a cue and have none. |
| D3 | "someone" traps | `someone`/`somebody` leaves `PERSONAL_EN`. It is an anchor only as the opening subject of the topic or right after a plea, `_SOMEONE_ANCHOR = ^(?:(?:please\|pls\|plz) )?(?:help )?(?:someone\|somebody)(?! with\| who)`, and then only when no **strong** framer (`STRONG_FRAMERS_EN`: the research-noun and question framers of `FRAMERS_EN` — effect(s), risk(s), therapy, prevention, policy, death(s), mortality, cause(s), factor(s), guidelines, symptoms, signs, sign, syndrome, recovery, care, epidemiology, overview, history, definition, rate(s), versus, vs, compared, why, how, what is, first aid, when to) stands outside the flags; prepositions such as `in`/`after` do not block it ("someone collapsed in the street" stays). On the no-anchor path `if/when/whenever someone\|somebody\|a person` is a framer unless an urgency word (`help`, `now`, `please`, `pls`, `plz`, `urgent`, `asap`, `quick`, `quickly`, `hurry`) is present. `to help` is neither a cue nor an urgency word ("legal duty to help…", "how to help…"). Thai: a kin word at the start followed by `และ` is a population ("พ่อและแม่…", "แม่และเด็ก…"), not an anchor. | Measured against the blind set A before any change: "someone" anywhere was an anchor, so 9 research items and 4 first-aid questions were refused on master ("how families cope after someone had a stroke", "how to put someone unconscious in the recovery position", "somebody vomiting blood after heavy drinking: causes"). An emergency names the person first ("someone collapsed …") or pleads ("help someone …"); a question about someone frames them. The guard stays the backstop for "there is someone collapsed outside". |
| D4 | The measured sets | **Set A** (`tests/unit/safety_sets_31.py`) was written blind by a separate agent before the rule changed; the controller measured master against it and revised D3 from what it showed, so A is now a development set. **Set B** (`tests/unit/safety_sets_31b.py`) is written blind by a fresh agent after Task 1's commit and before its review, from the same brief and never edited to fit; it is the final measure. Bars on both: every research item and every pre-existing precision list at 0 wrongly refused; traps at most 1 wrongly refused per set; emergency recall recorded in a comment (no bar). A failure on B may be fixed only by a rule a reviewer accepts as general (not a word list matched to B's items). | Free (no LLM); a blind set keeps the precision claim honest; the owner declined paid evals, not code-only checks. |
| D5 | Uppercase-continuation residual | `lead_belongs_to_previous` keeps an uppercase-led group with its own sentence when that sentence opens with a definite reference to a study, `_STUDY_SUBJECT`: `The/This/That/These/Those/Its/Their` + at most two words + `trial(s)`, `study/studies`, `cohort(s)`, `analysis/analyses`, `meta-analysis/analyses`, `review(s)`, `RCT(s)`, `authors`, `investigators`, `researchers`, `registry/registries`, `survey`; or a capitalised surname (optionally "X and Y") + `et al.`. Otherwise the Plan 30 rule stands. Shared by the full review and quick (`lead_belongs_to_previous` is already shared). | "… 0.55. [P2] The trial found less harm." names the cited study as its subject. A style cue (does the text cite inside its stops?) was rejected: the Plan 30 pin "… (HR 0.74). [P1] Empagliflozin lowered it too [P2]." mixes both styles. The three lifting pins ("Another trial found less.", "Empagliflozin lowered it too", "Cohorts agree.") open with no definite study reference, so they hold. Bare surnames and trial acronyms ("Smith reported", "DAPA-HF showed") stay the documented residual. |
| D6 | Advice filter edges | `_is_advice(sentence)` replaces the bare `_ADVICE.search`: (a) adds `check`, `contact`, `call`, `visit`, `tell` to `_ACT` and `get (tested\|checked\|screened\|vaccinated\|help\|medical\|advice)`; (b) adds `it is (advisable\|recommended\|best\|wise\|prudent) (to\|that)`, `it is (important\|essential) to <act>`, `(are\|is) (advised\|encouraged\|urged) to`, `(may\|might) (want\|wish) to`, `one should`, `we (recommend\|advise) (that )?(patients\|people\|you\|readers\|anyone\|avoiding\|stopping\|taking\|using\|starting)`; (c) the subject rule allows a short relative clause (`those taking warfarin should avoid`, `women who are pregnant should not take`) for person subjects (patients, people, individuals, persons, users, anyone, everyone, adults, parents, women, men, those, readers, one) unless a research noun (trial, study, studies, research, researchers, investigators, authors, review, data) comes before the modal; (d) `you` counts only as `you (should\|must\|need\|ought\|may want\|might want\|can\|could\|have to\|will need)`, `if you`, `yourself`, `your <carer>`; (e) a sentence-initial imperative about reading the evidence is not advice: the sentence mentions `interpret`, `over-interpret`, `reading`, a table, figure or appendix, or "the full review/report". | Covers the probed misses; the false positives are research wording; fail-safe stays (a dropped sentence is replaced by the next clean one). |
| D7 | A→B→A resume | A resumed run whose version is known always gets the never-reused key (`…+resumed:<id>`), whatever its version. | No record of an interrupted run's version exists (only the checkpoint's sources); sources toggles can return to an earlier generation. Cost: reuse lost after a retried job, which is rare. |
| D8 | Missing-key reason in public errors | `MissingKeyLLM` raises `LLMNotConfigured(LLMError)`. The runner stores the fixed message `NOT_CONFIGURED_ERROR = "LLMNotConfigured: the service's model provider is not set up; an administrator must fix the model settings"` and logs the detail (`review_not_configured`, with the reason). No reason text reaches `error`, an event, `result` or MCP. | The reasons name admin-configured hosts and models; admins still see them in the log and the worker heartbeat (`keys_error`). |
| D9 | Redirects | `OpenAICompatibleStructuredLLM` takes `follow_redirects` (default True); `build_role_llm` passes False for every provider that is not OpenRouter, through `http_async_client=openai.DefaultAsyncHttpxClient(follow_redirects=False)`. A 3xx becomes `openai.APIStatusError` → `LLMError` (redacted as today). | A 307 would re-send the prompt to a host `_is_open_provider_url` never checked. OpenRouter keeps langchain's shared client. |
| D10 | Harness and a local server without a price | `unpriced_roles` skips an `openai_compatible` role whose origin `is_local_origin`. A legacy name on a LAN or public host is still refused without a price. | Matches reviews for local servers (price 0 is right); the harness runs under a strict USD cap, so a remote host must stay priced. |
| D11 | Probe cost | The probe answers `cost_usd: null` and `priced: false` when the role cannot be priced (`role_unpriced(role, catalog)`, the predicate shared with `unpriced_roles`); otherwise `priced: true` and the number. The UI shows "ไม่ทราบค่าใช้จ่าย (ยังไม่ได้ใส่ราคา)" for null. The provider tab's note becomes "ทดสอบเรียกโมเดลจริง 1 ครั้ง (ตอบไม่เกิน 512 token) จึงอาจมีค่าใช้จ่ายเล็กน้อย". | `PROBE_BUDGET_USD` is a gate, not a ceiling (docs/api.md already says so); "$0.0000" for an unpriced call looked free. |
| D12 | Keys for local and legacy providers | `keys_state` adds `key_allowed` per provider: its origin is `https` or local (`is_local_origin`). The PUT refuses a key for any other origin with 422 `a key is sent only over https or to a server on this machine`. The tab shows the key button whenever `writable && key_allowed`; for a `keyless` provider it reads "ใส่คีย์ (ไม่บังคับ)" / "เปลี่ยนคีย์". Resolution is unchanged (`resolve_key` already prefers a console key bound to the origin). | The backend already resolves console keys for these providers; only the UI hid them. A key never crosses a network in clear text. |
| D13 | Remove a saved provider | The draft-only "เอา {name} ออกจากร่าง" action also shows on saved providers that are not legacy and not in use; it edits the draft (`removeProvider`), and saving a version makes the stored key an orphan, which the existing orphan row can delete. | Reuses the draft model; no new endpoint. |
| D14 | Price errors on the role row | `ValidateReport` gains `role_errors: [{preset, role, kind: "price"}]` from `price_errors`; a refused save's 422 carries the same list. The presets table shows the existing Thai hint "ต้องใส่ราคา input และ output (USD ต่อ 1M token)" on each listed row; the joined alert stays. | Structured fields instead of parsing English strings. |
| D15 | Harness start 422 | Backend: the start refusals carry `errors: [{field, message}]` (`strata` for unknown strata, `max_usd` for both cap rules, `compare_run`, `null` for "nothing to run"). Frontend: `fieldErrorsOf` also reads a FastAPI `detail[]` list: `loc[0] === "body"` → `field = loc.slice(1).join(".")`, `"<extra>"` or another location → `null`. The harness start shows them beside its fields; the vitest mock uses the real shapes. | Every admin 422 then lands on its field; settings, glossary and sources already send `errors`. |
| D16 | Sessions and `passwd` | A session stores `pw`: the first 16 hex chars of sha256 of the password hash it was created under. `admin_from_cookie` ends a session whose `pw` differs from the current hash's (or is missing: sessions from before this plan end once). | Closes the window between `passwd`'s commit and `end_all`; a sign-in rehash creates the session with the new hash. |
| D17 | ModelsView / ModelsHistory | `VersionHistory` is generalised over an adapter (`VersionSource`: list, restore, reset, item id, meta line, change lines, labels, extra per-row actions); the settings/glossary/sources pages pass `runtimeSource(kind)`, models passes `modelsSource` (YAML download link, preset meta, fixed reset label and hint). `useVersionedPage` gains what ModelsView needs: an `error` passthrough, extra save blockers, draft extras (`refused`), a custom discard hook and a `DraftStatus` hint; ModelsView uses it. Every existing vitest and e2e test keeps its name and passes unchanged, except tests that assert the old duplicated internals. The models restore button gets the accessible name `ย้อนกลับไปเวอร์ชัน {id}`. | A refactor: behaviour is pinned by the existing suites. |
| D18 | Bidi isolation | Paper- or user-supplied inline text renders inside `<bdi>`: reference parts (authors, title, journal), bylines (`surname year` in the lit matrix, comparison header, citation network list), the source rail's title, journal and population, the how-to-cite question and the title block's typed question. ECharts labels are left alone (canvas/SVG text). | Harmless for Thai and English; keeps numbers on the right side of right-to-left author names or titles. |
| D19 | Dosing notice scope | `needsDosingNotice` also scans `consensus[]`/`conflicts[]` (`statement`, `explanation`, `likely_reasons[]`), `evidence_rationale` and `research_gaps[]`, in both languages. | Every model-written report text is scanned. |
| D20 | Loading flicker | The tab-title effect does nothing while `phase === "loading"`. | The server metadata already set the right title. |
| D21 | Ghost-worker prune race | `loaded_workers` deletes a stale field only if it is unchanged: WATCH the hash, HMGET the stale fields, HDEL in MULTI when equal; a `WatchError` skips the prune. | A heartbeat landing between read and delete is no longer erased. |
| D22 | Eval writers | `save_manifest` and `write_json_atomic` remove their `.tmp` when the write itself fails, not only when the replace does. | Plan 30 m4. |
| D23 | Eval minors | (1) `_mentions` matches an alias's simple plural or singular (`s`/`es`, both ways) and "sensitivity" never inside "sensitivity analysis/analyses"; (2) `select` excludes a review whose search date is not a real calendar date or lies in the future; (3) the results header takes the first non-empty `models`; (4) `drop_target(..., title="")` also drops a candidate with no DOI and no PMID whose `normalize_title` equals the target's; freeze passes `entry.title`, replay passes it through `batch → replay → eval_state`. | Metric semantics change for glossary consistency from this plan on; the protocol notes it (paid runs are declined, so no baseline is rerun). |
| D24 | `limiter.toml.new` | The controller deletes the untracked file in the main checkout; `.gitignore` gets `infra/searxng/*.new` (replacing the `settings.yml.new` line). | The SearXNG entrypoint writes `<file>.new` on every start when the template is newer, so ignoring the pattern is the lasting fix. |
| D25 | `prompt_version` | Bumped to `2026-10-15.1` (docs/api.md header, the `SYSTEM_HASHES` comment, CLAUDE.md). | D5 and D6 change stored summaries and quick answers; Plan 30's precedent. |

## 3. Verification notes (against `7ea9d51`)

- **Red flags.** `red_flag` (`app/services/safety.py:240-260`) matches whole phrases on `normalize()`. Typos fall
  through; `and` is in `FRAMERS_EN`, so "mom collapsed and not breathing" returns None; "someone" is an anchor
  (`PERSONAL_EN`), so "first aid for someone having a seizure" is refused. Misses and traps are recorded only in
  comments (`test_safety_precision.py:90-91, 120-122, 132-133`). `FRAMERS_EN` lists "after" and "among" twice; the
  uniqueness test does not cover `FRAMERS_EN`, `CUES_EN`, `KINSHIP_TH`, `NONPERSONAL_TH`, `FRAMERS_TH`.
- **Prose.** `lead_belongs_to_previous` (`prose.py:368-374`) lifts any uppercase rest after an uncited sentence:
  "Risk was lower (HR 0.55). [P2] The trial found less harm." → `["Risk was lower (HR 0.55) [P2].", "The trial found
  less harm."]` on both the full-review and quick paths.
- **Advice.** `_ADVICE` (`quick.py:112-118`) misses "Patients may want to discuss…", "It is advisable to consult…",
  "Those taking warfarin should avoid it.", "Check with a pharmacist."; drops "See Table 2 for details.", "Do not
  over-interpret these results.", "Trials did not assess what you would experience.".
- **Resume.** `finished_cache_key` (`pipeline_version.py:24-37`) keeps the admission key when the resumed run's version
  equals it; the interrupted run's version is recorded nowhere (`started` carries only `resume`).
- **Missing key.** `MissingKeyLLM.ainvoke` raises `LLMError(reason)`; `ReviewRunner.run` stores
  `f"{type(exc).__name__}: {exc}"` in `error`, served by REST, SSE, MCP and the web error page.
- **Redirects.** `ChatOpenAI` gets no HTTP client; openai's default follows redirects.
- **Harness price.** `unpriced_roles` (`llm_validate.py:49-58`) counts every unpriced `openai_compatible` role,
  local ones included.
- **Probe.** An unpriced call reports `cost_usd` 0; the tab says "ทดสอบใช้เงินจริงไม่เกิน $0.05".
- **Keys.** `is_keyless` hides the key button for the legacy name and local origins; the PUT and `resolve_key` would
  accept such a key already. Saved providers have no remove action outside the YAML tab.
- **Role row.** Price errors come back as strings in `ValidateReport.errors` and show in one joined alert.
- **Harness 422.** The start route's refusals send `{"detail": "<string>"}`; schema failures send `detail[]`; neither
  sets `errors`, so the field mapping in `harness-view.tsx` never runs (its test mocks a shape never sent).
- **Sessions.** `AdminSessions.create` stores `user_id`, `username`, `created_at`; `admin_from_cookie` re-checks only
  `disabled_at`.
- **ModelsView.** Duplicates `useVersionedPage`/`DraftStatus`/`VersionHistory` almost line for line; differences listed
  in D17. The models restore button has no accessible name of its own.
- **Bidi.** No `<bdi>`, `dir=` or `unicode-bidi` anywhere in `frontend/src`.
- **Dosing.** `needsDosingNotice` scans `summary`, `answer`, `executive_summary`, `key_findings[].statement` only.
- **Flicker.** `review-screen.tsx:36-39` sets the fallback title while loading a done review, then the topic.
- **Prune race.** `loaded_workers` reads with HGETALL, then HDELs stale fields unconditionally.
- **Eval.** `_replace` cleans up only on a failed `os.replace`; `_mentions` uses `(?![A-Za-z])` (no plurals);
  `select` checks the date's shape only; `results` takes `models` from `recs[0]`; `drop_target` has no title rule.
- **SearXNG.** The fork's entrypoint copies the template to `limiter.toml.new` on start when it is newer.

## 4. Tasks

1. Red flags: typos, and-joined flags, "someone" traps; the blind held-out set (written first, by another agent).
2. Prose: a group after a stop in an inside-citing text stays with its sentence; the advice filter's edges.
3. Cache and ops: a resumed run is never reused; the prune race; eval writers and the four eval minors.
4. LLM providers (backend): the not-configured error; no redirects off OpenRouter; the harness and local servers;
   the probe's cost; `role_errors`; `key_allowed` and the PUT rule.
5. Admin (backend): sessions end with a password change; the harness start's field errors.
6. Admin console: the providers tab (probe note and cost, key button, remove a saved provider), price errors on the
   role row, every admin 422 on its field.
7. Admin console refactor: ModelsHistory on `VersionHistory`, ModelsView on `useVersionedPage`.
8. Report: bidi isolation, the dosing scan, the tab title while loading.
9. Docs, `prompt_version`, `.gitignore`, final checks.

## 5. Risks

- **Red-flag precision.** Pinned by every existing precision list plus the blind set at 0; a fold or joiner rule that
  refuses one research item is reverted rather than patched around.
- **The study-subject cue** could keep a group with the next sentence when the writer meant it for the previous one
  ("… 0.55. [P1] The trial was small."); both readings are fail-safe for numbers (an uncited sentence is checked
  against every paper, the quick path drops it).
- **The advice filter** may drop a legitimate limits sentence; fail-safe as before, with research wording pinned.
- **The ModelsView refactor** is the largest change; the existing 13 models vitest files and `admin-models.spec.ts`
  are the bar, and the reviewer compares behaviour, not structure.
- **`prompt_version` bump** starts a new cache generation (one-off reuse loss).
