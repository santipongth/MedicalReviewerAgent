// Pure: which view of the live stage to show (team / steps / 3D), from the stored preference. No DOM, no storage access.

export type StageViewKind = "team" | "steps" | "3d";
export const STAGE_VIEWS: readonly StageViewKind[] = ["team", "steps", "3d"];
/** The default view (Plan 18): the 2D agent team. */
export const DEFAULT_VIEW: StageViewKind = "team";
export const VIEW_KEY = "mra.stageView";
/** Plan 12's on/off 3D preference ("1" = 3D); read once as a migration source. */
export const LEGACY_3D_KEY = "mra.stage3d";

export function isStageView(v: unknown): v is StageViewKind {
  return typeof v === "string" && (STAGE_VIEWS as readonly string[]).includes(v);
}

/** The stored view, or the legacy 3D flag migrated ("1" -> "3d"), or the default. */
export function parseStageView(stored: string | null, legacy3d: string | null): StageViewKind {
  if (isStageView(stored)) return stored;
  if (legacy3d === "1") return "3d";
  return DEFAULT_VIEW;
}

/** The view actually shown: 3D only where it is offered; otherwise the default 2D team view. */
export function effectiveView(pref: StageViewKind, can3d: boolean): StageViewKind {
  return pref === "3d" && !can3d ? DEFAULT_VIEW : pref;
}
