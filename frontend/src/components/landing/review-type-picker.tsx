"use client";

import { REVIEW_TYPE_LABEL, REVIEW_TYPES } from "@/lib/review-type";
import type { ReviewType } from "@/lib/types";

/** Display order of the scope form's step 2: the default (systematic) first, then the types that build on it. */
const ORDER: ReviewType[] = ["slr", "meta_analysis", "scoping", "narrative"];

/** Step 2 of the scope form: a native select, with the chosen type's description shown under it (the type changes the
 * whole report, so its meaning stays visible instead of hiding in the menu). */
export function ReviewTypePicker({ id, value, onChange, available }: {
  id: string; value: ReviewType; onChange: (t: ReviewType) => void; available?: string[] | null;
}) {
  const offered = ORDER.filter((t) => REVIEW_TYPES.includes(t) && (available ?? []).includes(t));
  const options = offered.length ? offered : ORDER; // unknown status or an empty list: the static four
  return (
    <div className="grid gap-1.5">
      <select
        id={id} value={value} onChange={(e) => onChange(e.target.value as ReviewType)} aria-describedby={`${id}-d`}
        className="min-h-11 w-full cursor-pointer rounded-sm border border-rule bg-ground px-3 py-2 text-[1rem] text-ink outline-none focus:border-primary"
      >
        {options.map((t) => (
          <option key={t} value={t}>{REVIEW_TYPE_LABEL[t].th} ({REVIEW_TYPE_LABEL[t].en})</option>
        ))}
      </select>
      <p id={`${id}-d`} className="text-sm text-muted">{REVIEW_TYPE_LABEL[value].description}</p>
    </div>
  );
}
