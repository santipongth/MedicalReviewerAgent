import Link from "next/link";
import { CodeBlock } from "../code-block";

const TOOLS: [string, string][] = [
  ["search_papers", "ค้นงานวิจัยจาก 8 แหล่งในครั้งเดียว ได้ชื่อเรื่อง บทคัดย่อ และตัวระบุ"],
  ["start_review", "เริ่มรีวิว 4 รูปแบบ (systematic, meta-analysis, scoping, narrative) เลือกชนิดงานวิจัยและปีได้ ไทยหรืออังกฤษ"],
  ["get_review_status", "สถานะ queued, running, done, error, rejected หรือ cancelled"],
  ["get_review_result", "คำถามวิจัย ตารางเทียบ ข้อขัดแย้ง ระดับหลักฐาน เครือข่ายการอ้างอิง ค่ารวม meta-analysis พร้อมประโยคต้นฉบับของทุกตัวเลข"],
];

/** MCP and REST give agents the same receipts as the web page. `api` is the public API origin. */
export function AgentBand({ api }: { api: string }) {
  const config = JSON.stringify({ mcpServers: { "medical-reviewer": { url: `${api}/mcp` } } }, null, 2);
  return (
    <section aria-labelledby="h-agents" className="grid gap-8 border-t border-rule pt-10 lg:grid-cols-2">
      <div className="grid content-start gap-4">
        <h2 id="h-agents" className="text-[1.75rem] font-bold">เอเจนต์ AI ก็ได้ใบเสร็จเหมือนกัน</h2>
        <p className="max-w-[60ch] text-muted">
          เซิร์ฟเวอร์ MCP และ REST API ส่งผลลัพธ์ชุดเดียวกับหน้าเว็บ รวมประโยคต้นฉบับของทุกตัวเลข ใช้ได้โดยไม่ต้องมี API key
        </p>
        <ul className="grid border-t border-rule">
          {TOOLS.map(([name, body]) => (
            <li key={name} className="grid gap-x-4 border-b border-rule py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <code className="font-code text-[0.88rem]">{name}</code>
              <span className="text-[0.92rem] text-muted">{body}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid min-w-0 content-start gap-4">
        <CodeBlock label="ตั้งค่า MCP client (JSON)" code={config} />
        <p>
          <Link href="/about"
            className="inline-block rounded-sm bg-primary px-4 py-2 font-display font-semibold text-on-primary hover:brightness-110">
            ดูเอกสาร API และ MCP
          </Link>
        </p>
      </div>
    </section>
  );
}
