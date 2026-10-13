# Plan 26: Audience modes and public safety rails — design (2026-10-13)

**สรุปภาษาไทย:** Plan 26 ทำให้บริการสาธารณะฟรีนี้ปลอดภัยเมื่อประชาชนใช้ และให้รายงานเดียวแสดงได้ 4 มุมมอง ข้อแรก คำถามที่อ่านแล้ว
เป็นภาวะฉุกเฉินของผู้ถามหรือคนใกล้ตัว (เช่น "ผมเจ็บหน้าอกมาก ตอนนี้" หรือ "อยากตาย") ถูกตอบทันทีด้วยโค้ดล้วนก่อนใช้ทรัพยากรใด
ไม่สร้างรีวิว ไม่เรียก LLM ไม่นับโควตา และแสดงข้อความคงที่ให้โทร 1669 (และ 1323 สายด่วนสุขภาพจิตเมื่อเป็นเรื่องทำร้ายตัวเอง) วลีอาการ
ฉุกเฉินจะนับเฉพาะเมื่ออยู่กับคำบ่งชี้ว่าเป็นเรื่องของตัวเอง (ฉัน ผม ตอนนี้ my I) และไม่มีกรอบงานวิจัย (งานวิจัย การศึกษา ผู้ป่วย study trial)
หัวข้อวิจัยอย่าง "chest pain in the emergency department" จึงยังได้รีวิวตามปกติ ข้อสอง ตัวกรองหัวข้อ (guard) ได้หมวดใหม่
`personal_medical` สำหรับคำถามเรื่องอาการ การวินิจฉัย ยา ขนาดยา หรือการเลือกการรักษาของคนคนหนึ่ง รีวิวจบเป็น rejected พร้อม
ข้อความคงที่ว่าบริการนี้สรุปงานวิจัยเกี่ยวกับกลุ่มประชากร ให้ปรึกษาแพทย์หรือเภสัชกร ฉุกเฉินโทร 1669 ใช้ guard call เดิมหนึ่งครั้ง
REST และ MCP ได้รหัส `emergency`, `personal_medical`, `declined` ข้อสาม หน้ารายงานมี 4 มุมมอง ประชาชนทั่วไป (ค่าเริ่มต้น)
แพทย์ข้างเตียง นักศึกษาและแพทย์ประจำบ้าน และคณะกรรมการยาและ HTA เปลี่ยนเฉพาะลำดับส่วน กล่องคำอธิบาย และสิ่งที่เปิดไว้ ไม่เปลี่ยนการค้น
คัดกรอง อ่าน หรือสังเคราะห์ ไม่อยู่ใน cache key และไม่ส่งไป API ข้อสี่ ทุกมุมมองมีป้าย "ข้อมูลด้านอันตรายไม่ครบ" เมื่องานที่รวมไว้ไม่รายงาน
อันตรายครบทุกงาน (คำถามเรื่องการรักษาหรือการป้องกัน) และป้าย "ไม่ใช่คำแนะนำเรื่องขนาดยา" เมื่อข้อความรายงานอ่านเหมือนสั่งขนาดยา
ทั้งสองคำนวณในเบราว์เซอร์ ไม่แก้ข้อความ มุมมองแพทย์และคณะกรรมการมีหมายเหตุว่าประชากรในงานวิจัยอาจต่างจากเวชปฏิบัติไทย
prompt ของ guard เปลี่ยน จึงเปลี่ยน `prompt_version` เป็น `2026-10-13.2` pin ของ SLR คงเดิม ค่าใช้จ่ายเพิ่มราว $0.00001 ต่อรีวิว
การวัดผล guard กับคำถามจริงบน harness 22a เป็นงานที่เสียเงิน จึงเป็นการตัดสินใจของเจ้าของ

