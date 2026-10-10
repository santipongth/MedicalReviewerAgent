"use client";

import Link from "next/link";
import { GLOSS } from "@/lib/glossary";
import { t } from "@/lib/i18n";
import { useDocLang } from "@/lib/use-doc-lang";

const SOURCES = ["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ", "OpenAIRE"];

/** The site footer: disclaimer, data sources and links, in the page's language (an English report: English). */
export function SiteFooter() {
  const lang = useDocLang();
  return (
    <footer className="border-t border-rule bg-rail">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-10 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <p className="max-w-[60ch] text-[0.92rem] text-muted">
          <b className="block font-display text-ink">{t(lang, "notAdvice")}</b>
          {t(lang, "footerNote")}
        </p>
        <div className="grid content-start gap-2">
          <h2 className="label">{t(lang, "dataSources")}</h2>
          <ul className="grid gap-1 text-[0.9rem]">{SOURCES.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
        <nav aria-label={t(lang, "footerNav")} className="grid content-start gap-2">
          <h2 className="label">{t(lang, "site")}</h2>
          <ul className="grid gap-1 text-[0.9rem]">
            <li><Link href="/" className="hover:text-primary">{t(lang, "review")}</Link></li>
            <li>
              <Link href="/about" className="hover:text-primary">{t(lang, "about")}</Link>{" "}
              <span className="text-muted">({GLOSS.api.name[lang]})</span>
            </li>
          </ul>
        </nav>
      </div>
      <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-2 border-t border-rule px-4 py-4 text-[0.8rem] text-muted">
        <span>Medical Reviewer Agent · {t(lang, "free")}</span>
        <span lang="en">Automated rapid review of abstracts. Not medical advice.</span>
      </div>
    </footer>
  );
}
