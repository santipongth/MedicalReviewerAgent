import type { Direction, EvidenceStrength, RiskOfBias } from "./types";

export type Lang = "th" | "en";

export const DIRECTION_LABEL: Record<Lang, Record<Direction, string>> = {
  th: { positive: "สนับสนุนผล", negative: "ตรงข้าม/อันตราย", null: "ไม่มีความสัมพันธ์", mixed: "ผสม", unclear: "ไม่ชัด" },
  en: { positive: "Supports", negative: "Opposite / harm", null: "No association", mixed: "Mixed", unclear: "Unclear" },
};

export const STRENGTH_LABEL: Record<Lang, Record<EvidenceStrength, string>> = {
  th: { high: "สูง", moderate: "ปานกลาง", low: "ต่ำ", very_low: "ต่ำมาก" },
  en: { high: "High", moderate: "Moderate", low: "Low", very_low: "Very low" },
};

export const ROB_LABEL: Record<Lang, Record<RiskOfBias, string>> = {
  th: { low: "ต่ำ", moderate: "ปานกลาง", high: "สูง", unclear: "ไม่ชัด" },
  en: { low: "Low", moderate: "Moderate", high: "High", unclear: "Unclear" },
};

const STRINGS = {
  th: {
    notVerified: "ไม่ยืนยัน",
    home: "หน้าแรก",
    about: "API และ MCP",
    theme: "สลับธีม",
    sourceSentence: "ประโยคที่ใช้ยืนยัน",
    foundVerbatim: "พบในบทความตรงทุกตัวอักษร",
  },
  en: {
    notVerified: "not verified",
    home: "Home",
    about: "API & MCP",
    theme: "Switch theme",
    sourceSentence: "Source sentence",
    foundVerbatim: "Found verbatim in the paper",
  },
} as const;

export type StringKey = keyof (typeof STRINGS)["th"];

export function t(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key];
}