Context: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` section 3 (the Audience row: "Anyone; no
audience concept; disclaimer only in the UI"; the five steps of evidence-based medicine), section 4 (positioning; "One
engine, four presentations"; the audiences: bedside physicians, drug and therapeutics committees and HTA, students and
residents, the general public), section 5 (risks 1 harms left out of abstracts, 4 over-trust, 5 applicability, 6 "a
personal-symptom question must not get a review. It must get 'see a doctor, or call 1669'") and section 6 (row 26).
Base: master `6eb0a34` (Plans 22a through 25 merged). The owner told Claude to run the roadmap plans end to end
without approval gates, so Claude stood in for the brainstorming dialogue: the controller's decisions and Claude's own
are in section 2.

## 1. Purpose and scope

**Goal.** Once the public uses the service, a question about the asker's own health gets "see a doctor, or call
1669", never a review; an emergency gets that answer before anything is spent; the report never reads as dosing advice
and says when harms data is missing; and one review can be read in the presentation its reader needs.

**Success for Plan 26:**
- A topic that reads as a personal emergency is refused by `ReviewService.create` before every other check: REST 422
  `{detail, code: "emergency", kind, hotlines, message_th}`, MCP `start_review` → `{review_id: null, status:
  "refused", …}`. No review row, rate-limit hit, quota use, cache lookup or LLM call.
- A personal medical question is ended by the topic guard (`category: "personal_medical"`) with a fixed message; the
  review is `rejected`, `refusal_code: "personal_medical"`, the `rejected` event carries `code`. Cost: the one guard
  call every review already makes.
- Research topics that only name a red-flag symptom ("chest pain in the emergency department", "suicide prevention in
  adolescents", "paracetamol overdose treatment") are reviewed as before (unit tests on both lists).
- The web report offers four views; the public view is the default and keeps today's section order; no view changes
  content, numbers or the cache key.
- Every view shows "ข้อมูลด้านอันตรายไม่ครบ" when it applies and "ไม่ใช่คำแนะนำเรื่องขนาดยา" when the text reads as dosing
  advice; neither rewrites the text.

**In scope:** the red-flag module and its lists, the `Refused` service error and its REST/MCP mapping, `refusal_code`,
the guard's `category`, the runner's event `code`, `prompt_version`, the frontend audience model and switch, the report
notices, the emergency answer in the request form, the personal-question terminal page, docs (`docs/api.md`,
DESIGN.md, roadmap), tests.

**Out of scope:**
- A plain-language rewrite of the report for the public (an LLM call per view). A later option; this plan adds no
  presentation LLM call.
- Changing the writer's prompts to avoid dosing language (the SLR pins are frozen; the notice is the rail).
- Purging the topic of a `personal_medical` review from the database, or hiding it from admins. It is stored like any
  rejected topic (never listed publicly; `list_recent` shows done reviews only).
- Audience-specific Markdown/CSV/JSON exports or an audience field in the API.
- Measuring the guard's `personal_medical` precision on real questions: a paid batch on the 22a harness, the owner's
  call.
- A deterministic personal-question detector beyond emergencies (first-person phrasing is too common in research
  requests; the guard decides).

## 2. Decisions (Claude, on the owner's standing instruction, 2026-10-13)

**From the controller:**

| Topic | Decision |
|---|---|
| One engine, four presentations | `audience` is `public \| bedside \| learner \| committee`, default `public`. It changes only section order, notes, what starts open and the wording of notes; never search, screening, reading or synthesis; not in the cache key; two views share one cached result. No presentation LLM call; a plain-language rewrite is a later option |
| Where the audience lives | A viewer preference: `?view=` in the report URL, then `localStorage` (`mra.audience`), then `public`. The request form offers the same four choices and stores the choice; it is **not** a request field (REST and MCP are presentation-free) |
| Personal-symptom questions | No review. A deterministic red-flag pass first (Thai and English emergency phrases); on a match an immediate emergency message (1669; 1323 too for suicide or self-harm). Then the existing guard with a new category `personal_medical`, which ends the review with a fixed, kind Thai message. The guard prompt and schema change bumps `prompt_version`; the SLR pins stay; the guard prompt is pinned |
| Cost honesty | The red-flag pass runs in the API before every check: nothing is spent. The guard runs where it always ran, as the first node of the review job (after admission): a `personal_medical` refusal costs that one guard call, holds a queue slot until the guard answers, and counts against the hourly rate limit and the daily review counter, exactly as any rejected topic does today. Section 4 states this |
| REST and MCP | Through `ReviewService`: one rule for both. Structured codes `emergency`, `personal_medical` (and `declined` for every other guard rejection), documented in `docs/api.md` |
| Red-flag list | One module with tests (`app/services/safety.py`); messages never echo the user's text |
| No dosing advice | A deterministic presentation-layer guard, not a writer-prompt change: dose-advice patterns in the model-written text show a fixed notice; the text is never rewritten; study doses as conditions do not trigger it (tests on both) |
| Harms gaps | Deterministic from the cards: when evidence studies' outcomes name no harms or adverse events, "ข้อมูลด้านอันตรายไม่ครบ"; absence of harms is not evidence of safety |
| Applicability | Bedside and committee views: a fixed note that the studies' populations and settings may differ from Thai practice; context, never evidence |
| Eval | Measuring the guard on the 22a harness is a paid batch, the owner's call; unit tests cover the red-flag list and the refusal paths with fakes |

**Claude's own:**

| Topic | Decision | Why |
|---|---|---|
| Red-flag rule | A red-flag phrase counts only with a personal marker (EN `i`, `i'm`, `me`, `my`, `myself`, `someone`, `right now` …; TH ฉัน, ผม, ดิฉัน, หนู, เรา, ตอนนี้, เมื่อกี้, ช่วยด้วย …) **and** no research framing (EN word starts `study`, `trial`, `research`, `evidence`, `review`, `cohort`, `patients`, `incidence`, `randomi` …; TH งานวิจัย, การศึกษา, ผู้ป่วย, ประสิทธิผล …). A short list of first-person self-harm phrases ("kill myself", "i want to die", อยากตาย, ไม่อยากมีชีวิตอยู่) counts alone | A phrase alone would refuse real research ("chest pain in the emergency department"); a marker alone would refuse "help me find studies on chest pain". A self-harm statement in the first person must always reach the hotline |
| Roman numeral | `i` after "type", "phase", "class", "grade" or "stage" is no personal marker | "type I diabetes and unconscious hypoglycaemia" is research |
| Kinds and hotlines | `kind: "medical"` → `["1669"]`; `kind: "self_harm"` → `["1323", "1669"]` (the mental health hotline first) | The person thinking of self-harm needs the listening line first, the ambulance number second |
| Emergency on REST | HTTP **422** with `{detail, code, kind, hotlines, message_th}` (`Refused`, a `ServiceError`) | No review was created, so 202 would lie; 422 is the route's "cannot process this request" status, and `code` tells it apart from a body error |
| Emergency on MCP | `start_review` **returns** `{review_id: null, status: "refused", code, kind, hotlines, message, message_th}` instead of raising | A tool error reads as a failure to retry; a structured result lets an agent pass the numbers on |
| Personal refusal storage | The review's `error` is `"personal_medical: <fixed English message>"`; `refusal_code` is derived from `status` and that prefix (`ReviewOut`, MCP); every other rejection is `declined` | No migration; old rejected reviews read `declined` correctly; the code survives in the one stored field |
| Guard schema | `TopicVerdict.category: Literal["research", "personal_medical", "declined"]`, required in the tool schema, Python default `"research"` (removed from the schema like the other required-nullable fields) | Strict tool schemas reject `default`; the default keeps every existing fake and test double valid |
| Guard rule | `personal_medical` wins (fixed message, model reason never shown); otherwise any of `allowed: false` or `category != "research"` rejects with the model's reason. No validator or repair | Either signal rejecting is the safe side; repairs would add calls for an inconsistency that changes nothing |
| Runner event | `rejected` payload `{reason, code}` with `code = refusal_code_of("rejected", reason)` | The live page needs the code without another request |
| View orders | Public and learner keep today's answer-first order exactly; bedside leads with bottom line, key findings, summary of findings, limitations; committee with bottom line, selection (PRISMA), methods, risk of bias, summary of findings, key findings; every other section keeps its order; a section the type lacks is skipped | The default render is unchanged (156 existing report renders keep passing); a committee weighs how studies were found before the results |
| What opens | The certainty rationale disclosure starts open in the learner and committee views | Readers who weigh the grade need its reason; the public and bedside keep the answer first |
| Notes | Public: "ก่อนอ่านรายงานนี้" (groups not persons; certainty in plain words; see a doctor or pharmacist; 1669). Learner: a learning note after the summary of findings (GRADE), selection (PRISMA), risk of bias and agree/conflict. Bedside and committee: "บริบทของประเทศไทย". All are `aside` boxes, not sections (no table-of-contents entry), printed; the switch is not printed | Notes explain, they are not evidence; the table of contents stays the report's structure |
| Harms rule | Only for `therapy` or `prevention` questions (`result.question.question_type`), never scoping; studies = papers with a card that are evidence (`isNotEvidence` false) and not qualitative/mixed; a study reports harms when any outcome name or result (in `card_en` or `card`) matches the harm words (EN adverse, side effect, harm, safety, tolerab-, toxicit-, complication, withdrawal/discontinuation due to; TH ไม่พึงประสงค์, ผลข้างเคียง, ความปลอดภัย, อันตราย, ภาวะแทรกซ้อน, ความเป็นพิษ). The notice shows when fewer than all report; the text gives "k จาก n" or "none" | Harms matter for a treatment decision; a prevalence or diagnosis question has no harms outcome to miss; counts of studies are plain figures |
| Dosing rule | Model-written text only (answer, summary, key-finding statements; shown and English). EN: `take/give/administer/prescribe` (not after who/that/which/to), `should take/receive/use/be given/be taken`, `recommended (daily) dose`, then a dose (number + unit) within 40 characters of the same sentence. TH: ควร/แนะนำให้/โปรด then a dose, ครั้งละ or วันละ within 30 characters | Advice is an imperative or "should"; a study's dose is a noun phrase or a past/relative clause |
| Copy location | Report notices from `RC.audience`/`RC.safety` (the i18n scan); the emergency and personal pages from `src/lib/refusal-copy.ts` (Thai, the landing and terminal pages are Thai-only), the same words as the backend's `MESSAGES` | One string table per surface, pinned by tests on both sides |
| Prompt version | `2026-10-13.2`; only the guard's system prompt and `TopicVerdict` change; every existing pin holds; the guard system prompt and user prompt are pinned | A prompt and an LLM schema changed |

