import type { DesignCategory, Direction, EvidenceStrength, RiskOfBias } from "./types";

export type Lang = "th" | "en";

export const DIRECTION_LABEL: Record<Lang, Record<Direction, string>> = {
  th: { positive: "สนับสนุนผล", negative: "ตรงข้าม/อันตราย", null: "ไม่มีความสัมพันธ์", mixed: "ผสม", unclear: "ไม่ชัด" },
  en: { positive: "Supports", negative: "Opposite / harm", null: "No association", mixed: "Mixed", unclear: "Unclear" },
};

/** Fixed display order of directions (never ranked by count). Re-exported by live-evidence.ts. */
export const DIRECTION_ORDER: Direction[] = ["positive", "negative", "null", "mixed", "unclear"];

export const STRENGTH_LABEL: Record<Lang, Record<EvidenceStrength, string>> = {
  th: { high: "สูง", moderate: "ปานกลาง", low: "ต่ำ", very_low: "ต่ำมาก" },
  en: { high: "High", moderate: "Moderate", low: "Low", very_low: "Very low" },
};

export const DESIGN_LABEL: Record<Lang, Record<DesignCategory, string>> = {
  th: {
    rct: "RCT", non_randomized_trial: "การทดลองแบบไม่สุ่ม", cohort: "Cohort", case_control: "Case-control",
    cross_sectional: "ภาคตัดขวาง", case_series: "รายงานกลุ่มผู้ป่วย", mendelian_randomization: "Mendelian randomization",
    sr_ma_rct: "SR/MA ของ RCT", sr_ma_observational: "SR/MA ของงานเชิงสังเกต", sr_ma_mixed: "SR/MA",
    narrative_review: "บทความทบทวน (ไม่เป็นระบบ)", qualitative: "เชิงคุณภาพ", mixed_methods: "ผสมผสาน (Mixed methods)",
    other: "อื่น ๆ",
  },
  en: {
    rct: "RCT", non_randomized_trial: "Non-randomised trial", cohort: "Cohort", case_control: "Case-control",
    cross_sectional: "Cross-sectional", case_series: "Case series", mendelian_randomization: "Mendelian randomization",
    sr_ma_rct: "SR/MA of RCTs", sr_ma_observational: "SR/MA of observational studies", sr_ma_mixed: "SR/MA",
    narrative_review: "Narrative review", qualitative: "Qualitative", mixed_methods: "Mixed methods", other: "Other",
  },
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

/** Column headings of the literature review matrix. */
export const LIT_COLUMN_LABEL: Record<Lang, Record<"ref" | "design" | "population" | "exposure" | "comparator" | "outcomes" | "findings" | "direction" | "risk" | "n" | "citedBy" | "limitations", string>> = {
  th: {
    ref: "ผู้แต่ง/ปี", design: "รูปแบบการศึกษา", population: "ประชากร", exposure: "สิ่งที่ศึกษา/สิ่งสัมผัส",
    comparator: "ตัวเปรียบเทียบ", outcomes: "ผลลัพธ์", findings: "ข้อค้นพบหลัก", direction: "ทิศทาง",
    risk: "ความเสี่ยงอคติ", n: "n", citedBy: "ถูกอ้างอิง", limitations: "ข้อจำกัด",
  },
  en: {
    ref: "Author/year", design: "Study design", population: "Population", exposure: "Intervention/exposure",
    comparator: "Comparator", outcomes: "Outcomes", findings: "Key findings", direction: "Direction",
    risk: "Risk of bias", n: "n", citedBy: "Cited by", limitations: "Limitations",
  },
};
