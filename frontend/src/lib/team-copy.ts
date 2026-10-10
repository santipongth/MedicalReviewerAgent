// The team view's phase vocabulary and honesty note, kept apart from agent-team.ts so the eager page chunk (the legend,
// the 3D figure's note) does not pull in the whole team model. agent-team.ts re-exports these.
export type Phase = "think" | "analyse" | "plan" | "act";

export const PHASES: readonly Phase[] = ["think", "analyse", "plan", "act"];
export const PHASE_LABEL: Record<Phase, string> = { think: "คิด", analyse: "วิเคราะห์", plan: "วางแผน", act: "ลงมือ" };
/** The visible note that the phases are labels for real steps. */
export const PHASE_NOTE = "ขั้นคิด/วิเคราะห์/วางแผน/ลงมือ มาจากเหตุการณ์จริงของระบบ ไม่ใช่ความคิดภายในของโมเดล";
