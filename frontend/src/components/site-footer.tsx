"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GLOSS } from "@/lib/glossary";
import { t } from "@/lib/i18n";
import { pageWidth } from "@/lib/page-width";
import { useDocLang } from "@/lib/use-doc-lang";

const SOURCES = ["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ", "OpenAIRE"];

/** The site footer: disclaimer, data sources and links (no bottom strip), in the page's language (an English report: English). */
export function SiteFooter() {
  const lang = useDocLang();
  const pathname = usePathname();
  return (
    <footer className="border-t border-rule bg-rail">
      <div className={`mx-auto grid ${pageWidth(pathname)} gap-8 px-4 py-10 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:gap-12`}>
        <div className="grid content-start gap-6">
          <p className="max-w-[60ch] text-[0.92rem] text-muted">
            <b className="block font-display text-ink">{t(lang, "notAdvice")}</b>
            {t(lang, "footerNote")}
          </p>
          <div className="grid gap-2 print:hidden">
            <h2 className="label">{t(lang, "dataSources")}</h2>
            <ul className="flex flex-wrap gap-x-2 gap-y-1 text-[0.88rem] text-muted">
              {SOURCES.map((s, i) => (
                <li key={s} className="nw">{i > 0 && <span aria-hidden="true" className="mr-2">·</span>}{s}</li>
              ))}
            </ul>
          </div>
        </div>
        <nav aria-label={t(lang, "footerNav")} className="grid content-start gap-2 print:hidden">
          <h2 className="label">{t(lang, "site")}</h2>
          <ul className="grid gap-1 text-[0.9rem]">
            <li><Link href="/" className="hover:text-primary">{t(lang, "review")}</Link></li>
            <li>
              <Link href="/developers" className="hover:text-primary">{t(lang, "developers")}</Link>{" "}
              <span className="text-muted">({GLOSS.api.name[lang]})</span>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
