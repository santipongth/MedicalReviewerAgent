import type { Metadata } from "next";
import { connection } from "next/server";
import { CodeBlock } from "@/components/code-block";

export const metadata: Metadata = { title: "API และ MCP" };

function snippets(api: string) {
  const mcp = `${api}/mcp`;
  return {
    rest: `# 1) ส่งคำถาม (ไม่ต้องมี key: 5 รีวิว/ชั่วโมงต่อ IP)
curl -X POST ${api}/api/v1/reviews \\
  -H "Content-Type: application/json" \\
  -d '{"topic": "metformin and colorectal cancer", "language": "en", "options": {"max_papers": 8}}'

# 2) ติดตามความคืบหน้าแบบสด (Server-Sent Events)
curl -N ${api}/api/v1/reviews/<review_id>/events

# 3) อ่านผลลัพธ์
curl ${api}/api/v1/reviews/<review_id>`,
    papers: `curl "${api}/api/v1/papers/search?q=statins%20dementia&limit=10"
curl ${api}/api/v1/papers/fulltext/PMC1234567`,
    key: `# ใช้ API key ที่ผู้ดูแลระบบออกให้ (quota สูงขึ้น, webhook, ยกเลิกรีวิว)
curl -X POST ${api}/api/v1/reviews \\
  -H "X-API-Key: mra_..." -H "Content-Type: application/json" \\
  -d '{"topic": "SGLT2 inhibitors and heart failure", "callback_url": "https://your-app.example.org/hooks/review"}'

# ยกเลิกรีวิวที่ key นี้สร้าง
curl -X DELETE ${api}/api/v1/reviews/<review_id> -H "X-API-Key: mra_..."`,
    pyVerify: `import hashlib, hmac

def verify(body: bytes, signature_header: str, api_key: str) -> bool:
    secret = hashlib.sha256(api_key.encode()).hexdigest()
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)`,
    nodeVerify: `import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function verify(body: Buffer, signatureHeader: string, apiKey: string): boolean {
  const secret = createHash("sha256").update(apiKey).digest("hex");
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  return expected.length === signatureHeader.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}`,
    claudeCode: `claude mcp add --transport http medical-reviewer ${mcp}`,
    mcpJson: JSON.stringify({ mcpServers: { "medical-reviewer": { url: mcp } } }, null, 2),
  };
}

export default async function AboutPage() {
  await connection();
  const api = (process.env.PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
  const s = snippets(api);
  return (
    <div className="grid max-w-[880px] gap-12 pt-12">
      <header className="grid gap-3">
        <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-bold">ใช้งานผ่าน API และ MCP</h1>
        <p className="max-w-[65ch] text-[1.05rem] text-muted">
          ระบบอื่นและ AI agent ใช้ Medical Reviewer Agent ได้เหมือนหน้าเว็บนี้ ผ่าน REST API หรือ Model Context Protocol (MCP)
          ทุกช่องทางใช้ข้อจำกัดอัตราและแคชผลลัพธ์ชุดเดียวกัน หัวข้อเดิมภายใน 24 ชั่วโมงจะได้รีวิวเดิมกลับไป
        </p>
      </header>

      <section aria-labelledby="h-rest" className="grid gap-4">
        <h2 id="h-rest" className="text-2xl font-bold">REST API</h2>
        <p className="max-w-[65ch]">เอกสาร OpenAPI ฉบับเต็มอยู่ที่ <a className="text-primary underline underline-offset-2" href={`${api}/api/docs`}>{api}/api/docs</a></p>
        <CodeBlock label="REST" code={s.rest} />
        <CodeBlock label="ค้นงานวิจัยและอ่านฉบับเต็ม" code={s.papers} />
      </section>

      <section aria-labelledby="h-keys" className="grid gap-4">
        <h2 id="h-keys" className="text-2xl font-bold">API key และ webhook</h2>
        <p className="max-w-[65ch]">
          API key เพิ่ม quota ต่อวัน เปิดใช้ <code className="font-num [font-stretch:87.5%]">callback_url</code> และให้ยกเลิกรีวิวที่ตัวเองสร้างได้
          ส่ง key ทาง <code className="font-num [font-stretch:87.5%]">X-API-Key</code> หรือ <code className="font-num [font-stretch:87.5%]">Authorization: Bearer</code> เท่านั้น
          key ที่ส่งมาแต่ใช้ไม่ได้จะได้ 401 ไม่ถูกลดเป็นผู้ใช้ไม่ระบุตัวตน
        </p>
        <CodeBlock label="ใช้ API key" code={s.key} />
        <p className="max-w-[65ch]">
          เมื่อรีวิวเสร็จ ระบบ POST <code className="font-num [font-stretch:87.5%]">{"{review_id, status, result_url}"}</code> ไปยัง callback_url
          (ต้องเป็น HTTPS และเป็นที่อยู่สาธารณะ ลองส่งสูงสุด 3 ครั้ง) พร้อมหัว <code className="font-num [font-stretch:87.5%]">X-Signature</code> ตรวจลายเซ็นด้วย secret = SHA-256 ของ API key
          ถ้าการตอบกลับมี <code className="font-num [font-stretch:87.5%]">&quot;cached&quot;: true</code> แปลว่าใช้รีวิวที่มีอยู่แล้วและไม่มี webhook ให้ดึงผลด้วย GET แทน
        </p>
        <CodeBlock label="ตรวจลายเซ็น (Python)" code={s.pyVerify} />
        <CodeBlock label="ตรวจลายเซ็น (Node.js)" code={s.nodeVerify} />
      </section>

      <section aria-labelledby="h-mcp" className="grid gap-4">
        <h2 id="h-mcp" className="text-2xl font-bold">MCP สำหรับ AI agent</h2>
        <p className="max-w-[65ch]">
          เครื่องมือ: <b>search_papers</b>, <b>start_review</b>, <b>get_review_status</b>, <b>get_review_result</b>, <b>get_fulltext</b> ·
          resources: <code className="font-num [font-stretch:87.5%]">review://&lt;id&gt;</code> และ <code className="font-num [font-stretch:87.5%]">review://&lt;id&gt;/report.md</code> ·
          prompt: <b>literature_review</b>
        </p>
        <CodeBlock label="Claude Code" code={s.claudeCode} />
        <CodeBlock label="MCP client ทั่วไป (JSON)" code={s.mcpJson} />
      </section>

      <section aria-labelledby="h-limits" className="grid gap-3">
        <h2 id="h-limits" className="text-2xl font-bold">ขอบเขตและข้อจำกัด</h2>
        <ul className="grid max-w-[65ch] list-disc gap-2 pl-5">
          <li>เป็นการทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติ ไม่ใช่ systematic review และไม่ใช่คำแนะนำทางการแพทย์</li>
          <li>อ่านฉบับเต็มเฉพาะงาน Open Access ที่เว็บต้นทางอนุญาต (เคารพ robots.txt) งานอื่นใช้บทคัดย่อ</li>
          <li>ตัวเลขที่ตรวจกับประโยคต้นฉบับไม่ผ่านจะถูกเว้นว่างและแสดงเป็น “ไม่ยืนยัน” ไม่มีการเดาค่า</li>
          <li>ความแข็งแรงของหลักฐานเป็นแบบ GRADE-lite ที่คำนวณจากรูปแบบการศึกษา ความเสี่ยงอคติ ความสอดคล้อง และขนาดตัวอย่าง</li>
        </ul>
      </section>
    </div>
  );
}