## 3. Audiences and what each view changes

| | Public (default) | Bedside | Learner | Committee |
|---|---|---|---|---|
| Who | The general public | Physicians at the bedside | Students and residents | Drug and therapeutics committees, HTA |
| Section order | Today's answer-first order | Bottom line, key findings, summary of findings, limitations, then the rest | Today's order | Bottom line, selection (PRISMA), methods, risk of bias, summary of findings, key findings, then the rest |
| Notes | "ก่อนอ่านรายงานนี้" | "บริบทของประเทศไทย" | "อ่านเพื่อเรียนรู้" after summary of findings, selection, risk of bias, agree/conflict | "บริบทของประเทศไทย" |
| Starts open | As today | As today | Certainty rationale | Certainty rationale |
| Harms gap and dosing notices | Yes | Yes | Yes | Yes |
| Content, numbers, sections | Same | Same | Same | Same |

The five steps of evidence-based medicine (roadmap section 3): the views serve Appraise (learner notes, committee
methods-first) and Apply (the Thai-practice note), while Assess stays with the clinician; Plan 29 adds the Thai context
layer (NLEM, guidelines).

## 4. Request classification flow and its cost

```
POST /reviews  or  MCP start_review
  └─ ReviewService.create
       1. red_flag(topic)            code, < 1 ms        → Refused("emergency")   REST 422 / MCP {status: "refused"}
                                                            nothing stored, counted, cached or charged
       2. callback rule, cache, Turnstile, URL safety, key quota, capacity (atomic), hourly rate   (unchanged)
       3. insert + enqueue            (queue slot, daily counter)
worker: review job
  └─ topic_guard (guard role, one call, as before; prompt +806 characters)
       category personal_medical  → rejected, error "personal_medical: …", event {reason, code: "personal_medical"}
       category declined / allowed false → rejected with the model's reason, code "declined"   (as before)
       research                   → refine_question … (unchanged)
```

