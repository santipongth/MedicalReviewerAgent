# Plan 30: Cleanup After Review — Design

**สรุป (ภาษาไทย).** แผนนี้เก็บงานค้างจากการรีวิวของแผน 22a ถึง 27 ให้จบก่อนขึ้นระบบจริง งานหลักคือผูกแคชผลรีวิวกับการตั้งค่าที่ worker
ใช้งานจริง: ถ้าผู้ดูแลบันทึกโมเดล คำศัพท์ หรือแหล่งค้นใหม่ระหว่างที่รีวิวรอคิว ผลจะถูกเก็บด้วยคีย์ของรุ่นที่รันจริง (และรีวิวที่รันต่อจากจุดพักข้ามการบันทึกจะไม่ถูกนำกลับมาใช้)
ส่วนที่เหลือเป็นงานเล็กที่ตรวจแล้วว่ายังเป็นปัญหาอยู่ ได้แก่ ไม่ส่งคำถามของผู้ที่ถูกปฏิเสธแบบ personal_medical กลับไปทาง API, MCP, Markdown
และ event stream; การปฏิเสธของโมเดล escalation นับเป็น personal_medical; ธงแดงเพิ่ม 2 แบบ (กลืนเหรียญ, กินยาเบื่อหนู);
ตัวเลขที่อ้างอิงหลังจุดถูกตรวจกับงานที่อ้างจริง; ประโยคข้อจำกัดของคำตอบเร็วไม่ให้คำแนะนำตัวบุคคล; จำกัดจำนวนการรอของ MCP quick_answer
ต่อผู้ใช้; ลบ worker ผีออกจากหน้าแอดมิน; แก้เทสต์ที่ไม่เสถียร; และงานหน้าเว็บเล็กน้อย ไม่มีการเปลี่ยน prompt จึงไม่เปลี่ยน prompt_version
และไม่มีค่าใช้จ่าย LLM ในแผนนี้

---

## 1. Scope

The owner asked for the cleanup work from each plan's review, including binding the review cache to the configuration the
worker actually used, scoped to ship: small, test-pinned changes, no prompt change, no new dependency, no spend. Every
candidate item was first checked against master `eae78b5`; items already fixed are dropped (section 4), items that need
a measured set or a larger refactor are deferred (section 5).

