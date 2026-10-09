"use client";

import { useId } from "react";
import { REVIEW_TYPE_LABEL, REVIEW_TYPES } from "@/lib/review-type";
import type { ReviewType } from "@/lib/types";

/** The review type, always visible (not folded into the extra options): it changes the whole report. */
export function ReviewTypePicker({ value, onChange, available }: {
  value: ReviewType; onChange: (t: ReviewType) => void; available?: string[] | null;
}) {
  const id = useId();
  const offered = REVIEW_TYPES.filter((t) => (available ?? []).includes(t));
  const options = offered.length ? offered : REVIEW_TYPES; // unknown status or an empty list: the static three
  return (
    <fieldset className="grid gap-2 text-[0.92rem]">
      <legend className="label mb-1.5">รูปแบบการทบทวน</legend>
      {options.map((t) => {
        const l = REVIEW_TYPE_LABEL[t];
        const selected = value === t;
        return (
          // The row is clickable as a whole, but only the name is the <label>, so the description (and the English name) do not
          // leak into label lookups, e.g. the topic field or the "Systematic review" study-type checkbox.
          <div key={t} onClick={() => onChange(t)}
            className={`flex min-h-11 cursor-pointer items-start has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary gap-2.5 rounded-sm border px-3 py-2.5 ${selected ? "border-primary" : "border-rule"}`}>
            <input type="radio" id={`${id}-${t}`} name={`${id}-review-type`} value={t} checked={selected}
              onChange={() => onChange(t)} onClick={(e) => e.stopPropagation()} aria-describedby={`${id}-${t}-d`}
              className="mt-1 size-4 flex-none accent-primary" />
            <span className="grid min-w-0 gap-0.5">
              <span>
                <label htmlFor={`${id}-${t}`} className="cursor-pointer font-display font-medium">{l.th}</label>
                {" "}<span className="text-muted">({l.en})</span>
              </span>
              <span id={`${id}-${t}-d`} className="text-sm text-muted">{l.description}</span>
            </span>
          </div>
        );
      })}
    </fieldset>
  );
}
