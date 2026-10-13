# Plan 25: Sentence-support grounding, "why this source was cited" and the "ตรวจแล้ว" badge — design (2026-10-13)

**สรุปภาษาไทย:** Plan 25 ตรวจว่าประโยคในรายงานที่อ้างอิงงานวิจัย [Pn] ได้รับการรองรับจากบทคัดย่อของงานนั้นจริง ระบบตรวจ
ข้อความภาษาอังกฤษก่อนแปล (ประโยคในบทสรุปที่มีการอ้างอิง และผลสำคัญแต่ละข้อ) ขั้นแรกใช้โค้ดล้วน ไม่ใช้ LLM: แยกบทคัดย่อเป็น
ประโยค ให้คะแนนตามคำสำคัญที่ตรงกับประโยคในรายงานและตัวเลขที่ตรงกัน แล้วเลือก 2 ประโยคที่ใกล้ที่สุด ขั้นที่สองเรียกโมเดล
ระดับ screener ครั้งเดียวต่อรีวิว (ผ่าน runner validate → repair → escalate) ให้ตัดสินว่า รองรับ / รองรับบางส่วน / ไม่รองรับ
โดยส่งเฉพาะประโยคในรายงานกับประโยคผู้สมัครจากบทคัดย่อ ไม่ส่งบทคัดย่อทั้งฉบับ ตรวจได้ไม่เกิน 30 คู่ต่อรีวิว ถ้างบของรีวิวเหลือน้อย
กว่า $0.01 จะข้ามการตัดสิน ถ้าโมเดลล้มเหลว ผลเป็น "ยังไม่ได้ตรวจ" รีวิวไม่ล้มและไม่ลบการอ้างอิงใด ป้าย "ตรวจแล้ว" ขึ้นเฉพาะเมื่อ
โมเดลบอกว่ารองรับ และตัวเลขทุกตัวในประโยคผ่านการตรวจตัวเลขเดิม และประโยคไม่ได้กล่าวถึงค่าที่ระบบคำนวณ (pooled) และงานนั้นนับ
เป็นหลักฐาน (ไม่ใช่รายงานซ้ำของการทดลองเดียวกัน และไม่ใช่ชนิดงานวิจัยนอกเกณฑ์) ในรายงาน การอ้างอิงที่ตรวจแล้วมีเครื่องหมาย ✓
พร้อมคำอธิบาย เมื่อแตะรหัสงานวิจัย แถบต้นฉบับแสดง "ทำไมจึงอ้างอิงงานนี้": ประโยคที่ตรวจ (ภาษาอังกฤษ ก่อนแปล) ผลการตรวจ
และประโยคจากบทคัดย่อแบบคำต่อคำ กรณีไม่รองรับแสดงตรง ๆ ว่า "ไม่พบประโยคที่รองรับ" มี prompt และ schema ใหม่ จึงเปลี่ยน
`prompt_version` เป็น `2026-10-13.1` โดย prompt เดิมทุกตัวไม่เปลี่ยน (pin ของ SLR คงเดิม) ค่าใช้จ่ายเพิ่มราว $0.0005 ต่อรีวิว
บน preset `budget` (สูงสุดราว $0.008) การวัดผลบน harness 22a กับรีวิวจริงเป็นงานที่เสียเงิน จึงเป็นการตัดสินใจของเจ้าของ