| Path | LLM calls | Spend | Rate limit, quota, daily counter | Queue slot | DB row |
|---|---|---|---|---|---|
| Emergency | 0 | $0 | Not touched | No | No |
| Personal medical | 1 (the guard) | The guard call: about $0.0001 on `budget` | Counted (as any rejected topic today) | Until the guard answers (seconds) | Yes, `rejected` |
| Research | as today | as today + about $0.00001 (longer guard prompt) | as today | as today | as today |

Extra cost per request: the guard's system prompt grows by 806 characters (about 200 tokens) and the answer by one
enum field: about $0.00001 per review on `budget` (Qwen3.5 Flash, $0.065 / $0.26 per 1M), about $0.00003 on
`balanced` (Gemini 3.1 Flash Lite). The admission reservation is unchanged (the per-review cap does not move).

Why not run the guard before admission: it would put an LLM call (seconds, a provider dependency) inside the request
path of every `POST /reviews`, outside any review's budget and before the cache, and the API process would need the
model stack. The deterministic pass covers the case where speed matters (an emergency); a personal question waits a
few seconds for the guard, like any review start.

## 5. Refusal and emergency messages (exact text)

Backend `app/services/safety.py` `MESSAGES` (REST `detail`/`message_th`, MCP `message`/`message_th`, stored `error`):

