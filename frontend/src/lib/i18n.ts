import type { DesignCategory, Direction, EvidenceStrength, RiskOfBias } from "./types";
import { TERM_NAME as N } from "./term-names";

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
    // the word the home page teaches (RCT, Cohort, Case-control) or the shared Thai name (term-names.ts, final review I2)
    rct: "RCT", non_randomized_trial: N.nonRandomized.th, cohort: "Cohort", case_control: "Case-control",
    cross_sectional: N.crossSectional.th, case_series: N.caseSeries.th, mendelian_randomization: N.mendelian.en,
    sr_ma_rct: "SR/MA ของ RCT", sr_ma_observational: "SR/MA ของงานเชิงสังเกต", sr_ma_mixed: "SR/MA",
    narrative_review: N.narrativeReview.th, qualitative: N.qualitative.th, mixed_methods: N.mixedMethods.th,
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

// Shared labels and the site chrome (header, footer). The site header and footer follow `<html lang>` (lib/use-doc-lang),
// which a report sets to its own language (Plan 20 Task 7); the report's own copy is in lib/i18n-report.ts.
const STRINGS = {
  th: {
    notVerified: "ไม่ยืนยัน",
    home: "หน้าแรก",
    about: "API และ MCP",
    theme: "สลับธีม",
    sourceSentence: "ประโยคที่ใช้ยืนยัน",
    foundVerbatim: "พบในบทความตรงทุกตัวอักษร",
    review: "ทบทวนงานวิจัย",
    mainNav: "หลัก",
    useLight: "ใช้ธีมสว่าง",
    useDark: "ใช้ธีมมืด",
    light: "ธีมสว่าง",
    dark: "ธีมมืด",
    notAdvice: "ไม่ใช่คำแนะนำทางการแพทย์",
    footerNote: "ผลลัพธ์เป็นการทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติจากบทคัดย่อ ไม่ใช้แทนการวินิจฉัยหรือการรักษา ตรวจกับบทความต้นฉบับและผู้เชี่ยวชาญก่อนนำไปใช้",
    dataSources: "แหล่งข้อมูล",
    footerNav: "ท้ายหน้า",
    site: "เว็บไซต์",
    free: "ใช้ฟรี ไม่ต้องสมัคร",
  },
  en: {
    notVerified: "not verified",
    home: "Home",
    about: "API & MCP",
    theme: "Switch theme",
    sourceSentence: "Source sentence",
    foundVerbatim: "Found verbatim in the paper",
    review: "Literature review",
    mainNav: "Main",
    useLight: "Use the light theme",
    useDark: "Use the dark theme",
    light: "Light theme",
    dark: "Dark theme",
    notAdvice: "Not medical advice",
    footerNote: "Results are an automated rapid review of abstracts. They do not replace a diagnosis or treatment; check the original papers and an expert before using them.",
    dataSources: "Data sources",
    footerNav: "Footer",
    site: "Site",
    free: "free, no sign-up",
  },
} as const;

export type StringKey = keyof (typeof STRINGS)["th"];

export function t(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key];
}

// Literature-matrix column headings live in lib/lit-matrix.ts (`litColumnLabel`, per framework: PICO, PCC, PICo, SPIDER).
