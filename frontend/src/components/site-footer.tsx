import Link from "next/link";

const SOURCES = ["PubMed", "arXiv", "Semantic Scholar", "OpenAlex", "CrossRef", "Europe PMC (บทคัดย่อ)"];

export function SiteFooter() {
  return (
    <footer className="border-t border-rule bg-rail">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-10 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <p className="max-w-[60ch] text-[0.92rem] text-muted">
          <b className="block font-display text-ink">ไม่ใช่คำแนะนำทางการแพทย์</b>
          ผลลัพธ์เป็นการทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติจากบทคัดย่อ ไม่ใช้แทนการวินิจฉัยหรือการรักษา
          ตรวจกับบทความต้นฉบับและผู้เชี่ยวชาญก่อนนำไปใช้
        </p>
        <div className="grid content-start gap-2">
          <h2 className="label">แหล่งข้อมูล</h2>
          <ul className="grid gap-1 text-[0.9rem]">{SOURCES.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
        <nav aria-label="ท้ายหน้า" className="grid content-start gap-2">
          <h2 className="label">เว็บไซต์</h2>
          <ul className="grid gap-1 text-[0.9rem]">
            <li><Link href="/" className="hover:text-primary">ทบทวนงานวิจัย</Link></li>
            <li><Link href="/about" className="hover:text-primary">API และ MCP</Link></li>
          </ul>
        </nav>
      </div>
      <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-2 border-t border-rule px-4 py-4 text-[0.8rem] text-muted">
        <span>Medical Reviewer Agent · ใช้ฟรี ไม่ต้องสมัคร</span>
        <span>Automated rapid review of abstracts. Not medical advice.</span>
      </div>
    </footer>
  );
}