| Key | English | Thai |
|---|---|---|
| `emergency` | This may be an emergency. Call 1669 (Thai emergency medical services) now, or go to the nearest emergency department. This service summarises research and cannot help in an emergency. | ข้อความนี้อาจเป็นภาวะฉุกเฉิน โปรดโทร 1669 (บริการการแพทย์ฉุกเฉิน) ทันที หรือไปห้องฉุกเฉินที่ใกล้ที่สุด บริการนี้สรุปงานวิจัย จึงช่วยในภาวะฉุกเฉินไม่ได้ |
| `self_harm` | If you are thinking about harming yourself or feel unsafe, you are not alone. Call the Thai mental health hotline 1323 (24 hours), or 1669 if you are in danger now. | ถ้าคุณกำลังคิดทำร้ายตัวเองหรือรู้สึกไม่ปลอดภัย คุณไม่ได้อยู่คนเดียว โทรสายด่วนสุขภาพจิต 1323 ได้ตลอด 24 ชั่วโมง หรือโทร 1669 ถ้าตอนนี้อยู่ในอันตราย |
| `personal_medical` | This service summarises research about groups of people and cannot advise on your own case (symptoms, diagnosis, dose or treatment choice). Please see a doctor or pharmacist. In an emergency in Thailand, call 1669. If the issue is suicidal thoughts or self-harm, call 1323 (Thai mental health hotline). | บริการนี้สรุปงานวิจัยเกี่ยวกับกลุ่มประชากร จึงให้คำแนะนำเฉพาะกรณีของคุณไม่ได้ เช่น อาการ การวินิจฉัย ขนาดยา หรือการเลือกการรักษา โปรดปรึกษาแพทย์หรือเภสัชกร หากเป็นภาวะฉุกเฉิน โทร 1669 หากเป็นเรื่องความคิดอยากทำร้ายตัวเอง โทร 1323 (สายด่วนสุขภาพจิต 1323) |

Frontend `src/lib/refusal-copy.ts` (same bodies, plus titles and buttons):
- Emergency title: "อาจเป็นภาวะฉุกเฉิน โทร 1669 ทันที"; self-harm title: "คุณไม่ได้อยู่คนเดียว".
- Call buttons: "โทร 1323 สายด่วนสุขภาพจิต" (`tel:1323`, self-harm, first), "โทร 1669 บริการการแพทย์ฉุกเฉิน" (`tel:1669`).
- Personal page title: "คำถามนี้เป็นเรื่องเฉพาะของคุณ"; hint: "ถ้าต้องการรู้ว่างานวิจัยว่าอย่างไรกับคนกลุ่มหนึ่ง ลองถามใหม่โดยไม่ระบุ
  เรื่องของตัวเอง เช่น “แอสไพรินป้องกันโรคหลอดเลือดสมองในผู้สูงอายุได้หรือไม่”"; buttons `tel:1669` and "ถามคำถามใหม่".

## 6. API and MCP changes

- `ReviewService.create`: `red_flag(req.topic)` first; `Refused(code, detail, *, kind, hotlines, message_th)` (422,
  `body()` → `{code, kind, hotlines, message_th}`); one log line `refused_emergency kind=…` (never the topic).
