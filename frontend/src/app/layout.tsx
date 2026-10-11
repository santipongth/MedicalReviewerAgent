import type { Metadata } from "next";
import { Anuphan, Bai_Jamjuree, Martian_Mono, Source_Serif_4 } from "next/font/google";
import { connection } from "next/server";
import { SiteFooter } from "@/components/site-footer";
import { SiteMain } from "@/components/site-main";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const anuphan = Anuphan({ subsets: ["thai", "latin"], variable: "--font-anuphan", display: "swap" });
const baiJamjuree = Bai_Jamjuree({
  subsets: ["thai", "latin"], weight: ["500", "600", "700"], variable: "--font-bai-jamjuree", display: "swap",
});
const martianMono = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-martian-mono", display: "swap" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], axes: ["opsz"], variable: "--font-source-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Medical Reviewer Agent", template: "%s · Medical Reviewer Agent" },
  description:
    "ทบทวนงานวิจัยทางการแพทย์อัตโนมัติ: อ่านงานวิจัยที่เกี่ยวข้องที่สุด เทียบผลที่ตรงกันและขัดกัน และตรวจทุกตัวเลขกับประโยคต้นฉบับ",
};

function bootScript(apiUrl: string): string {
  const config = JSON.stringify({ apiUrl }).replace(/</g, "\\u003c");
  return `window.__MRA_CONFIG__=${config};(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Read the public API address at request time so one image works in every deployment.
  await connection();
  const apiUrl = process.env.PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  return (
    <html
      lang="th"
      suppressHydrationWarning
      className={`${anuphan.variable} ${baiJamjuree.variable} ${martianMono.variable} ${sourceSerif.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript(apiUrl) }} />
      </head>
      <body className="min-h-dvh">
        <SiteHeader />
        <SiteMain>{children}</SiteMain>
        <SiteFooter />
      </body>
    </html>
  );
}
