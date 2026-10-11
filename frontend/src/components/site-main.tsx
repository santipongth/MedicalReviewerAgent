"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { pageWidth } from "@/lib/page-width";

/** The page's `<main>`, as wide as the route allows (`pageWidth`). */
export function SiteMain({ children }: { children: ReactNode }) {
  return <main className={`mx-auto w-full ${pageWidth(usePathname())} px-4 pb-16`}>{children}</main>;
}