- `POST /api/v1/reviews`: `service_error_response` adds `exc.body()` for `Refused`; the 422 description and the
  order-of-checks docstring name the emergency check.
- `GET /api/v1/reviews/{id}`: `ReviewOut.refusal_code` (`personal_medical | declined | null`).
- Event `rejected`: `{reason, code}`.
- MCP: `start_review` returns the refusal dict; `get_review_status` adds `refusal_code`; `get_review_result` adds it
  when there is no result; `INSTRUCTIONS` and `START_REVIEW_DOC` describe both refusals.
- `/status` unchanged (no new public limit). Webhooks unchanged (`rejected` is already a terminal status).

## 7. Dosing and harms notices

Both live in `src/lib/safety.ts` (pure) and render in `ReportNotices` (`src/components/review/audience.tsx`), under the
audience switch and above the bottom line, in every view, only when the review has studies:
- `harmsGap(result) → {reporting, studies} | null` (rule in section 2). Copy: "ข้อมูลด้านอันตรายไม่ครบ" with "บทคัดย่อของงาน
  ที่รวมไว้ k จาก n งานรายงานผลด้านอันตรายหรือเหตุการณ์ไม่พึงประสงค์ บทคัดย่อมักไม่รายงานอันตราย การไม่พบข้อมูลจึงไม่ได้แปลว่าปลอดภัย",
  or the "ไม่มีบทคัดย่อของงานที่รวมไว้รายงาน…" form when k is 0.
- `needsDosingNotice(result)` over `summary` and both syntheses' `answer`, `executive_summary` and key-finding
  statements (`hasDosingAdvice`, rule in section 2). Copy: "ไม่ใช่คำแนะนำเรื่องขนาดยา" with "ขนาดยาที่กล่าวถึงในรายงานนี้มาจาก
  งานวิจัยที่อ่าน ไม่ใช่ขนาดที่เหมาะกับคนใดคนหนึ่ง ปรึกษาแพทย์หรือเภสัชกรก่อนเริ่ม หยุด หรือเปลี่ยนยาทุกครั้ง".
- Neither touches a number face (`VerifiedNumber`, `ComputedNumber`, `Hole`) or any text; counts of studies are
  plain figures.

## 8. Prompt and pin changes

- `GUARD_SYSTEM` gains the three categories with examples and "reason: one short sentence, without repeating personal
  details". sha256 before `7534e5ea…`, after `f6c7a477daad52fa8b8413f5701eb500deba75b1c54352a6dba4d1bb52b3905d`;
  `guard_user` unchanged (`92fffe5f…`), both pinned in `test_guard_prompt_is_pinned`.
- `TopicVerdict.category` (required in the tool schema).
- `prompt_version` `2026-10-13.1` → `2026-10-13.2`; the pin comment in `tests/unit/test_prompts_by_type.py` and the
  `docs/api.md` header follow. Every SLR pin and the Plan 25 judge pins are unchanged.
- The Plan 22a eval replays from screening onward, so the guard change does not touch replay results; `eval freeze`
  runs the guard, so a new pool freeze would use the new guard (the frozen v1 pool is unchanged).

## 9. Failure modes

| Failure | Behaviour |
|---|---|
| The red-flag list misses an emergency (wording not in the list) | The topic is admitted; the guard sees it; a personal emergency is normally `personal_medical`, whose message names 1669 |
| The list matches a research topic | 422 with the emergency message; the person can rephrase with research framing. Tests pin the known research phrasings; the rule needs a personal marker and no research word |
| The guard omits `category` (a provider without strict schemas) | Pydantic fills `research`; `allowed` still decides as before |
| The guard answers `allowed: true` with `personal_medical` | Refused as personal (the category wins) |
| The guard answers `allowed: false` with `research` | Rejected with the model's reason (`declined`) |
| The guard refuses or raises | As today (`LLMRefusal` → rejected "declined by the safety filter"; other errors fail the review) |
| A client that predates `refusal_code` / `code` | Reads `status: "rejected"` and `error` as before |
| The live page misses the event's `code` | `review.refusal_code`, then the `error` prefix, still select the personal page |
| Storage blocked (private window), the offline file | The view falls back to `public`; a switch still works for the page |
| A harms word in an efficacy outcome ("bleeding" is not a harm word; "safety" is) | At worst the notice is not shown for that study; harms words are kept narrow and the notice errs towards showing |
| A dosing pattern missed | No notice (the public guide already says the report is not dosing advice) |
| A study dose read as advice | A notice that is true anyway; the tests pin the common study phrasings as negatives |

