// next/link stand-in for the offline report: a plain anchor (there is no router in a downloaded file).
import type { AnchorHTMLAttributes, ReactNode } from "react";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string | null };
  children?: ReactNode;
  prefetch?: boolean | null;
};

export default function Link({ href, children, prefetch, ...anchor }: LinkProps) {
  void prefetch; // a plain anchor has nothing to prefetch
  const target = typeof href === "string" ? href : href.pathname ?? "#";
  return <a href={target} {...anchor}>{children}</a>;
}