## 2. Decisions (standing in for the brainstorming dialogue)

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Where does the cache-key fix live: API, worker, or graph (`finalize`)? | The worker. One function `pipeline_version()` builds the version string for both the API (admission) and the worker (`run_version(ctx)`, read in the same synchronous step that takes `ctx["graph"]`). | The worker's ctx holds exactly the labels the API reads (LLM config id, glossary label, sources); the graph deps hold a different LLM label (`db:<id>`) and the runtime settings, not env's. One function keeps the strings byte-identical. |
| D2 | Re-key, null the key, or keep it? | Re-key on `done` when the version that ran gives a different key; a resumed run whose version differs gets a key no request computes (never reused); same key or unknown version: unchanged. `result.pipeline_version` records what ran. | Re-keying keeps reuse working for the generation that actually ran. `cache_key` is NOT NULL and the unique index covers only active rows, so the write in the same `UPDATE` that sets `done` cannot conflict. A resume after a save may mix two configurations; never reusing it is the safe choice and costs reuse only in that rare case. |
| D3 | A personal refusal's topic: null, empty string, or a placeholder? | `null` in REST (`ReviewSummary.topic: str | None`) and the MCP resource; the Markdown title drops it; the `queued` event no longer carries the topic and a replay strips it from stored events. The web client reads `null` as `""`. | `null` says "withheld" without inventing text; the web pages never show a personal refusal's topic already (Plan 26), so mapping to `""` at `getReview` keeps `Review.topic: string` and every page unchanged. |
| D4 | Escalation refusal in the guard | `HarnessResult.refused` (set when the escalation model raised `LLMRefusal`); `topic_guard` maps `value is None and refused` to the fixed `personal_medical` rejection. | Same rule as a refusal of the guard's own model (Plan 26 A1). A merely malformed answer still ends as `error`. |
| D5 | Tab title while a review runs | Neutral (`FALLBACK_TITLE`) until the topic check has passed: `RunState.guardPassed` is set by the first step event after `checking_topic` (or `done`); the report and non-personal terminal pages show the topic as before. | A personal refusal is only known after the guard; `refining` is the first event that proves the guard passed. |
| D6 | Red-flag recall | Add only the two verb-led patterns that are precise: "swallowed … coin(s)" and "ate/eaten/swallowed/drank/drunk … rat/mouse/rodent poison/bait", under the existing anchor and cue rule. Every precision set stays green (0 wrongly refused). Typos, and-framed phrasing and the "someone" traps are deferred. | The two misses are verb phrases with no research reading; the rest has no rule that is precise without a measured set (the owner declined paid evals). |
| D7 | After-period citations in the full review | `prose._sentences` moves a citation group that follows the stop into the sentence before it ("… 0.55. [P1]" → "… 0.55 [P1].") when that sentence cites nothing else (or the group stands alone). A leading group of a sentence whose predecessor already cites stays with it ("[P2] reported…"). | The same canonicalisation as the quick writer's `_cite_inside_stop`, applied where every full-review prose check splits. No prompt or schema change, so `prompt_version` is unchanged (no prompt pin moves). |
| D8 | Quick limits sentence giving advice | `_ADVICE` in `app/graph/nodes/quick.py`: a sentence-initial imperative of a verb a person acts on (take, stop, start, avoid, use, ask, consult, see, talk, …; not "Use of", not "Never-smokers"), "you/your", or "patients/people/… should|must|need to (not) <act>". Dropped like a certainty claim; the next passing sentence is used, else none. | Fail-safe and code-only; research wording ("patients should be followed up longer") passes. |
| D9 | MCP `quick_answer` waiters | A Redis slot per client (`SseSlots`, key `mcpwait:key:<id>` or `mcpwait:ip:<hashed address>`, limit `sse_max_per_ip`); a call over the cap returns at once as with `wait_seconds` 0; released in `finally`. | Reuses the shared, crash-safe counter (TTL) of the event streams; raw addresses never reach Redis. |
| D10 | `/r/{id}/report.html` for a quick answer | 303 with a relative `Location: /r/{id}`. | A quick answer has no full report; a relative location survives the proxy. |
| D11 | Ghost workers | `LOADED_MAX_AGE` 3 minutes (six missed 30 s heartbeats); `loaded_workers` drops and HDELs stale or unparseable entries. | Rebuilt containers never say goodbye; 3 minutes stays above the console's 2-minute "not reporting" mark. |
| D12 | Sign-in race | `session.get(AdminUser, …, with_for_update=True)` in `_record_sign_in`, plus the missing test for "a password changed while the check runs". | A CLI `passwd` landing between the re-read and the commit could otherwise be overwritten by the rehash. |
| D13 | Flaky `test_queue_position` | The repository orders ties by id (`created_at < x OR (= x AND id < x.id)`); the test sets distinct `created_at`. | One Windows clock tick gave equal times (positions [1,1,3]). |
| D14 | Eval minors | Only `_replace` (remove the `.tmp` when `os.replace` fails) and `load_gold` on an empty file → `None`. | Cheap and clearly correct; the others change metric semantics or need data (section 5). |
| D15 | Small UI and docs | The quick page drops the space before an unnumberable group; a cited paper missing from the result shows `RC.quick.missingPaper`, not its raw id; `RequestSlip` loses the test-only `initialTopic`; `docs/api.md` points to `/status` instead of quoting `$0.103`. | Each is a few lines with its own test. |

## 3. Verification notes (against `eae78b5`)

- **A (kept).** `ReviewService._version` builds `prompt_version + "+llm" + active_version_id + ("+g" + glossary) +
  cache_part(sources, env)`; `compute_cache_key` hashes it, and only the hash is stored. The worker's `run_review`
  refreshes runtime then LLMs and builds `ReviewRunner(ctx["graph"])`; `_finish` never touches `cache_key`.
  `ux_reviews_active_cache_key` is a partial unique index on active rows. A job queued across a save is therefore stored
  under the old generation's key with the new generation's result.