## 10. UI (DESIGN.md)

- **Audience switch:** under the title block, a fieldset "มุมมองของรายงาน" of four radio chips, `primary` border on
  `rail` when checked, 44px targets below `md`, a muted hint; hidden in print.
- **Report notices:** `aside` boxes named by their label (`info-bg` guide, `warning-bg` dosing and harms, `rail`
  applicability and learning notes); fixed copy; printed; never a table-of-contents entry.
- **Request form:** the extras gain "รายงานนี้สำหรับ" (four radios); the summary chip is unchanged.
- **Emergency answer:** in the form's error slot, an `err-bg` `role="alert"` block with title, message and `tel:`
  buttons; nothing typed is repeated.
- **Personal-question page:** title, message, hint, `tel:1669` and "ถามคำถามใหม่"; no topic, no model reason, no
  resend link.
- No new tokens, no number-face change. DESIGN.md gains the four component descriptions, a Report bullet and a log row.

## 11. Docs

- `docs/api.md`: the `prompt_version` header, the 422 refusal bullet, the order of checks, `refusal_code`, the
  `rejected` event payload, the MCP tool rows, and a section "Public safety rails and audience modes (Plan 26)".
- `DESIGN.md`: components, a Report bullet, a decisions-log row.
- Roadmap row 26: built.
- After the merge (controller): a `CLAUDE.md` convention line.

## 12. Testing

All offline; fake LLMs only:
- **Red flags** (`tests/unit/test_safety.py`): personal emergencies in English and Thai (medical → 1669), self-harm
  (1323 then 1669), research topics and plain questions that must pass (including "I want research on chest pain
  triage", "type I diabetes…"), normalisation, the lists' hygiene, fixed messages that never echo the topic, refusal
  codes of stored reviews.
- **Refusals** (`tests/unit/test_safety_refusals.py`): the service refuses before cache, rate limit and queue (and a
  normal request still passes the 1/minute limit afterwards); self-harm hotlines; REST 422 body and no row; REST
  `refusal_code` for personal, declined and done; MCP `start_review` refusal dict and no row; MCP status and result
  carry `refusal_code`.
- **Guard** (`tests/unit/test_nodes_intake.py`, `test_runner.py`, `test_prompts_by_type.py`): the fixed personal
  message after one call and the route to END; the category wins over `allowed`; a declined category keeps the reason;
  the schema requires `category` without a default; the prompt names the categories; the runner's event `code` for
  declined and personal; the guard pins.
- **Frontend** (`src/lib/audience.test.ts`, `src/lib/safety.test.ts`, `src/components/review/audience.test.tsx`,
  `src/components/landing/refusals.test.tsx`): preference parsing, every view's order (public and learner equal to
  today), notes and what opens; harms gap cases (Thai and English words, every study reporting, other question types,
  scoping, not-evidence papers); dosing positives and negatives; the full report in each view; the emergency panel
  (medical and self-harm, call links, nothing echoed, no push); a plain 422 still an error line; the form's audience
  default, stored choice and that it is never sent; the personal page (no topic, no reason, no resend link; from the
  code or the error prefix); the run state's `code`; the API client's refusal parsing.
- **Not automated:** a real guard's precision on personal versus research questions (a paid batch), a browser check of
  the views, and the docker smoke check (controller, no spend).

## 13. Risks and open items

- **Guard precision.** A budget model may call a first-person research question personal ("I'm a nurse; does…").
  Mitigation: the prompt's research example in the first person, the fixed message with a hint to ask about a group.
  Measuring needs a paid batch.
- **Red-flag recall.** The list is short by design; phrasing outside it falls to the guard. The lists live in one
  module and can grow with tests.
- **Over-trust.** The notices are fixed text; the public guide explains certainty in plain words. A plain-language
  rewrite stays a later option.
- **Privacy.** A personal question's topic is stored like any rejected topic; deleting such rows is a possible
  follow-up (admin console).
