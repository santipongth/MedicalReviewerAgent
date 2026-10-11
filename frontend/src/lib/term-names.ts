// One name per term (Plan 20 final review I2). The home page's inline glosses (`GLOSS`), the report's tap-to-open
// glossary (`GLOSSARY`), the design labels (`DESIGN_LABEL`) and the review-type labels (`REVIEW_TYPE_LABEL`) all take
// a shared term's name from here, so a reader meets the same Thai name on the home page and in the report. The names
// are the plainest correct Thai for a reader who is not a researcher. Pure data with no imports: `i18n.ts` (eager
// chunk) imports it, so the long explanations stay in `glossary.ts`. Parity is pinned in `glossary.test.ts`.

type Bi = { th: string; en: string };

/** The name of each shared term ("RCT" is named "การทดลองแบบสุ่มและมีกลุ่มควบคุม"). No brackets: names sit in brackets. */
export const TERM_NAME = {
  // Review types
  slr: { th: "การทบทวนวรรณกรรมอย่างเป็นระบบ", en: "systematic review" },
  metaAnalysis: { th: "การวิเคราะห์อภิมาน", en: "meta-analysis" },
  scopingReview: { th: "การทบทวนขอบเขต", en: "scoping review" },
  narrativeReview: { th: "การทบทวนแบบบรรยาย", en: "narrative review" },
  // Study designs
  rct: { th: "การทดลองแบบสุ่มและมีกลุ่มควบคุม", en: "randomised controlled trial" },
  nonRandomized: { th: "การทดลองแบบไม่สุ่ม", en: "non-randomised trial" },
  cohort: { th: "การศึกษาติดตามกลุ่มคน", en: "cohort study" },
  caseControl: { th: "การศึกษาเทียบผู้ป่วยกับผู้ไม่ป่วย", en: "case-control study" },
  crossSectional: { th: "การสำรวจ ณ จุดเวลาเดียว", en: "cross-sectional study" },
  caseSeries: { th: "รายงานกลุ่มผู้ป่วย", en: "case series" },
  mendelian: { th: "การสุ่มแบบเมนเดเลียน", en: "Mendelian randomization" },
  qualitative: { th: "การวิจัยเชิงคุณภาพ", en: "qualitative research" },
  mixedMethods: { th: "การวิจัยแบบผสมผสาน", en: "mixed-methods research" },
  // Grading
  evidenceStrength: { th: "ความแข็งแรงของหลักฐาน", en: "evidence strength" },
} satisfies Record<string, Bi>;

/** Terms both pages write as the word itself (an acronym, or a Thai term); the explanation differs by page. */
export const TERM_WORD = {
  pico: { th: "PICO", en: "PICO" },
  pcc: { th: "PCC", en: "PCC" },
  prisma: { th: "PRISMA", en: "PRISMA" },
  ci95: { th: "95% CI", en: "95% CI" },
  logScale: { th: "log scale", en: "log scale" },
  riskOfBias: { th: "ความเสี่ยงอคติ", en: "risk of bias" },
} satisfies Record<string, Bi>;

/** The parts of a PICO question, in order. */
export const PICO_PARTS: Record<"th" | "en", string[]> = {
  th: ["ผู้ป่วย", "สิ่งที่ให้", "สิ่งเปรียบเทียบ", "ผลลัพธ์"],
  en: ["Population", "Intervention", "Comparison", "Outcome"],
};

/** The parts of a PCC (scoping) question, in order: who, what, in which setting. */
export const PCC_PARTS: Record<"th" | "en", string[]> = {
  th: ["ใคร", "เรื่องอะไร", "ในบริบทไหน"],
  en: ["Population", "Concept", "Context"],
};

/** "Cohort study" → "Cohort study"; "randomised controlled trial" → "Randomised controlled trial" (a label's first word). */
export function capitalised(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