Context: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` section 3 (the "Sentence support … Missing" row),
section 4 (positioning: trust that can be checked), section 6 (row 25) and section 6a (the Evidence Finder Verify row:
"Adds sentence-support checking and a 'ตรวจแล้ว' badge that shows the supporting abstract sentence"). Base: master
`ad53132` (Plans 22a, 23a–c and 24 merged). The owner told Claude to run the roadmap plans end to end without approval
gates, so Claude stood in for the brainstorming dialogue: the controller's decisions and Claude's own are in section 2.

## 1. Goal, success and scope

**Goal.** A reader can check not only that a number came from an abstract (done since Plan 19) but that the sentence
citing a paper says what that paper's abstract says, and can see the abstract sentence behind each citation.

**Success for Plan 25:**
- Every citation of the summary (`[P1]`, `[P1, P3]`) and of the key findings is paired with the cited abstract's closest
  sentences in code, and one judge call per review labels each pair `supported`, `partial` or `unsupported`.
- `result.support` holds the claims (English, before translation), each cited paper's label, the abstract sentence
  (verbatim) and the badge flag `verified`.
- The report shows a ✓ ("ตรวจแล้ว") on a citation only when `verified` and the paper is evidence; opening the paper
  shows "ทำไมจึงอ้างอิงงานนี้" with the claim, the label and the abstract sentence, unsupported included.
- A judge that fails, answers garbage, is skipped for the budget, or a check that crashes never fails a review or
  drops a citation; the labels are then unknown.
- The extra spend fits inside the review's existing cost cap; the eval harness reports a support rate from run files.

**In scope:** the deterministic scorer and badge rule, the judge prompt and schema, the graph node and its wiring,
`result.support` and `quality.support`, the stub result's support block, the harness metric rows, the frontend badge,
legend and rail view, docs (`docs/api.md`, DESIGN.md, roadmap), tests.

**Out of scope:**
- Checking the consensus and conflict explanations, the evidence rationale, the research gaps and the answer (the
  answer carries no citation; the others are mostly code templates or about the grade and gaps, not about one paper).
- Removing or rewriting a sentence the judge calls unsupported. The check informs the reader; it never edits the text.
- The Markdown and CSV exports (unchanged). The JSON export and the MCP `get_review_result` carry `support` as part of
  `result` without code changes.
- A runtime switch (env or console) to turn the check off. It is cheap and soft; a switch is a possible follow-up.
- Measuring the support rate on real reviews: a paid batch on the 22a harness, the owner's call.

## 2. Decisions (Claude, on the owner's standing instruction, 2026-10-13)

**From the controller:**

| Topic | Decision |
|---|---|
| Deterministic first | For each citation the supporting sentence is chosen from the cited paper's abstract without an LLM: the abstract is split into sentences, each scored by content-word overlap with the claim plus agreement on the claim's numbers. The claim is the English sentence before localization |
| Judge | `supported \| partial \| unsupported`; one batched call per review on the screener-tier role, strict schema, through the runner (validate → repair → escalate); only the claim and the 2 best candidate sentences per citation, never whole abstracts; capped (30 pairs per review); soft-fail to null (unknown), never failing the review or dropping a citation; skipped when the budget is nearly spent |
| Badge | "ตรวจแล้ว" only when the judge says `supported` and every number of the claim is verified by the existing number rule |
| View | "Why this source was cited": the claim and the supporting abstract sentence verbatim (abstract-only rule holds) plus the label; `unsupported` shown honestly ("ไม่พบประโยคที่รองรับ"), never hidden; Thai labels per DESIGN.md |
| Localization | The claim stays English; the shown text is mapped to it by the simplest robust rule (section 8); a translation that drops or moves markers degrades to "no badge", nothing breaks |
| Not evidence, computed | Papers that are not evidence (`related_to`, `design_excluded`) never get a badge and are not judged; pooled meta-analysis numbers never enter the judge and a claim that restates one gets no badge |
| Prompts and cache | A new judge prompt instead of changing the writer: the SLR pins stay; the new prompt gets its own sha256 pin; `prompt_version` bumped because a prompt and an LLM schema were added |
| Eval | A support-rate metric from run records (cheap: the result already holds it); measuring on real runs is a paid batch, the owner's call |
| Docs | `docs/api.md` documents `result.support`, `quality.support` and the badge rule |

**Claude's own:**

| Topic | Decision | Why |
|---|---|---|
| Claims | Summary sentences that carry a citation group, and key-finding statements with their refs. Not the conflict/consensus explanations, the rationale, the gaps or the answer | The summary and the key findings are where a reader meets `[Pn]` and refs; the answer has none; the explanations are code templates or about why studies differ, not what one abstract says |
| Unit judged | A (claim, cited paper) pair: `paper` names the `[Pn]`, and the judge is told to judge only that paper's part of the claim | A sentence often cites several papers with different roles ("most found lower risk [P1, P3], one found the opposite [P4]") |
| Marker | The citation groups the report already links (`\[(P\d+(?:\s*,\s*P\d+)*)\]`, as `CitedText`); a range (`[P1-P3]`) is no marker. The k-th group of the English summary is marker k | One definition on both sides; a range is plain text in the report already |
| Sentence split | Claims split at `. ! ?` or a group end before a capital letter (never before `[`, so a group after the full stop belongs to its sentence), never after "vs.", "e.g.", "i.e.", "et al.", "approx.", "Fig.", "No.", "cf." or an initial. Abstracts also split at line breaks; sentences under 20 characters are dropped | The writer's style ("… risk [P1].") and abstracts' labelled sections |
| Scorer | Content words (lowercase, ≥ 3 letters, a stop list including generic study words, a light plural stem); score = overlap share of the claim's words, and when the claim has numbers 0.6·overlap + 0.4·number share (the verifier's tokenizer, so "0.80" = "0.8"); ties go to the earlier sentence; the best 2 are candidates (always, even at a low score: the judge decides) | Cheap, deterministic, explainable; numbers matter most for results sentences |
| Prompt size | A claim is clipped at 600 characters and a candidate at 500 | Bounds the call (worst case about 13,000 input tokens for 30 pairs) |
| Cap and order | At most 30 pairs per review (`MAX_PAIRS`), summary pairs first in text order, then key findings; the rest keep their closest sentence and a null label (`over_cap` in telemetry) | A typical review has about 24 pairs; one call keeps cost and latency flat |
| Judge model | `deps.llms.with_schema("screener", SupportBatch)`: the screener's model, bound to the judge schema, shared semaphore and budget (`LimitedLLM`) | No new role: `llm.yaml`, the 23b model console and the presets stay unchanged; the screener is the cheap classifier tier |
| Schema | `SupportBatch{verdicts: [SupportVerdict{id, label, sentence: int \| null}]}`, every property required, no defaults | Strict structured outputs reject `default` |
| Validation | One verdict per id, ids copied, `sentence` 1..n for supported/partial; an answer still invalid after repairs keeps its usable verdicts (`incomplete`); none usable is `failed` | Partial value beats none; nothing invented |
| Evidence | Chosen by index from the candidates, never written by the judge; for `unsupported` and unjudged pairs the closest sentence is kept and shown as "the closest", not "supporting" | The abstract-only rule and the "never guessed" rule: every sentence shown is verbatim |
| Numbers rule | `numbers_checked` = no number of the claim fails the grounded-prose rule (`prose.unverified_numbers`: verified card numbers of the cited papers, the review's own text, pooled values, counts); `computed` = a number equal to a pooled value that is no verified number of the cited papers | Reuses the rule that already cleans the summary; key findings are numberless, so they pass |
| Budget | Skip the judge when less than `MIN_BUDGET_USD = 0.01` is left of the review's cap (`skipped_budget`); the call itself is charged by `LimitedLLM` like any other | The worst judge cost is about $0.008, so it can never push a review past its cap by more than the in-flight margin every node has |
| Placement | A node `check_support` after `write_synthesis`, beside `localize`; `finalize` waits for both. No new SSE event | It needs only the English synthesis; in a Thai review it runs in the localizer's shadow. The live stage and the event contract stay as they are |
| Result | `result.support = {judge, markers, claims[], display_aligned}`; null when the check crashed; absent before Plan 25. `quality.support` carries the counts | The UI and API clients need the claims and the alignment; telemetry stays in `quality` |
| Rail claim text | The English claim as checked, marked `lang="en"` and labelled "ภาษาอังกฤษ ก่อนแปล" | Thai sentence boundaries cannot be found reliably; showing what was actually checked is honest |
| Inline mark | A compact ✓ after the ref (`role="img"`, name "Pn ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้"), a "Pn ✓" key-finding chip, and one legend line under the text or list that shows any mark. Unsupported has no inline mark; it is shown in the rail | Prose stays readable; the word "ตรวจแล้ว" is in the name, the legend and the rail; an inline warning on every unsupported citation would read as an accusation the judge cannot back with certainty |
| Stub | The timed stub's result carries a fixed `support` block (key findings; P2 partial, P4 unsupported, the rest supported) in the engine's shape | Manual QA and the smoke check see every state without a model |
| Eval rows | `support_rate` (supported among judged evidence citations) and `support_verified_rate` (badge share of evidence citations), both Wilson-rated over done runs, as two rows of the harness report | The result already holds them; no gold standard is needed |
| Prompt version | `2026-10-13.1`; no existing prompt changes (the SLR pins and every other pin hold); the judge's system and user prompts are pinned | A new prompt and LLM schema enter the pipeline; cached results without `support` must not be served as new |

## 3. Data model and result fields

New LLM schema (`app/graph/schemas.py`):

```python
class SupportVerdict(BaseModel):
    id: str
    label: Literal["supported", "partial", "unsupported"]
    sentence: int | None  # 1-based candidate that supports the claim; null when unsupported


class SupportBatch(BaseModel):
    verdicts: list[SupportVerdict]
```

New state key: `support: dict | None` (the node's output). `result.support`:

```json
{
  "judge": "ok | incomplete | failed | skipped_budget | none",
  "markers": [["P1", "P3"], ["P4"]],
  "claims": [
    {"id": "s0", "where": "summary", "markers": [0, 1], "finding": null,
     "claim": "Most studies found a lower risk among metformin users [P1, P3], but one found the opposite [P4].",
     "refs": ["P1", "P3", "P4"], "numbers_checked": true, "computed": false,
     "citations": [{"ref": "P1", "label": "supported", "evidence": "<abstract sentence>", "score": 0.75,
                    "not_evidence": false, "verified": true}]},
    {"id": "k0", "where": "key_finding", "markers": null, "finding": 0, "claim": "<statement>", "...": "..."}
  ],
  "display_aligned": true
}
```

`quality.support = {judge, seconds, claims, pairs, judged, over_cap, computed, supported, partial, unsupported,
verified}` (`judge` may also be `crashed`). Papers, cards and every other field are unchanged; abstracts are still not
stored in the result (only the chosen sentences).

## 4. Algorithm

```
synthesis (English)
  ├─ summary_claims: sentences with a citation group → Claim(id s<n>, markers [k…], refs)
  └─ finding_claims: key_findings[i] → Claim(id k<i>, refs)
for each claim: claim_checks → (numbers_checked, computed)        prose.unverified_numbers, pooled keys
pairs = build_pairs(claims, abstracts, skip = not-evidence refs ∪ computed claims)
        each pair: best_sentences(claim, abstract_sentences(abstract)) → 2 candidates with scores
judged = pairs[:30]; over_cap = pairs[30:]
budget left < $0.01 → skipped_budget
else one call: screener bound to SupportBatch, SUPPORT_SYSTEM + support_user(items)
     runner: validate (verdict_problems) → repair (max_repairs) → escalate (repair_failed)
verdicts(value) → {pair id: (label, candidate index)}   (also from an answer still invalid after repairs)
citation(pair, label) → evidence = chosen candidate (supported/partial) or the closest (else);
                        verified = supported ∧ numbers_checked ∧ ¬computed ∧ evidence paper
```

The judge sees, per item, `{id, paper, claim, candidates[≤2]}` inside `<items>` after `DATA_NOTICE`; the claim keeps its
`[Pn]` groups so the judge can find "this paper's part". The system prompt (pinned):

> You check whether sentences of a medical literature review are supported by the abstract of the paper they cite.
> Each item gives a claim (one sentence of the review), the paper it cites (its [Pn] in the claim) and up to two
> candidate sentences copied from that paper's abstract. supported: a candidate states what the claim says about this
> paper (population or setting, exposure or intervention, outcome, direction, and every number the claim gives for this
> paper). partial: part of it, or a narrower or weaker statement. unsupported: none does, or a candidate contradicts
> it. Judge only the part that cites this paper; only from the candidates; once for every id.

## 5. Architecture and data flow

```
… explain_conflict* ─► write_synthesis ─┬─► localize ──────┐
                                       └─► check_support ──┴─► finalize (result.support, display_aligned)
```

- **`app/harness/support.py`** (new, pure): `MARKER`, `markers`, `abstract_sentences`, `content_words`, `score`,
  `best_sentences`, `Claim`, `summary_claims`, `finding_claims`, `pooled_keys`, `claim_checks`, `Pair`, `build_pairs`,
  `judge_items`, `verdict_problems`, `verdicts`, `citation`, `claim_record`; constants `LABELS`, `CANDIDATES = 2`,
  `MAX_PAIRS = 30`, `MAX_CLAIM_CHARS = 600`, `MAX_SENTENCE_CHARS = 500`, `MIN_SENTENCE_CHARS = 20`.
- **`app/harness/prose.py`**: `unverified_numbers(sentence, refs, ctx)`, the public form of the summary's number rule.
- **`app/graph/prompts.py`**: `SUPPORT_SYSTEM`, `support_user(items)`.
- **`app/graph/nodes/support.py`** (new): `make_check_support(deps)`, `budget_left()`, `JUDGE_ROLE = "screener"`,
  `MIN_BUDGET_USD = 0.01`. It rebuilds the prose context exactly as `write_synthesis` does (`_prose_context` over
  `_narrative_papers`), reads abstracts from `papers[].candidate.abstract`, and returns
  `{"support", "cost_usd", "errors", "quality"}`.
- **`app/graph/graph.py`**: the node in `_add_review_nodes` (so the Plan 22a eval graph has it too), edges
  `write_synthesis → check_support → finalize` beside `localize`.
- **`app/graph/nodes/synthesis.py`**: `_support_result` adds `display_aligned`; `finalize` writes `result.support`.
- **`app/harness/quality.py`**: `quality.support`.
- **`app/graph/nodes/stub_result.py`**: `_stub_support`.
- **`app/evals/metrics.py`, `app/evals/report.py`**: the two rates and report rows.
- **Frontend**: `src/lib/support.ts` (alignment, badge rule, states), `src/lib/types.ts`, `RC.support` in
  `src/lib/i18n-report.ts`, `CitedText`/`RefButtons`/`CheckedMark`/`SupportLegend` (`report-parts.tsx`), `KeyFindings`,
  `SourceRail` (`WhyCited`), `Report` (selection carries the claim id), `BottomLine` (the lead of a result without an
  answer).

## 6. Budget and cost

- One call per review (plus at most `max_repairs` repairs and one escalation on `repair_failed`), on the screener's
  model through `LimitedLLM`: the shared semaphore and the per-review budget apply as to every role.
- Size: a typical review has about 24 pairs, about 5,000 input tokens and under 1,000 output tokens; the worst case
  (30 pairs at the clip limits) is about 13,000 input tokens per attempt.
- Price on the `budget` preset (Qwen3.5 Flash $0.065/$0.26 per 1M; escalation Gemini 3.1 Flash Lite $0.25/$1.5): about
  $0.0005 typical; about $0.008 at most (three attempts and an escalation at the worst size).
- The smallest cap any review gets is $0.08 (5 papers, 20 candidates), so the check fits; with less than $0.01 left it
  is skipped (`skipped_budget`) and the labels are unknown.
- Latency: in a Thai review the check runs while the synthesis is localized (seconds of overlap); in an English review
  `localize` is immediate, so the judge call (typically a few seconds) adds to the total.

## 7. Failure modes

| Failure | Behaviour |
|---|---|
| No citation group and no key finding | No call; `judge: "none"`, `claims: []` |
| A cited paper has no abstract sentence (≥ 20 chars) | No pair; its citation has `label`/`evidence` null |
| A cited paper is not evidence | No pair; `not_evidence: true`; never a badge (engine and UI) |
| A claim restates a pooled value | No pair for it; `computed: true`; never a badge |
| More than 30 pairs | The first 30 judged; the rest keep their closest sentence, label null; `quality.support.over_cap` |
| Less than $0.01 left of the cap | No call; `skipped_budget`; labels null, closest sentences kept |
| The judge raises (provider error, budget exceeded, refusal) or no schema factory | `failed`; labels null; one line in `errors` |
| The judge answers garbage (wrong schema, unknown ids, bad sentence numbers) | Repair rounds, then escalation; the usable verdicts are kept (`incomplete`), none usable is `failed` |
| The check itself crashes | `support: null`, one line in `errors`, `quality.support.judge = "crashed"`; the review finishes |
| Translation moved, merged, repeated or dropped a group | That group gets no badge (section 8); `display_aligned: false` |
| A result stored before Plan 25 | No `support`: no badge, no "why cited" view, nothing else changes |

## 8. Localization mapping

The claims are English (`synthesis_en`); the summary a Thai reader sees is translated. The localizer must keep every
citation group (multiset check, restored by order only when safe), but Thai may move clauses.
- **Summary.** The shown text's groups are read with the same pattern. If their ref lists equal the English
  `markers` in order, group k is marker k. Otherwise a shown group is tied to the English group with the same ref list
  only when that list occurs exactly once in both texts; every other group gets no claim. So a badge can be missing,
  never misplaced. `display_aligned` records whether the order held.
- **Key findings.** Finding i is claim `k<i>`: localization translates statements in place and never touches `refs`.
- **English view of a Thai review.** It shows `synthesis_en`, whose groups are the English markers.
- **Lead of an old result.** When a result has no `answer`, the summary leads the bottom line and gets the same marks.

## 9. UI (DESIGN.md)

- **Inline:** after a checked `[Pn]` button, a small `ink` ✓ (`font-display` semibold 0.8em, `role="img"`, name "Pn
  ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้", title "ตรวจแล้ว"). Never colour alone. A muted legend line ("✓ ตรวจแล้ว: ประโยคที่ตรงกัน
  พบในบทคัดย่อของงานนั้น และตัวเลขผ่านการตรวจ แตะรหัสงานวิจัยเพื่อดูประโยค") follows the discussion, the lead or the key
  findings when one of them shows a mark.
- **Key findings:** a checked study chip reads "Pn ✓" (name "เปิด Pn (ตรวจแล้ว)").
- **Rail, "ทำไมจึงอ้างอิงงานนี้":** after the title and related-report note. One item per claim citing the paper, the one
  the reader came from first (`surface` fill, `aria-current`). State chip: checked "✓ ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้"
  (`ink` border); "บทคัดย่อรองรับ แต่ตัวเลขในประโยคยังไม่ผ่านการตรวจ"; "รองรับบางส่วน"; "ไม่พบประโยคที่รองรับ" (dashed `harm`
  border, `warn` text); "ประโยคนี้มีค่าที่ระบบคำนวณ จึงไม่ได้ตรวจกับบทคัดย่อ"; "งานนี้ไม่นับเป็นหลักฐาน จึงไม่ได้ตรวจ";
  "ยังไม่ได้ตรวจ". Then "ประโยคในรายงานที่ตรวจ (ภาษาอังกฤษ ก่อนแปล)" or "ผลสำคัญที่ตรวจ (…)", the English claim (`lang="en"`),
  "ประโยคในบทคัดย่อที่รองรับ" or "ประโยคในบทคัดย่อที่ใกล้เคียงที่สุด", the sentence in Source Serif 4 between quotes. A muted
  note: "ตรวจโดยโมเดลเทียบกับบทคัดย่อเท่านั้น ใช้ประกอบการอ่าน ไม่ใช่การรับรองผล".
- **Selection:** `Select` gains an optional `claim`; opening a citation from the discussion or a key finding passes its
  claim id so the rail lists it first. Existing callers are unchanged.
- **Not changed:** number faces (`VerifiedNumber`, `ComputedNumber`, `Hole`), the live stage, exports, print layout
  (the rail is not printed), DESIGN.md tokens. DESIGN.md gains the component and rail descriptions and a log row.

## 10. Eval

- `ReviewMetrics` gains `support_citations`, `support_judged`, `support_supported`, `support_verified` (evidence
  citations only); `aggregate` adds `support_rate` (supported / judged) and `support_verified_rate` (badge / evidence
  citations), Wilson 95% intervals over done runs; the harness report adds the rows "Sentence support: supported /
  judged citations" and "Citations with the ตรวจแล้ว badge" (the admin harness compare view picks them up through
  `summary_rows`). Runs before Plan 25 show "–".
- No gold standard: the rate measures how often the judge finds support, not whether it is right. A human check of a
  sample (Plan 22b style) is the way to validate the judge; not in this plan.
- Measuring on real reviews needs a paid batch on the 22a harness (`eval run` on the frozen pool with the new
  `prompt_version`): the owner's call, not this plan.

## 11. Docs

- `docs/api.md`: the `prompt_version` line, `result` keys, `quality.support`, and a "Sentence support (Plan 25)" section
  (claims, candidates, judge, badge rule, soft-fail, cost, `result.support` shape, the mapping rule, exports, eval).
- `DESIGN.md`: the rail's "ทำไมจึงอ้างอิงงานนี้", the "Checked citation" component, a decisions-log row.
- Roadmap row 25: built.
- After the merge (controller): a `CLAUDE.md` convention line.

## 12. Testing

All offline, fake LLMs only:
- **Core** (`tests/unit/test_support.py`): markers and ranges, claims and markers per sentence (abbreviations, a group
  after the full stop), finding claims, abstract sentences verbatim, the scorer (words, numbers, ties), the prose
  number rule, `claim_checks` (unverified and pooled), pairs (no abstract, not evidence, computed), judge items, the
  strict schema, verdict problems and usable verdicts, the badge rule in every branch.
- **Node** (`tests/unit/test_support_node.py`): one call on the screener bound to `SupportBatch` with candidate
  sentences only; labels, evidence and badges; not-evidence and pooled claims never judged; budget skip; judge error
  and no schema factory; an answer invalid after repairs keeps its usable verdicts; the cap; no claims, no call; a
  crash leaves `support` null; `finalize` writes `display_aligned`.
- **Graph** (`tests/unit/test_review_graph.py`): a full fake review carries `result.support` and `quality.support`,
  finalize runs once; the 50-paper budget test still sees 12 screener calls; the eval replay test still asks the
  planner for `OutcomeMatch` once.
- **Prompts** (`tests/unit/test_prompts_by_type.py`): the judge's two pins; every existing pin unchanged.
- **Stub and eval** (`tests/unit/test_support_stub.py`, `tests/unit/test_eval_metrics.py`).
- **Frontend** (`src/lib/support.test.ts`, `src/components/review/support.test.tsx`): alignment (in order, moved,
  repeated, none), finding claims, the badge never on not-evidence papers, every state's text, claims for a paper with
  the selected one first; in the full report: the mark and legend in the discussion, the rail view for a checked and an
  unsupported citation, the key-finding chip, not-evidence papers, a repeated group, the English view, a result
  without support.
- **Not automated:** a real judge's accuracy and latency (no real LLM calls in this plan). The controller's smoke check
  runs the scorer and the node with an inline fake inside the api container and checks the stub result: no spend.

## 13. Risks and open items

- **Judge accuracy.** A budget model may call a paraphrase unsupported or accept a loose match. Mitigations: only 2
  candidate sentences and the claim, the paper named, a strict schema, the badge also needs verified numbers, and
  unsupported is not shown inline. Validation needs a human-checked sample (a later plan) and a paid harness run.
- **Scorer misses.** If the supporting sentence is not among the 2 candidates (heavy paraphrase), the judge says
  unsupported. The rail then shows "the closest sentence", which lets the reader judge.
- **Over-trust.** A ✓ may read as "proven". The legend and the rail note say a model checked it against the abstract
  only; the badge needs both the judge and the number rule.
- **Marker drift in Thai.** If the localizer often moves or regroups citations, fewer badges show in Thai reports.
  `display_aligned` in results lets this be measured from stored results at no cost.
- **Cost drift.** The cap of 30 pairs and the clip limits bound the call; `quality.support` records what ran.
