"use client";

import Link from "next/link";
import { t } from "@/lib/i18n";
import { useDocLang } from "@/lib/use-doc-lang";
import { HeaderHeight } from "./header-height";
import { ThemeToggle } from "./theme-toggle";

/** The site header; its words follow the page's language (an English report: English, Plan 20 Task 7). */
export function SiteHeader() {
  const lang = useDocLang();
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-20 border-b border-rule bg-ground">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-4 px-4 py-2.5">
        <HeaderHeight />
        <Link href="/" className="flex min-h-11 items-center gap-2.5 font-display text-base font-bold text-ink no-underline md:min-h-0">
          <i aria-hidden="true" className="tape-mark inline-block size-[18px] rounded-sm" />
          Medical Reviewer Agent
        </Link>
        <nav aria-label={t(lang, "mainNav")} className="ml-auto flex flex-wrap items-center gap-4 font-display text-sm font-medium">
          <Link href="/" className="inline-flex min-h-11 items-center text-ink hover:text-primary md:min-h-0">{t(lang, "review")}</Link>
          <Link href="/about" className="inline-flex min-h-11 items-center text-ink hover:text-primary md:min-h-0">{t(lang, "about")}</Link>
          <ThemeToggle lang={lang} />
        </nav>
      </div>
    </header>
  );
}
