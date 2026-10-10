import { STRENGTH_LABEL, type Lang } from "@/lib/i18n";
import type { EvidenceStrength } from "@/lib/types";
import { L } from "./text";

const LEVELS: EvidenceStrength[] = ["very_low", "low", "moderate", "high"];

/**
 * GRADE-style certainty: four circles, the first n marked with a plus (⊕⊕◯◯ = low), drawn in ink (never a finding
 * colour), plus the level as text. The circles are decoration; the accessible name is the level's words.
 */
export function CertaintyMark({ level, lang, label = true, className = "" }: {
  level: EvidenceStrength; lang: Lang; label?: boolean; className?: string;
}) {
  const n = LEVELS.indexOf(level) + 1;
  const name = L(lang, `ความแข็งแรงของหลักฐาน${STRENGTH_LABEL.th[level]}`, `${STRENGTH_LABEL.en[level]} certainty`);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`} data-certainty={level}>
      <svg aria-hidden="true" width="58" height="13" viewBox="0 0 58 13" className="shrink-0">
        {LEVELS.map((l, i) => (
          <g key={l} transform={`translate(${i * 15 + 1} 1)`} fill="none" strokeWidth="1.4"
            stroke={i < n ? "var(--ink)" : "var(--muted)"}>
            <circle cx="5.5" cy="5.5" r="5" fill={i < n ? "var(--ink)" : "none"} />
            {i < n && <path d="M5.5 2.5v6M2.5 5.5h6" stroke="var(--surface)" strokeWidth="1.6" />}
          </g>
        ))}
      </svg>
      {label ? <span>{STRENGTH_LABEL[lang][level]}</span> : <span className="sr-only">{name}</span>}
    </span>
  );
}
