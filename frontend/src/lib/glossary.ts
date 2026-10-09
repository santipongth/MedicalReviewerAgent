export type TermKey =
  | "pico" | "evidenceStrength" | "riskOfBias"
  | "rct" | "nonRandomized" | "cohort" | "caseControl" | "crossSectional" | "caseSeries"
  | "mendelian" | "srma" | "narrativeReview"
  | "hr" | "or" | "rr" | "md" | "smd" | "rd" | "ci95"
  | "pcc" | "slr" | "scopingReview"
  | "logScale" | "prisma" | "relevance" | "notVerified" | "uncertain" | "directionTally" | "studyDesign";

type Bi = { th: string; en: string };

/** Plain-language explanations shown by <Term>. Bodies describe concepts only, never findings. */
export const GLOSSARY: Record<TermKey, { label: Bi; body: Bi }> = {
  pico: {
    label: { th: "PICO", en: "PICO" },
    body: {
      th: "กรอบแบ่งคำถามวิจัยเป็น 4 ส่วน คือ ผู้ป่วย การรักษา สิ่งที่เทียบ และผลลัพธ์ที่สนใจ",
      en: "A frame that splits a clinical question into Population, Intervention, Comparator and Outcome.",
    },
  },
  pcc: {
    label: { th: "PCC", en: "PCC" },
    body: {
      th: "กรอบแบ่งคำถามของการทบทวนขอบเขตเป็น 3 ส่วน คือ ประชากร แนวคิดที่สนใจ และบริบท ใช้สำรวจว่ามีงานวิจัยอะไรบ้าง",
      en: "A frame for scoping-review questions: Population, Concept and Context. It is used to map what research exists.",
    },
  },
  slr: {
    label: { th: "การทบทวนอย่างเป็นระบบ", en: "systematic review" },
    body: {
      th: "ค้นและคัดกรองงานวิจัยตามเกณฑ์ที่กำหนดไว้ล่วงหน้า รายงานขั้นตอนแบบ PRISMA และประเมินความแข็งแรงของหลักฐาน รายงานนี้ทำโดยเอเจนต์อัตโนมัติจากบทคัดย่อเท่านั้น",
      en: "Searches and screens studies by criteria set in advance, reports the steps as PRISMA and grades the evidence. This one is done automatically by an agent from abstracts only.",
    },
  },
  scopingReview: {
    label: { th: "การทบทวนขอบเขต", en: "scoping review" },
    body: {
      th: "สำรวจว่ามีงานวิจัยอะไร ชนิดใด ปีใด ในหัวข้อหนึ่ง ไม่ประเมินคุณภาพของแต่ละงาน และไม่สรุปว่าได้ผลหรือไม่",
      en: "Maps what research exists on a topic, of which kinds and from which years. It does not appraise quality or conclude whether something works.",
    },
  },
  evidenceStrength: {
    label: { th: "ความแข็งแรงของหลักฐาน", en: "evidence strength" },
    body: {
      th: "ระดับความมั่นใจว่าผลที่พบใกล้ความจริงแค่ไหน ดูจากชนิดงานวิจัย จำนวน และความสอดคล้องของผล",
      en: "How confident we can be that the observed effect is close to the truth, based on study design, number of studies and consistency.",
    },
  },
  riskOfBias: {
    label: { th: "ความเสี่ยงอคติ", en: "risk of bias" },
    body: {
      th: "โอกาสที่วิธีทำงานวิจัยจะทำให้ผลเบี้ยวไปจากความจริง เช่น ไม่สุ่มกลุ่ม หรือผู้ประเมินรู้ว่าใครได้รับการรักษา",
      en: "The chance that how a study was run pushed its results away from the truth, for example unblinded assessors or non-random grouping.",
    },
  },
  rct: {
    label: { th: "การทดลองแบบสุ่ม (RCT)", en: "randomized controlled trial (RCT)" },
    body: {
      th: "ผู้เข้าร่วมถูกสุ่มเข้ากลุ่มรักษาหรือกลุ่มเปรียบเทียบ ช่วยให้สองกลุ่มใกล้เคียงกันมากที่สุด",
      en: "Participants are randomly assigned to treatment or comparison, so the groups are as alike as possible.",
    },
  },
  nonRandomized: {
    label: { th: "การทดลองแบบไม่สุ่ม", en: "non-randomized study" },
    body: {
      th: "มีการให้การรักษา แต่ผู้วิจัยไม่ได้สุ่มกลุ่ม ผลจึงอาจถูกกลุ่มที่ต่างกันตั้งแต่ต้นรบกวน",
      en: "A treatment is given but groups are not assigned at random, so differences present from the start may distort the result.",
    },
  },
  cohort: {
    label: { th: "การศึกษาแบบติดตามกลุ่ม (cohort)", en: "cohort study" },
    body: {
      th: "ติดตามคนกลุ่มหนึ่งไปตามเวลา แล้วดูว่าใครเกิดผลลัพธ์ที่สนใจ โดยไม่ได้เป็นผู้กำหนดว่าใครได้รับสิ่งนั้น",
      en: "Follows a group of people over time to see who develops the outcome, without assigning the exposure.",
    },
  },
  caseControl: {
    label: { th: "การศึกษาแบบเปรียบเทียบผู้ป่วยกับผู้ไม่ป่วย (case-control)", en: "case-control study" },
    body: {
      th: "เริ่มจากคนที่มีผลลัพธ์แล้วกับคนที่ไม่มี แล้วย้อนดูว่าใครเคยได้รับสิ่งที่สนใจมากกว่ากัน",
      en: "Starts from people who have the outcome and people who do not, then looks back at who was exposed.",
    },
  },
  crossSectional: {
    label: { th: "การศึกษาแบบตัดขวาง", en: "cross-sectional study" },
    body: {
      th: "วัดทุกอย่างในเวลาเดียว เหมือนถ่ายภาพหนึ่งช็อต จึงบอกลำดับก่อนหลังของเหตุและผลไม่ได้",
      en: "Measures everything at one point in time, like a snapshot, so it cannot show which came first.",
    },
  },
  caseSeries: {
    label: { th: "รายงานชุดผู้ป่วย", en: "case series" },
    body: {
      th: "บรรยายผู้ป่วยจำนวนหนึ่งที่ได้รับการรักษาแบบเดียวกัน โดยไม่มีกลุ่มเปรียบเทียบ",
      en: "Describes a set of patients who received the same care, with no comparison group.",
    },
  },
  mendelian: {
    label: { th: "การสุ่มแบบเมนเดเลียน", en: "Mendelian randomization" },
    body: {
      th: "ใช้ความแปรผันของยีนที่ติดตัวมาแต่กำเนิดเป็นตัวแทนของปัจจัยที่สนใจ เพื่อลดผลจากปัจจัยแทรกซ้อน",
      en: "Uses genetic variants inherited at birth as a stand-in for an exposure, to reduce the effect of confounding.",
    },
  },
  srma: {
    label: { th: "การทบทวนอย่างเป็นระบบและการวิเคราะห์อภิมาน", en: "systematic review / meta-analysis" },
    body: {
      th: "รวบรวมงานวิจัยหลายชิ้นตามขั้นตอนที่กำหนดไว้ และอาจรวมผลทางสถิติเข้าด้วยกัน",
      en: "Collects many studies by a fixed procedure and may pool their results statistically.",
    },
  },
  narrativeReview: {
    label: { th: "บทความทบทวนแบบบรรยาย", en: "narrative review" },
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
    label: { th: "ช่วงเชื่อมั่น 95%", en: "95% CI" },
    body: {
      th: "ช่วงที่ค่าจริงน่าจะอยู่ ช่วงแคบแปลว่าประมาณค่าได้แม่น ถ้าคร่อมค่าที่แปลว่าไม่มีผล งานนี้ยังฟันธงไม่ได้",
      en: "The range where the true value likely lies. A narrow range means a precise estimate; if it spans the no-effect value, the study cannot settle the question.",
    },
  },
  logScale: {
    label: { th: "สเกลลอการิทึม", en: "log scale" },
    body: {
      th: "แกนที่ระยะเท่ากันแทนการคูณเท่ากัน ใช้กับอัตราส่วน เพื่อให้ค่าที่เป็นสองเท่าและครึ่งหนึ่งอยู่ห่างจากเส้นไม่มีผลเท่ากัน",
      en: "An axis where equal distances mean equal multiples. It is used for ratios so that doubling and halving sit equally far from the no-effect line.",
    },
  },
  prisma: {
    label: { th: "แผนภาพ PRISMA", en: "PRISMA flow" },
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
};
