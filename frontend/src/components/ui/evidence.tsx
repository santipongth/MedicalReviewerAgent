import type { ReactNode } from "react";
import { DIRECTION_LABEL, t, type Lang } from "@/lib/i18n";
import type { Direction } from "@/lib/types";

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

/** A value the verifier blanked: shown as a visible gap, never hidden or estimated. */
export function Hole({ lang, className = "" }: { lang: Lang; className?: string }) {
  return <span className={`hole ${className}`}>{t(lang, "notVerified")}</span>;
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
