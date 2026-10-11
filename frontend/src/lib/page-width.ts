/** Wide surfaces: the developer docs use the screen for three panes; every other page keeps DESIGN.md's 1240px. */
const WIDE = ["/developers"];

/** The max-width class shared by the site header, `<main>` and the footer, so their edges line up on every route. */
export function pageWidth(pathname: string | null): string {
  return pathname && WIDE.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ? "max-w-[1680px]" : "max-w-[1240px]";
}
