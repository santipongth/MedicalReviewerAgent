"use client";

import { useId, type ReactNode } from "react";
import { AUDIENCES, showsApplicability, showsPublicGuide, type Audience, type LearnerNoteId } from "@/lib/audience";
import type { Lang } from "@/lib/i18n";
import { RC } from "@/lib/i18n-report";
import { harmsGap, needsDosingNotice } from "@/lib/safety";
import type { ReviewResult } from "@/lib/types";
import { L, Lw } from "./text";

const A = RC.audience;
const S = RC.safety;
const BOX = "grid max-w-[70ch] gap-1.5 rounded-sm px-4 py-3 text-[0.92rem] leading-[1.7]";
const CHIP =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border border-rule bg-ground px-3 py-1.5 font-display text-[0.9rem] hover:border-ink has-[:checked]:border-primary has-[:checked]:bg-rail";

/** Plan 26: who the report is laid out for. Only the presentation changes (lib/audience.ts); not printed. */
export function AudienceSwitch({ value, onChange, lang }: { value: Audience; onChange: (a: Audience) => void; lang: Lang }) {
  const id = useId();
  return (
    <fieldset className="grid gap-2 print:hidden" data-audience-switch aria-describedby={`${id}-hint`}>
      <legend className="label mb-1 p-0">{L(lang, A.legend)}</legend>
      <div className="flex flex-wrap gap-2">
        {AUDIENCES.map((a) => (
          <label key={a} className={CHIP}>
            <input type="radio" name={`${id}-audience`} value={a} checked={value === a} onChange={() => onChange(a)}
              className="size-4 accent-primary" />
            {Lw(lang, A.name[a])}
          </label>
        ))}
      </div>
      <p id={`${id}-hint`} className="text-[0.85rem] text-muted">{L(lang, A.hint)}</p>
    </fieldset>
  );
}

function Notice({ label, tone, children, kind }: { label: string; tone: string; children: ReactNode; kind: string }) {
  return (
    <aside aria-label={label} className={`${BOX} ${tone}`} data-notice={kind}>
      <p className="label">{label}</p>
      {children}
    </aside>
  );
}

/**
 * The notices under the title block: the public guide (public view), the dosing notice and the harms gap (every view,
 * when they apply), and the Thai-practice note (bedside and committee). Fixed copy; the report text is never rewritten.
 */
export function ReportNotices({ result, audience, lang, hasPapers, guideLabel }: {
  result: ReviewResult; audience: Audience; lang: Lang; hasPapers: boolean;
  /** the guide's heading where the page is not a report (the quick answer); the body text is the same */
  guideLabel?: string;
}) {
  const gap = hasPapers ? harmsGap(result) : null;
  const dosing = hasPapers && needsDosingNotice(result);
  const guide = showsPublicGuide(audience);
  const applicability = hasPapers && showsApplicability(audience);
  if (!guide && !gap && !dosing && !applicability) return null;
  return (
    <div className="grid gap-3" data-report-notices>
      {guide && (
        <Notice label={guideLabel ?? L(lang, A.guideLabel)} tone="bg-info-bg" kind="guide">
          <ul className="grid list-disc gap-1 pl-5">
            <li>{L(lang, A.guideGroups)}</li>
            <li>{L(lang, A.guideCertainty)}</li>
            <li>{L(lang, A.guideDoctor)}</li>
          </ul>
        </Notice>
      )}
      {dosing && (
        <Notice label={L(lang, S.dosingLabel)} tone="bg-warn-bg" kind="dosing">
          <p>{L(lang, S.dosing)}</p>
        </Notice>
      )}
      {gap && (
        <Notice label={L(lang, S.harmsLabel)} tone="bg-warn-bg" kind="harms">
          <p>{L(lang, gap.reporting ? S.harms(gap.reporting, gap.studies) : S.harmsNone)}</p>
        </Notice>
      )}
      {applicability && (
        <Notice label={L(lang, A.applicabilityLabel)} tone="bg-rail" kind="applicability">
          <p>{L(lang, A.applicability)}</p>
        </Notice>
      )}
    </div>
  );
}

/** A learning note after a section (learner view): what the section shows and how to read it. */
export function LearnerNote({ id, lang }: { id: LearnerNoteId; lang: Lang }) {
  return (
    <Notice label={`${L(lang, A.learnLabel)}: ${L(lang, A.learnTopic[id])}`} tone="bg-rail" kind={`learn-${id}`}>
      <p>{L(lang, A.learn[id])}</p>
    </Notice>
  );
}
