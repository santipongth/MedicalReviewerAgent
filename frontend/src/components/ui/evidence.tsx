import type { ReactNode } from "react";
import { DIRECTION_LABEL, t, type Lang } from "@/lib/i18n";
import type { Direction } from "@/lib/types";
import { L } from "@/components/review/text";
import { Term } from "./term";

/** A number that passed verification against the paper text. Never use this for an unverified value. */
export function VerifiedNumber({
  value,
  onSelect,
  pending = false,
  title,
  className = "",
}: {
  value: ReactNode;
  onSelect?: () => void;
  pending?: boolean;
  title?: string;
  className?: string;
}) {
  const props = { className: `num-verified ${className}`, ...(pending ? { "data-pending": "true" } : {}) };
  if (onSelect && !pending) {
    return (
      <button type="button" {...props} onClick={onSelect} title={title}
        className={`${props.className} cursor-pointer text-inherit hover:text-primary`}>
        {value}
      </button>
    );
  }
  return <span {...props}>{value}</span>;
}

/**
 * A number the system computed (Plan 14b pooled analysis: pooled estimate, its CI, I², τ², SE, weights), never one
 * read from a paper. Bai Jamjuree tabular figures with no verified tape, plus a small "คำนวณ" tag. Its accessible
 * name always says it is computed, also when the visible tag is left off (a table column already headed as computed).
 */
export function ComputedNumber({ value, lang = "th", tag = true, className = "" }: {
  value: string; lang?: Lang; tag?: boolean; className?: string;
}) {
  const name = `${value} ${L(lang, "(คำนวณโดยระบบ ไม่ใช่ตัวเลขจากงานวิจัย)", "(computed by the system, not a number from a study)")}`;
  return (
    <span role="img" aria-label={name} title={L(lang, "คำนวณโดยระบบ", "Computed by the system")}
      className={`num-computed ${className}`} data-computed="true">
      <span>{value}</span>
      {tag && <span className="computed-tag">{L(lang, "คำนวณ", "computed")}</span>}
    </span>
  );
}

/** A value the verifier blanked: shown as a visible gap, never hidden or estimated. */
export function Hole({ lang, className = "", explain = false }: { lang: Lang; className?: string; explain?: boolean }) {
  const slot = <span className={`hole ${className}`}>{t(lang, "notVerified")}</span>;
  if (!explain) return slot;
  return (
    <>
      {slot} <Term k="notVerified" lang={lang}>{L(lang, "ทำไม?", "why?")}</Term>
    </>
  );
}

/** SVG path data of the uncertain flag (12x12 box), shared with the live stage reader pool. */
export const FLAG_PATHS = ["M2 1h1.5v10H2z", "M3.5 1.5h6l-1.8 2.5 1.8 2.5h-6z"] as const;

/** Marks a study whose direction the two models read differently. Warning flag, not the harm glyph. */
export function UncertainFlag({ lang = "th", label }: { lang?: Lang; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-warn">
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <path d={FLAG_PATHS[0]} />
        <path d={FLAG_PATHS[1]} />
      </svg>
      <span>{label ?? L(lang, "สองโมเดลอ่านต่างกัน", "models disagree")}</span>
    </span>
  );
}

const GLYPH_CLASS: Record<Direction, string> = {
  positive: "g g-sup",
  negative: "g g-harm",
  null: "g g-none",
  mixed: "g g-mixed",
  unclear: "g g-unclear",
};

/** Finding direction: color always paired with a shape and an accessible name. */
export function Glyph({ direction, lang, className = "" }: { direction: Direction; lang: Lang; className?: string }) {
  const d = GLYPH_CLASS[direction] ? direction : "unclear";
  return <i role="img" aria-label={DIRECTION_LABEL[lang][d]} className={`${GLYPH_CLASS[d]} ${className}`} />;
}
