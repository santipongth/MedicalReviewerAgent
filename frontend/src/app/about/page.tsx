import type { Metadata } from "next";
import { connection } from "next/server";
import { LiveLimits } from "@/components/about/live-limits";
import { CodeBlock } from "@/components/code-block";
import { publicApiUrl } from "@/lib/public-api";

export const metadata: Metadata = { title: "API และ MCP" };

function snippets(api: string) {
  const mcp = `${api}/mcp`;
  return {
    rest: `# 0) ระบบรับรีวิวใหม่อยู่ไหม และขีดจำกัดตอนนี้
curl ${api}/api/v1/status

# 1) ส่งคำถาม (ไม่ต้องมี key; ถ้าคิวเต็มหรือโควตารายวันหมดจะได้ 503 พร้อม reason และ Retry-After)
curl -X POST ${api}/api/v1/reviews \\
  -H "Content-Type: application/json" \\
  -d '{"topic": "metformin and colorectal cancer", "language": "en",
       "options": {"review_type": "slr", "max_papers": 30, "study_types": ["RCT", "Cohort"], "year_from": 2015}}'

# 2) ติดตามความคืบหน้าแบบสด (Server-Sent Events)
curl -N ${api}/api/v1/reviews/<review_id>/events

# 3) อ่านผลลัพธ์ (ระหว่างรอคิวมี queue_position)
curl ${api}/api/v1/reviews/<review_id>

# 4) ดาวน์โหลดเมื่อเสร็จ: md | csv | json
curl -OJ "${api}/api/v1/reviews/<review_id>/export?format=csv"`,
    papers: `curl "${api}/api/v1/papers/search?q=statins%20dementia&limit=10"`,
    key: `# ใช้ API key ที่ผู้ดูแลระบบออกให้ (อัตราสูงขึ้น, webhook, ยกเลิกรีวิว)
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
  const api = await publicApiUrl();
  const s = snippets(api);
  return (
    <div className="grid max-w-[880px] gap-12 pt-12">
      <header className="grid gap-3">
        <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-bold">ใช้งานผ่าน API และ MCP</h1>
        <p className="max-w-[65ch] text-[1.05rem] text-muted">
          ระบบอื่นและ AI agent ใช้ Medical Reviewer Agent ได้ครบทุกความสามารถเหมือนหน้าเว็บนี้ ผ่าน REST API หรือ Model Context Protocol (MCP)
          ทุกช่องทางใช้ข้อจำกัดอัตราและแคชผลลัพธ์ชุดเดียวกัน หัวข้อ ภาษา และตัวเลือกเดิมภายใน 24 ชั่วโมง (หรือที่ยังทำอยู่)
          จะได้รีวิวเดิมกลับไปโดยไม่นับโควตา เอกสารอ้างอิงฉบับเต็มอยู่ที่ docs/api.md ในโค้ดของโปรเจกต์
        </p>
      </header>

      <section aria-labelledby="h-how" className="grid gap-4">
        <h2 id="h-how" className="text-2xl font-bold">ระบบทำอะไรให้</h2>
        <ol className="grid max-w-[65ch] list-decimal gap-2 pl-5">
          <li>รับหัวข้อหรือคำถาม (ไม่เกิน 600 ตัวอักษร) แล้วตีความเป็นคำถามวิจัยแบบ PICO หรือ PCC สำหรับการทบทวนขอบเขต</li>
          <li>ค้น 8 แหล่ง: PubMed, Europe PMC (รวม preprint จาก medRxiv/bioRxiv), OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ และ OpenAIRE ผ่าน SearXNG ของระบบเอง แล้วตัดงานซ้ำ</li>
          <li>คัดกรองงานที่มีบทคัดย่อราว 60 ฉบับตามเกณฑ์ของรูปแบบการทบทวน พร้อมเหตุผลที่คัดออกแบบ PRISMA</li>
          <li>อ่านบทคัดย่อสูงสุด 30 ฉบับ สกัดผล ตัวเลข และความเสี่ยงอคติ ตรวจตัวเลขทุกตัวกับประโยคต้นฉบับ</li>
          <li>เทียบผลข้ามงานวิจัย อธิบายจุดที่ขัดกัน สรุปผล (ประเมินระดับความแข็งแรงของหลักฐานเฉพาะ systematic review และ meta-analysis ไม่ประเมินใน narrative review หรือ scoping review) และแปลเป็นภาษาไทยโดยตัวเลขไม่เปลี่ยน</li>
        </ol>
        <dl className="grid max-w-[65ch] gap-2">
          <div><dt className="font-display font-semibold">รูปแบบการทบทวน (<code className="font-code">review_type</code>)</dt>
            <dd className="text-muted"><code className="font-code">slr</code> อย่างเป็นระบบ (ค่าเริ่มต้น) · <code className="font-code">meta_analysis</code> อย่างเป็นระบบพร้อมค่ารวมที่ระบบคำนวณ · <code className="font-code">scoping</code> สำรวจขอบเขต · <code className="font-code">narrative</code> แบบบรรยาย</dd></div>
          <div><dt className="font-display font-semibold">ชนิดงานวิจัย (<code className="font-code">study_types</code>)</dt>
            <dd className="text-muted">RCT, Cohort, Case-control, Cross-sectional, Non-randomized trial, Qualitative, Mixed methods หรือ <code className="font-code">&quot;Other: …&quot;</code> (ไม่เกิน 60 ตัวอักษร) · ไม่ระบุ = ไม่จำกัด</dd></div>
          <div><dt className="font-display font-semibold">สิ่งที่อยู่ในผลลัพธ์</dt>
            <dd className="text-muted">ตารางเทียบผล ตารางงานวิจัย (literature matrix) แผนที่ความรู้ แผนภาพ PRISMA และ forest plot เครือข่ายการอ้างอิง (<code className="font-code">result.citations</code>) และค่ารวมของ meta-analysis (<code className="font-code">result.meta_analysis</code>) ส่งออกได้เป็น Markdown, CSV, JSON และ HTML ที่เปิดได้ออฟไลน์</dd></div>
        </dl>
      </section>

      <section aria-labelledby="h-live" className="grid gap-3">
        <h2 id="h-live" className="text-2xl font-bold">ขีดจำกัดตอนนี้</h2>
        <LiveLimits />
      </section>

      <section aria-labelledby="h-rest" className="grid gap-4">
        <h2 id="h-rest" className="text-2xl font-bold">REST API</h2>
        <p className="max-w-[65ch]">เอกสาร OpenAPI ฉบับเต็มอยู่ที่ <a className="text-primary underline underline-offset-2" href={`${api}/api/docs`}>{api}/api/docs</a></p>
        <CodeBlock label="REST" code={s.rest} />
        <CodeBlock label="ค้นงานวิจัย (ได้ชื่อเรื่อง บทคัดย่อ และตัวระบุ)" code={s.papers} />
        <p className="max-w-[65ch]">
          ถ้าผู้ให้บริการเปิด Cloudflare Turnstile การส่งรีวิวแบบไม่ใช้ key ต้องมาจากหน้าเว็บ (หัว
          <code className="font-code"> cf-turnstile-response</code>) สคริปต์และระบบอื่นจึงควรใช้ API key
          ส่วน MCP ไม่ต้องผ่าน Turnstile ระบบเปิดสตรีม SSE พร้อมกันได้จำกัดต่อผู้ใช้ เกินแล้วจะได้ 429
        </p>
      </section>

      <section aria-labelledby="h-keys" className="grid gap-4">
        <h2 id="h-keys" className="text-2xl font-bold">API key และ webhook</h2>
        <p className="max-w-[65ch]">
          API key เพิ่มจำนวนรีวิวต่อชั่วโมง (พร้อมโควตาต่อวันของแต่ละ key) เปิดใช้ <code className="font-code">callback_url</code> และให้ยกเลิกรีวิวที่ตัวเองสร้างได้
          ส่ง key ทาง <code className="font-code">X-API-Key</code> หรือ <code className="font-code">Authorization: Bearer</code> เท่านั้น
          key ที่ส่งมาแต่ใช้ไม่ได้จะได้ 401 ไม่ถูกลดเป็นผู้ใช้ไม่ระบุตัวตน
        </p>
        <CodeBlock label="ใช้ API key" code={s.key} />
        <p className="max-w-[65ch]">
          เมื่อรีวิวจบ (done, error, rejected หรือ cancelled) ระบบ POST <code className="font-code">{"{review_id, status, result_url}"}</code> ไปยัง callback_url
          (ต้องเป็น HTTPS และเป็นที่อยู่สาธารณะ ลองส่งสูงสุด 3 ครั้งห่างกัน 10 และ 20 วินาที เมื่อเครือข่ายขัดข้อง 5xx หรือ 429)
          พร้อมหัว <code className="font-code">X-Signature</code> ตรวจลายเซ็นด้วย secret = SHA-256 ของ API key
          ถ้าการตอบกลับมี <code className="font-code">&quot;cached&quot;: true</code> แปลว่าใช้รีวิวที่มีอยู่แล้วและไม่มี webhook ให้ดึงผลด้วย GET แทน
        </p>
        <CodeBlock label="ตรวจลายเซ็น (Python)" code={s.pyVerify} />
        <CodeBlock label="ตรวจลายเซ็น (Node.js)" code={s.nodeVerify} />
      </section>

      <section aria-labelledby="h-mcp" className="grid gap-4">
        <h2 id="h-mcp" className="text-2xl font-bold">MCP สำหรับ AI agent</h2>
        <p className="max-w-[65ch]">
          เครื่องมือ: <b>search_papers</b>, <b>start_review</b>, <b>get_review_status</b>, <b>get_review_result</b> ·
          resources: <code className="font-code">review://&lt;id&gt;</code> และ <code className="font-code">review://&lt;id&gt;/report.md</code> ·
          prompt: <b>literature_review</b> · รอสถานะจนเป็น done, error, rejected หรือ cancelled (ปกติ 1–3 นาที)
          <code className="font-code">start_review</code> รับ topic, language, max_papers (ปรับให้อยู่ในช่วง 5–30), review_type, study_types และ year_from
          เหมือน REST และเมื่อระบบเต็มเครื่องมือจะบอกเหตุผลและเวลาที่ควรลองใหม่
        </p>
        <CodeBlock label="Claude Code" code={s.claudeCode} />
        <CodeBlock label="MCP client ทั่วไป (JSON)" code={s.mcpJson} />
      </section>

      <section aria-labelledby="h-limits" className="grid gap-3">
        <h2 id="h-limits" className="text-2xl font-bold">ขอบเขตและข้อจำกัด</h2>
        <ul className="grid max-w-[65ch] list-disc gap-2 pl-5">
          <li>เป็นการทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติจากบทคัดย่อ แม้เลือกรูปแบบ systematic review ก็ไม่แทน systematic review ที่ผู้เชี่ยวชาญทำตามมาตรฐานเต็ม และไม่ใช่คำแนะนำทางการแพทย์</li>
          <li>ใช้เฉพาะบทคัดย่อ ไม่ดาวน์โหลดฉบับเต็ม: ค่าเริ่มต้นคัดกรองงานที่มีบทคัดย่อ 60 ฉบับ (ปรับได้ 20–100) แล้ววิเคราะห์สูงสุด 30 ฉบับ (ปรับได้ 5–30) รายละเอียดที่มีแต่ในฉบับเต็มจึงอาจไม่ปรากฏ</li>
          <li>ระบบรับรีวิวใหม่วันละจำนวนจำกัดและจำกัดค่าใช้จ่ายต่อวันและต่อรีวิว เมื่อคิวเต็มหรือครบกำหนดวันจะได้ 503 พร้อมเหตุผลและเวลาที่เปิดรับอีกครั้ง (รีวิวที่เคยทำยังเปิดดูได้)</li>
          <li>ตัวเลขที่ตรวจกับประโยคในบทคัดย่อไม่ผ่านจะถูกเว้นว่างและแสดงเป็น “ไม่ยืนยัน” ไม่มีการเดาค่า</li>
          <li>ความแข็งแรงของหลักฐาน (เฉพาะ systematic review และ meta-analysis) เป็นแบบ GRADE-lite ที่คำนวณจากรูปแบบการศึกษา ความเสี่ยงอคติ ความสอดคล้อง และขนาดตัวอย่าง</li>
          <li>เครือข่ายการอ้างอิงใช้ข้อมูลเมทาดาทาจาก OpenAlex (สำรองด้วย Europe PMC) เฉพาะระหว่างงานวิจัยในรีวิวเดียวกัน ถ้าไม่มีข้อมูลจะแสดงว่า “ไม่มีข้อมูล” ไม่ใช่ “ไม่อ้างอิง”</li>
          <li>งานเชิงคุณภาพและแบบผสมผสาน (Qualitative, Mixed methods) รองรับแบบจำกัด: สรุปเป็นประเด็นจากบทคัดย่อ ไม่มีค่าผลเชิงตัวเลข ไม่นับในทิศทางผล แผนภาพ หรือค่ารวม</li>
          <li>ชนิด meta-analysis รวมผลด้วยวิธี DerSimonian–Laird (random effects) เฉพาะงานวิจัยปฐมภูมิที่มีผลและช่วงเชื่อมั่น 95% ผ่านการตรวจกับบทคัดย่อ อย่างน้อย 3 ฉบับ ค่ารวมเป็นตัวเลขที่ระบบคำนวณเอง ไม่ใช่ผลจากงานวิจัยฉบับใด</li>
        </ul>
      </section>
    </div>
  );
}
