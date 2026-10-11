import { PCC_PARTS, PICO_PARTS, TERM_NAME as N, TERM_WORD as W } from "./term-names";

export type TermKey =
  | "pico" | "evidenceStrength" | "riskOfBias"
  | "rct" | "nonRandomized" | "cohort" | "caseControl" | "crossSectional" | "caseSeries"
  | "mendelian" | "srma" | "narrativeReview" | "metaAnalysis" | "heterogeneity"
  | "hr" | "or" | "rr" | "md" | "smd" | "rd" | "ci95"
  | "pcc" | "slr" | "scopingReview"
  | "logScale" | "prisma" | "relevance" | "notVerified" | "uncertain" | "directionTally" | "studyDesign"
  | "citationNetwork";

type Bi = { th: string; en: string };

/** "a b c และ d" / "a, b, c and d". */
const listTh = (xs: string[]) => `${xs.slice(0, -1).join(" ")} และ${xs[xs.length - 1]}`;
const listEn = (xs: string[]) => `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/**
 * Plain-language explanations shown by <Term>. Bodies describe concepts only, never findings. A term the home page also
 * glosses takes its label from `term-names.ts` (one name per term, final review I2).
 */
export const GLOSSARY: Record<TermKey, { label: Bi; body: Bi }> = {
  pico: {
    label: W.pico,
    body: {
      th: `กรอบแบ่งคำถามวิจัยเป็น 4 ส่วน คือ ${listTh(PICO_PARTS.th)}ที่สนใจ`,
      en: `A frame that splits a clinical question into ${listEn(PICO_PARTS.en)}.`,
    },
  },
  pcc: {
    label: W.pcc,
    body: {
      th: `กรอบแบ่งคำถามของ${N.scopingReview.th}เป็น 3 ส่วน คือ ${listTh(PCC_PARTS.th)} ใช้สำรวจว่ามีงานวิจัยอะไรบ้าง`,
      en: `A frame for scoping-review questions: ${listEn(PCC_PARTS.en)}. It is used to map what research exists.`,
    },
  },
  slr: {
    label: N.slr,
    body: {
      th: "ค้นและคัดกรองงานวิจัยตามเกณฑ์ที่กำหนดไว้ล่วงหน้า รายงานขั้นตอนแบบ PRISMA และประเมินความแข็งแรงของหลักฐาน รายงานนี้ทำโดยเอเจนต์อัตโนมัติจากบทคัดย่อเท่านั้น",
      en: "Searches and screens studies by criteria set in advance, reports the steps as PRISMA and grades the evidence. This one is done automatically by an agent from abstracts only.",
    },
  },
  scopingReview: {
    label: N.scopingReview,
    body: {
      th: "สำรวจว่ามีงานวิจัยอะไร ชนิดใด ปีใด ในหัวข้อหนึ่ง ไม่ประเมินคุณภาพของแต่ละงาน และไม่สรุปว่าได้ผลหรือไม่",
      en: "Maps what research exists on a topic, of which kinds and from which years. It does not appraise quality or conclude whether something works.",
    },
  },
  evidenceStrength: {
    label: N.evidenceStrength,
    body: {
      th: "ระดับความมั่นใจว่าผลที่พบใกล้ความจริงแค่ไหน ดูจากชนิดงานวิจัย จำนวน และความสอดคล้องของผล",
      en: "How confident we can be that the observed effect is close to the truth, based on study design, number of studies and consistency.",
    },
  },
  riskOfBias: {
    label: W.riskOfBias,
    body: {
      th: "โอกาสที่วิธีทำงานวิจัยจะทำให้ผลเบี้ยวไปจากความจริง เช่น ไม่สุ่มกลุ่ม หรือผู้ประเมินรู้ว่าใครได้รับการรักษา",
      en: "The chance that how a study was run pushed its results away from the truth, for example unblinded assessors or non-random grouping.",
    },
  },
  rct: {
    label: N.rct,
    body: {
      th: "ผู้เข้าร่วมถูกสุ่มเข้ากลุ่มรักษาหรือกลุ่มเปรียบเทียบ ช่วยให้สองกลุ่มใกล้เคียงกันมากที่สุด",
      en: "Participants are randomly assigned to treatment or comparison, so the groups are as alike as possible.",
    },
  },
  nonRandomized: {
    label: N.nonRandomized,
    body: {
      th: "มีการให้การรักษา แต่ผู้วิจัยไม่ได้สุ่มกลุ่ม ผลจึงอาจถูกกลุ่มที่ต่างกันตั้งแต่ต้นรบกวน",
      en: "A treatment is given but groups are not assigned at random, so differences present from the start may distort the result.",
    },
  },
  cohort: {
    label: N.cohort,
    body: {
      th: "ติดตามคนกลุ่มหนึ่งไปตามเวลา แล้วดูว่าใครเกิดผลลัพธ์ที่สนใจ โดยไม่ได้เป็นผู้กำหนดว่าใครได้รับสิ่งนั้น",
      en: "Follows a group of people over time to see who develops the outcome, without assigning the exposure.",
    },
  },
  caseControl: {
    label: N.caseControl,
    body: {
      th: "เริ่มจากคนที่มีผลลัพธ์แล้วกับคนที่ไม่มี แล้วย้อนดูว่าใครเคยได้รับสิ่งที่สนใจมากกว่ากัน",
      en: "Starts from people who have the outcome and people who do not, then looks back at who was exposed.",
    },
  },
  crossSectional: {
    label: N.crossSectional,
    body: {
      th: "วัดทุกอย่างในเวลาเดียว เหมือนถ่ายภาพหนึ่งช็อต จึงบอกลำดับก่อนหลังของเหตุและผลไม่ได้",
      en: "Measures everything at one point in time, like a snapshot, so it cannot show which came first.",
    },
  },
  caseSeries: {
    label: N.caseSeries,
    body: {
      th: "บรรยายผู้ป่วยจำนวนหนึ่งที่ได้รับการรักษาแบบเดียวกัน โดยไม่มีกลุ่มเปรียบเทียบ",
      en: "Describes a set of patients who received the same care, with no comparison group.",
    },
  },
  mendelian: {
    label: N.mendelian,
    body: {
      th: "ใช้ความแปรผันของยีนที่ติดตัวมาแต่กำเนิดเป็นตัวแทนของปัจจัยที่สนใจ เพื่อลดผลจากปัจจัยแทรกซ้อน",
      en: "Uses genetic variants inherited at birth as a stand-in for an exposure, to reduce the effect of confounding.",
    },
  },
  srma: {
    label: { th: `${N.slr.th}และ${N.metaAnalysis.th}`, en: `${N.slr.en} / ${N.metaAnalysis.en}` },
    body: {
      th: "รวบรวมงานวิจัยหลายชิ้นตามขั้นตอนที่กำหนดไว้ และอาจรวมผลทางสถิติเข้าด้วยกัน",
      en: "Collects many studies by a fixed procedure and may pool their results statistically.",
    },
  },
  metaAnalysis: {
    label: N.metaAnalysis,
    body: {
      th: "การทบทวนวรรณกรรมอย่างเป็นระบบที่รวมขนาดผลของงานวิจัยหลักซึ่งวัดผลแบบเดียวกันเป็นค่าเดียว ในรายงานนี้ระบบคำนวณค่ารวมเองจากตัวเลขที่ตรวจกับบทคัดย่อแล้ว ค่ารวมจึงไม่ใช่ตัวเลขจากงานวิจัยฉบับใด",
      en: "A systematic review that combines the effect sizes of primary studies measuring the same thing into one estimate. Here the system computes it from numbers checked against the abstracts, so the pooled value is not a number from any single study.",
    },
  },
  heterogeneity: {
    label: { th: "ความแตกต่างระหว่างงานวิจัย (I², τ²)", en: "heterogeneity (I², τ²)" },
    body: {
      th: "I² คือสัดส่วนของความแปรปรวนที่มาจากความต่างจริงระหว่างงานวิจัย ไม่ใช่ความบังเอิญ ตั้งแต่ 50% ขึ้นไปถือว่าต่างกันมาก τ² คือความแปรปรวนระหว่างงานวิจัยบนสเกลที่ใช้คำนวณ Q คือค่าทดสอบความแตกต่าง",
      en: "I² is the share of the variation that comes from real differences between studies rather than chance; 50% or more counts as substantial. τ² is the between-study variance on the analysis scale. Q is the heterogeneity test statistic.",
    },
  },
  narrativeReview: {
    label: N.narrativeReview,
    body: {
      th: "ผู้เขียนสรุปงานวิจัยตามที่เลือกมา ไม่มีขั้นตอนค้นหาที่ตายตัว จึงอาจเอนเอียงตามที่ผู้เขียนเลือก",
      en: "An author's summary of selected studies without a fixed search method, so it may lean toward what the author chose.",
    },
  },
  hr: {
    label: { th: "HR (hazard ratio)", en: "HR (hazard ratio)" },
    body: {
      th: "อัตราส่วนความเร็วที่เหตุการณ์เกิดขึ้นระหว่างสองกลุ่ม ค่าต่ำกว่า 1 แปลว่ากลุ่มแรกเกิดช้ากว่า",
      en: "The ratio of how fast events happen in two groups. Below 1 means the first group has events more slowly.",
    },
  },
  or: {
    label: { th: "OR (odds ratio)", en: "OR (odds ratio)" },
    body: {
      th: "อัตราส่วนของโอกาสเกิดต่อไม่เกิดระหว่างสองกลุ่ม ค่าต่ำกว่า 1 แปลว่ากลุ่มแรกมีโอกาสเกิดน้อยกว่า",
      en: "The ratio of the odds of an event between two groups. Below 1 means the first group has lower odds.",
    },
  },
  rr: {
    label: { th: "RR (risk ratio)", en: "RR (risk ratio)" },
    body: {
      th: "อัตราส่วนของความเสี่ยงที่จะเกิดเหตุการณ์ระหว่างสองกลุ่ม ค่าต่ำกว่า 1 แปลว่ากลุ่มแรกเสี่ยงน้อยกว่า",
      en: "The ratio of the risk of an event between two groups. Below 1 means the first group is at lower risk.",
    },
  },
  md: {
    label: { th: "MD (mean difference)", en: "MD (mean difference)" },
    body: {
      th: "ผลต่างของค่าเฉลี่ยระหว่างสองกลุ่ม ในหน่วยเดียวกับที่วัด",
      en: "The difference between the averages of two groups, in the unit that was measured.",
    },
  },
  smd: {
    label: { th: "SMD (standardized mean difference)", en: "SMD (standardized mean difference)" },
    body: {
      th: "ผลต่างของค่าเฉลี่ยที่ปรับให้ไม่มีหน่วย ใช้เทียบงานที่วัดด้วยเครื่องมือคนละแบบ",
      en: "A unit-free difference between averages, used to compare studies that measured with different instruments.",
    },
  },
  rd: {
    label: { th: "RD (risk difference)", en: "RD (risk difference)" },
    body: {
      th: "ผลต่างของสัดส่วนคนที่เกิดเหตุการณ์ระหว่างสองกลุ่ม",
      en: "The difference in the share of people who had the event between two groups.",
    },
  },
  ci95: {
    label: W.ci95,
    body: {
      th: "ช่วงที่ค่าจริงน่าจะอยู่ ช่วงแคบแปลว่าประมาณค่าได้แม่น ถ้าคร่อมค่าที่แปลว่าไม่มีผล งานนี้ยังฟันธงไม่ได้",
      en: "The range where the true value likely lies. A narrow range means a precise estimate; if it spans the no-effect value, the study cannot settle the question.",
    },
  },
  logScale: {
    label: W.logScale,
    body: {
      th: "แกนที่ระยะเท่ากันแทนการคูณเท่ากัน ใช้กับอัตราส่วน เพื่อให้ค่าที่เป็นสองเท่าและครึ่งหนึ่งอยู่ห่างจากเส้นไม่มีผลเท่ากัน",
      en: "An axis where equal distances mean equal multiples. It is used for ratios so that doubling and halving sit equally far from the no-effect line.",
    },
  },
  prisma: {
    label: W.prisma,
    body: {
      th: "แผนภาพแสดงว่างานวิจัยถูกค้นพบ คัดออก และเหลือไว้อ่านที่ขั้นตอนไหนบ้าง",
      en: "A diagram showing how many studies were found, screened out and kept at each step.",
    },
  },
  relevance: {
    label: { th: "คะแนนความเกี่ยวข้อง", en: "relevance score" },
    body: {
      th: "คะแนน 0–100 ที่เอเจนต์ให้ตอนคัดกรอง ว่างานวิจัยตอบคำถามนี้ตรงแค่ไหน",
      en: "A 0–100 score the agent gave during screening for how directly a study answers this question.",
    },
  },
  notVerified: {
    label: { th: "ไม่ยืนยัน", en: "not verified" },
    body: {
      th: "ตัวเลขนี้ถูกซ่อนเพราะตรวจกับต้นฉบับไม่ผ่าน ระบบไม่เดาค่าแทน",
      en: "This number is hidden because it did not match the source text. The system never guesses a replacement.",
    },
  },
  uncertain: {
    label: { th: "สองโมเดลอ่านต่างกัน", en: "models disagree" },
    body: {
      th: "โมเดลสองตัวอ่านทิศทางผลของงานนี้ไม่ตรงกัน ควรอ่านประโยคต้นฉบับเอง",
      en: "Two models read this study's direction of effect differently. Read the source sentence yourself.",
    },
  },
  directionTally: {
    label: { th: "จำนวนตามทิศทางผล", en: "direction tally" },
    body: {
      th: "นับจำนวนงานวิจัยตามทิศทางผลโดยรวมที่เอเจนต์อ่าน ไม่ใช่ผลรวมทางสถิติ",
      en: "A count of studies by the overall direction of effect the agent read. It is not a statistical pooled result.",
    },
  },
  studyDesign: {
    label: { th: "รูปแบบการศึกษา", en: "study design" },
    body: {
      th: "วิธีที่งานวิจัยเก็บข้อมูล เช่น ทดลองแบบสุ่ม ติดตามกลุ่ม หรือรวบรวมงานวิจัยอื่น รูปแบบต่างกันน่าเชื่อถือไม่เท่ากัน",
      en: "How a study gathered its data, for example a randomised trial, a cohort follow-up or a review of other studies. Designs differ in how much weight they can bear.",
    },
  },
  citationNetwork: {
    label: { th: "เครือข่ายการอ้างอิง", en: "citation network" },
    body: {
      th: "ภาพว่างานใดในรีวิวนี้อ้างอิงงานใด จากรายการอ้างอิงใน OpenAlex หรือ Europe PMC ถ้างานใดไม่มีข้อมูล ไม่ได้แปลว่างานนั้นไม่อ้างอิงงานอื่น การถูกอ้างอิงมากไม่ได้แปลว่างานนั้นถูกต้อง",
      en: "Which studies in this review cite which, from the reference lists in OpenAlex or Europe PMC. A study with no data may still cite others, and being cited often does not make a study right.",
    },
  },
};

/**
 * Inline glosses for readers who are not researchers (home and About pages, Plan 20 Task 12): a term is shown as
 * "term (name)" at its first use in a section, or "term (name — plain)" when the plain words are wanted too.
 * `term` is the word as the page writes it, `name` its short meaning (the Thai name, or plain Thai when the term is
 * already Thai), `plain` an optional one-phrase explanation. No brackets inside `name` or `plain`: they sit in brackets.
 * The report's tap-to-open explanations stay in GLOSSARY above.
 */
export type GlossEntry = { term: Bi; name: Bi; plain?: Bi };

export const GLOSS = {
  // Review types
  slr: {
    term: { th: "Systematic review", en: "Systematic review" },
    name: N.slr,
    plain: {
      th: "รวบรวมงานวิจัยทุกชิ้นที่ตอบคำถามเดียวกัน ด้วยขั้นตอนที่ตรวจสอบได้",
      en: "gathers every study that answers the same question, by steps anyone can check",
    },
  },
  metaAnalysis: {
    term: { th: "Meta-analysis", en: "Meta-analysis" },
    name: N.metaAnalysis,
    plain: { th: "นำตัวเลขจากหลายงานวิจัยมารวมเป็นผลเดียว", en: "combines the numbers from several studies into one result" },
  },
  scopingReview: {
    term: { th: "Scoping review", en: "Scoping review" },
    name: N.scopingReview,
    plain: { th: "สำรวจว่ามีงานวิจัยเรื่องนี้มากน้อยแค่ไหน ในแง่มุมใด", en: "maps how much research exists on a topic, and on which aspects" },
  },
  narrativeReview: {
    term: { th: "Narrative review", en: "Narrative review" },
    name: N.narrativeReview,
    plain: { th: "สรุปภาพรวมแบบเล่าเรื่อง", en: "sums up the field as a story" },
  },
  // Study designs (the scope form's tiles: name first, then term · plain)
  rct: {
    term: { th: "RCT", en: "RCT" },
    name: N.rct,
    plain: {
      th: "สุ่มแบ่งคนเป็นกลุ่มที่ได้รับสิ่งที่ทดสอบ กับกลุ่มเปรียบเทียบ เช่น ยาหลอกหรือการรักษาเดิม",
      en: "people are split at random into a group that gets what is tested and a comparison group, e.g. placebo or usual care",
    },
  },
  nonRandomized: {
    term: { th: "Non-randomized trial", en: "Non-randomized trial" },
    name: N.nonRandomized,
    plain: { th: "มีกลุ่มเปรียบเทียบ แต่ไม่ได้สุ่มแบ่งกลุ่ม", en: "has a comparison group, but the groups are not assigned at random" },
  },
  cohort: {
    term: { th: "Cohort", en: "Cohort" },
    name: N.cohort,
    plain: { th: "ติดตามคนกลุ่มหนึ่งไปตามเวลา ดูว่าใครเกิดผลที่สนใจ", en: "follows a group of people over time to see who develops the outcome" },
  },
  caseControl: {
    term: { th: "Case-control", en: "Case-control" },
    name: N.caseControl,
    plain: { th: "ย้อนดูว่าสองกลุ่มเคยได้รับหรือสัมผัสอะไรต่างกัน", en: "looks back at what people with and without the disease were exposed to" },
  },
  crossSectional: {
    term: { th: "Cross-sectional", en: "Cross-sectional" },
    name: N.crossSectional,
    plain: { th: "วัดทุกอย่างพร้อมกันครั้งเดียว จึงบอกไม่ได้ว่าอะไรเกิดก่อน", en: "measures everything once, so it cannot show which came first" },
  },
  qualitative: {
    term: { th: "Qualitative", en: "Qualitative" },
    name: N.qualitative,
    plain: { th: "สัมภาษณ์หรือสังเกต เพื่อเข้าใจประสบการณ์และมุมมอง", en: "interviews or observation, to understand experiences and views" },
  },
  mixedMethods: {
    term: { th: "Mixed methods", en: "Mixed methods" },
    name: N.mixedMethods,
    plain: { th: "ใช้ทั้งตัวเลขและการสัมภาษณ์ในงานเดียว", en: "uses both numbers and interviews in one study" },
  },
  primaryStudy: {
    term: { th: "งานปฐมภูมิ", en: "primary study" },
    name: { th: "งานที่เก็บข้อมูลจากผู้เข้าร่วมเอง", en: "a study that collected its own data from participants" },
  },
  // Question frames, methods and reporting
  pico: {
    term: W.pico,
    name: { th: `กรอบตั้งคำถาม: ${PICO_PARTS.th.join(" · ")}`, en: PICO_PARTS.en.join(" · ") },
  },
  pcc: {
    term: W.pcc,
    name: { th: `กรอบตั้งคำถาม: ${PCC_PARTS.th.join(" · ")}`, en: PCC_PARTS.en.join(" · ") },
  },
  prisma: {
    term: W.prisma,
    name: { th: "มาตรฐานการรายงานขั้นตอนคัดเลือกงานวิจัย", en: "the standard way to report how studies were selected" },
  },
  grade: {
    term: { th: "GRADE", en: "GRADE" },
    name: { th: `ระบบให้ระดับ${N.evidenceStrength.th}`, en: "a system for rating the strength of the evidence" },
  },
  riskOfBias: {
    term: W.riskOfBias,
    name: { th: "โอกาสที่วิธีทำวิจัยทำให้ผลคลาดจากความจริง", en: "the chance that how a study was run skewed its result" },
  },
  forestPlot: {
    term: { th: "Forest plot", en: "Forest plot" },
    name: { th: "แผนภาพเทียบผลของแต่ละงานบนเส้นเดียวกัน", en: "a chart that lines up each study's result on one axis" },
  },
  randomEffects: {
    term: { th: "random effects", en: "random effects" },
    name: { th: "วิธีรวมผลที่เผื่อไว้ว่าแต่ละงานอาจได้ผลต่างกันจริง", en: "a way of pooling that allows studies to differ for real" },
  },
  litMatrix: {
    term: { th: "Literature review matrix", en: "Literature review matrix" },
    name: { th: "ตารางสรุปงานวิจัย งานละหนึ่งแถว", en: "a summary table with one row per study" },
  },
  // Numbers in a report
  ratios: {
    term: { th: "HR / RR / OR", en: "HR / RR / OR" },
    name: { th: "ตัววัดความเสี่ยงเปรียบเทียบระหว่างสองกลุ่ม", en: "ratios that compare risk between two groups" },
    plain: {
      th: "ค่า 1 แปลว่าสองกลุ่มไม่ต่างกัน ต่ำกว่า 1 แปลว่ากลุ่มที่ได้รับการรักษาหรือสัมผัสเกิดเหตุการณ์น้อยกว่า",
      en: "1 means no difference; below 1 means fewer events in the treated or exposed group",
    },
  },
  ci95: {
    term: W.ci95,
    name: { th: "ช่วงที่ค่าจริงน่าจะอยู่", en: "the range the true value likely lies in" },
    plain: { th: "ช่วงยิ่งแคบ ยิ่งประมาณได้แม่น", en: "the narrower it is, the more precise the estimate" },
  },
  i2: {
    term: { th: "I²", en: "I²" },
    name: { th: "ความต่างกันของผลระหว่างงานวิจัย", en: "how much results differ between studies" },
    plain: {
      th: "ยิ่งสูง ผลของแต่ละงานยิ่งต่างกันมากเกินกว่าที่เกิดจากความบังเอิญ",
      en: "the higher it is, the more the results differ beyond what chance would explain",
    },
  },
  sampleSize: {
    term: { th: "n", en: "n" },
    name: { th: "จำนวนผู้เข้าร่วมวิจัย", en: "number of participants" },
  },
  mace: {
    term: { th: "MACE", en: "MACE" },
    name: { th: "เหตุการณ์ร้ายแรงของหัวใจและหลอดเลือด", en: "major adverse cardiovascular events" },
  },
  logScale: {
    term: W.logScale,
    name: { th: "แกนที่ค่า 0.5 กับ 2 อยู่ห่างจาก 1 เท่ากัน", en: "an axis where 0.5 and 2 sit equally far from 1" },
  },
  // Sources and the engine
  abstract: {
    term: { th: "บทคัดย่อ", en: "abstract" },
    name: { th: "ย่อหน้าสรุปสั้น ๆ ที่อยู่ต้นงานวิจัยแต่ละเรื่อง", en: "the short summary at the top of a paper" },
  },
  aiAgent: {
    term: { th: "เอเจนต์", en: "agent" },
    name: { th: "AI ที่ทำงานหลายขั้นตอนต่อกันได้เอง", en: "an AI that carries out several steps on its own" },
  },
  llm: {
    term: { th: "โมเดลภาษา", en: "language model" },
    name: { th: "AI ที่อ่านและเขียนข้อความ แบบเดียวกับแชตบอต", en: "the kind of AI behind chatbots, which reads and writes text" },
  },
  preprint: {
    term: { th: "preprint", en: "preprint" },
    name: { th: "งานที่เผยแพร่ก่อนผ่านการตรวจจากผู้ทรงคุณวุฒิ", en: "a paper shared before peer review" },
  },
  doiPmid: {
    term: { th: "DOI และ PMID", en: "DOI and PMID" },
    name: { th: "รหัสประจำตัวของบทความ", en: "a paper's ID numbers" },
  },
  searxng: {
    term: { th: "SearXNG", en: "SearXNG" },
    name: { th: "เครื่องมือค้นหาแบบเปิดที่ระบบติดตั้งไว้เอง", en: "an open search engine the service runs itself" },
  },
  exportFormats: {
    term: { th: "MD, CSV, JSON", en: "MD, CSV, JSON" },
    name: { th: "ไฟล์ข้อความ ตาราง และข้อมูลสำหรับโปรแกรม", en: "text, spreadsheet and data files" },
  },
  api: {
    term: { th: "API", en: "API" },
    name: { th: "ช่องทางให้โปรแกรมอื่นเรียกใช้ระบบ", en: "a way for other programs to use the service" },
  },
  mcp: {
    term: { th: "MCP", en: "MCP" },
    name: { th: "ช่องทางให้ผู้ช่วย AI ตัวอื่นเรียกใช้ระบบนี้", en: "a way for other AI assistants to use this service" },
  },
  apiKey: {
    term: { th: "API key", en: "API key" },
    name: { th: "รหัสประจำตัวสำหรับเรียกใช้ API", en: "a personal code for calling the API" },
  },
} satisfies Record<string, GlossEntry>;

export type GlossKey = keyof typeof GLOSS;

export type GlossOptions = {
  /** add the plain-words explanation after the name: "term (name — plain)" */
  full?: boolean;
  /** the Thai (or English) name is the shown word, and the plain words go in brackets: "name (plain)" */
  named?: boolean;
  /** the word as this page writes it, e.g. "REST API" or "GRADE-lite" */
  term?: string;
  /** a qualifier this page adds after the meaning, e.g. "แบบย่อ" for GRADE-lite */
  suffix?: string;
};

/** Split a gloss into the shown word and the bracket text (shared by glossText and the Gloss component). */
export function glossParts(k: GlossKey, lang: "th" | "en" = "th", opts: GlossOptions = {}): { term: string; meaning: string } {
  const g: GlossEntry = GLOSS[k];
  const tail = opts.suffix ? ` ${opts.suffix}` : "";
  if (opts.named && g.plain) return { term: opts.term ?? g.name[lang], meaning: g.plain[lang] + tail };
  const meaning = opts.full && g.plain ? `${g.name[lang]} — ${g.plain[lang]}` : g.name[lang];
  return { term: opts.term ?? g.term[lang], meaning: meaning + tail };
}

/** "term (meaning)" as plain text, for places that take only a string (option labels, aria text, tests). */
export function glossText(k: GlossKey, lang: "th" | "en" = "th", opts: GlossOptions = {}): string {
  const { term, meaning } = glossParts(k, lang, opts);
  return `${term} (${meaning})`;
}