- **B1 (kept).** `ReviewSummary.topic: str`; `GET /reviews/{id}`, `review://{id}`, `review://{id}/report.md`
  (`render_markdown`'s title) and the replayed `queued` event (`{topic}`) all echo a personal refusal's question.
- **B2 (kept).** `HarnessRunner._run_escalation` catches `LLMRefusal` as any `LLMError`; the guard then raises
  `LLMOutputError` and the review ends `error` without the hotlines.
- **B3 (kept).** `ReviewScreen` sets `document.title` to the topic as soon as it is known.
- **B4 (partly kept).** See D6.
- **C1 (kept).** `prose._SENTENCE` splits before `[`, so "… 0.55. [P1]" left "… 0.55." with no ref and scoped it to
  every paper; `prose_problems`, `fix_prose`, `statement_problems` and `fix_statement` all split with `_sentences`.
- **C2, C3, C4 (kept).** `closing_line` filtered only certainty talk; `quick_answer` waited with no per-client bound;
  the report route built the full standalone report for any done review.
- **D1 (kept).** `LOADED_MAX_AGE = timedelta(days=1)`, entries never pruned.
- **D4 (kept).** The search stage recorded `list(deps.sources.enabled)`, leaving out `extras` such as `plos`.
- **E1, E2 (kept).** See D12.
- **F1, F3 (kept).** See D13, D14.
- **G1–G4 (kept).** See D15.

## 4. Dropped (already fixed or by design)

| Item | Finding |
|---|---|
| D2 mirror guard for non-mapping documents (settings, sources) | By design since Plan 23c Task 5: `apply_overrides` and `clean_overrides` already read a non-mapping value as "no overrides" on the API's hot path, and a stored row that is not a mapping is a **reported failure** in the worker (`runtime_error`), pinned by `test_runtime_reload.py` (`CORRUPT_ROWS`: startup fallback, poll, poller, job start, mirror repair). Turning it into a silent `{}` was prototyped and broke those seven pins: it would hide the admin's error. |
| D3 `/admin/llm-config` 500 on an unparseable stored row (23b M6) | Fixed: `_unreadable` in `app/api/admin_models.py` answers the stored row with the error. |
| E3 sessions carry no password version | `python -m app.cli.admin passwd` already ends every session of the admin (`AdminSessions.end_all`). The remaining window (a session created between the CLI's commit and its `end_all`) is noted, not fixed. |
| F2 migration tests pin their downgrade target | Fixed: `BEFORE_ADMIN`, `BEFORE_LLM_VERSIONS`, `BEFORE_RUNTIME` in the three integration tests. |
| G harness start 422 field mapping | The start form's own checks stop those values before a request; no user-visible case. Deferred rather than built. |

## 5. Deferred (with reason)

- **Red-flag typos ("cnt breathe", "chest pian"), and-framed phrasing, the "someone" traps:** no rule is precise without
  a measured set; the guard stays the backstop.
- **Eval minors:** glossary aliases missing plurals and "sensitivity" matching "sensitivity analysis" (change harness
  metric semantics; paid evals are declined), `select`'s calendar-date guard, the report header taking models from the
  first record, `drop_target` without DOI or PMID (needs title matching).
- **ModelsView/ModelsHistory onto `useVersionedPage`/`VersionHistory`:** a refactor, not a fix.
- **Bidi isolation in the report renderer:** renderer-wide; no reported case.
- **Out of scope as briefed:** anything needing a paid eval (Plan 25 lexical floor), clause-level misattribution inside
  one sentence, Plans 28/29, domain/HTTPS/Turnstile/ops.

## 6. Tasks

1. The cache bound to the configuration the worker ran (A).
2. A personal refusal never echoes its question; an escalation refusal is one; two red flags (B1, B2, B4).
3. Prose checks scope an after-period citation to its sentence; the quick limits sentence gives no advice (C1, C2).
4. MCP `quick_answer` waits bounded per client (C3).
5. Ghost workers, the sources searched, the sign-in race, queue positions, eval writers (D1, D4, E1, E2, F1, F3).
6. Frontend: neutral tab title until the guard passes, the quick report redirect, quick page details, `initialTopic`
   removed (B3, C4, G1–G3).
7. Docs (`docs/api.md`, G4) and final checks; the controller adds the `CLAUDE.md` line and runs a no-spend smoke.

## 7. Risks

- Re-keying changes which row a later request finds; covered by the end-to-end test (queued under A, run under B,
  reused under B, not under A) and the unchanged-key test.
- `prose._sentences` now rewrites "… x. [P1]" to "… x [P1]." in the stored summary text; the citation groups and
  their order are unchanged, so the Plan 25 marker alignment is unaffected (the full suite, including the support and
  quick tests, is green).
- The advice filter could drop a legitimate limits sentence; it is fail-safe (the certainty sentence always stays) and
  the research-wording cases are pinned.
