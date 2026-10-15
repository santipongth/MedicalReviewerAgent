"use client";

import { adminApi } from "@/lib/admin-api";
import { MODEL_SOURCE_LABEL } from "@/lib/admin-copy";
import type { LlmVersion } from "@/lib/admin-types";
import type { WriteTracker } from "./models-save-bar";
import { BUTTON_GHOST } from "./ui";
import { type ChangeLine, VersionHistory, type VersionSource } from "./version-history";

/** One line per changed key, and one per role under "roles". */
function changeLines(changes: Record<string, unknown>): ChangeLine[] {
  const lines: ChangeLine[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (key === "roles" && value && typeof value === "object") {
      for (const [role, change] of Object.entries(value as Record<string, string>)) lines.push({ key: role, change });
    } else {
      lines.push({ key, change: Array.isArray(value) ? value.join(", ") : String(value) });
    }
  }
  return lines;
}

/** Shown while the reset asks to be confirmed: what the new version means for llm.yaml and LLM_PRESET. */
const RESET_HINT = "เวอร์ชันใหม่จาก llm.yaml จะถูกใช้ทันที และขณะที่ใช้เวอร์ชันจาก DB การแก้ llm.yaml หรือ LLM_PRESET ภายหลังจะไม่มีผล";

/** The saved model configurations (Plan 23b): each version's preset and a YAML download beside restore. */
export const modelsSource: VersionSource<LlmVersion> = {
  key: "models",
  list: (cursor) => adminApi.llmVersions(cursor as number | null | undefined),
  restore: (v, base) => adminApi.restoreLlm(v.id, base),
  reset: (base) => adminApi.resetLlm(base),
  item: (v) => ({ id: v.id, createdAt: v.created_at, createdBy: v.created_by, source: MODEL_SOURCE_LABEL[v.source],
    restoredFrom: v.restored_from, note: v.note }),
  meta: (v) => `preset ${v.active_preset}`,
  changes: (v) => changeLines(v.changes),
  rowExtra: (v) => <a href={adminApi.llmVersionYamlUrl(v.id)} className={BUTTON_GHOST} download>ดาวน์โหลด YAML</a>,
  labels: { reset: "สร้างเวอร์ชันใหม่จาก llm.yaml", resetConfirm: "ยืนยันสร้างเวอร์ชันใหม่", resetHint: RESET_HINT,
    empty: "ยังไม่มีเวอร์ชันที่บันทึก ระบบใช้ llm.yaml อยู่", resetDone: (id) => `สร้างเวอร์ชัน ${id} จาก llm.yaml แล้ว` },
};

/** Saved versions, newest first: what each changed, restore (a new version with the old content), YAML download. */
export function ModelsHistory({ base, onChanged, writes }: { base: number | null; onChanged: () => void; writes?: WriteTracker }) {
  return <VersionHistory source={modelsSource} base={base} onChanged={onChanged} writes={writes} />;
}
