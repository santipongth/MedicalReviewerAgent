import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-20 border-b border-rule bg-ground">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-4 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2.5 font-display text-base font-bold text-ink no-underline">
          <i aria-hidden="true" className="tape-mark inline-block size-[18px] rounded-sm" />
          Medical Reviewer Agent
        </Link>
        <nav aria-label="หลัก" className="ml-auto flex flex-wrap items-center gap-4 font-display text-sm font-medium">
          <Link href="/" className="text-ink hover:text-primary">ทบทวนงานวิจัย</Link>
          <Link href="/about" className="text-ink hover:text-primary">API และ MCP</Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
