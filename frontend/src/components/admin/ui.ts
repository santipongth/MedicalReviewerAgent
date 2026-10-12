/** Admin console control styles (DESIGN.md: 2px corners, 1px rule borders, 44px targets, primary = the action colour). */
export const BUTTON_PRIMARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-sm bg-primary px-4 font-display font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45";
export const BUTTON_GHOST =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-sm border border-rule bg-transparent px-3 font-display font-semibold text-ink hover:border-ink disabled:cursor-not-allowed disabled:opacity-45";
export const BUTTON_DANGER =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-sm border border-err bg-err-bg px-3 font-display font-semibold text-err disabled:cursor-not-allowed disabled:opacity-45";
export const INPUT = "min-h-11 w-full rounded-sm border border-rule bg-ground px-3 text-ink";
/** `relative`: a position:absolute child (the sr-only text of an empty column header) is clipped by this region only when the
 * region is its containing block; without it that child sits at the far end of a wide table and widens the whole page. */
export const TABLE_REGION = "relative mt-4 overflow-x-auto rounded-sm border border-rule";
export const TH = "border-b border-rule px-3 py-2 text-left font-display text-sm font-semibold whitespace-nowrap";
export const TD = "border-b border-rule px-3 py-2 align-top";
