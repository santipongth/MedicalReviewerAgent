import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { CodeBlock } from "@/components/code-block";
import { CodeTabs } from "@/components/developers/code-tabs";
import { DocsToc } from "@/components/developers/docs-toc";
import { LiveLimits } from "@/components/developers/live-limits";
import { Gloss } from "@/components/ui/gloss";
import { limitsCopy } from "@/lib/developers-copy";
import { publicApiUrl } from "@/lib/public-api";
import { getServerStatus } from "@/lib/server-api";

export const metadata: Metadata = { title: "API และ MCP" };

function snippets(api: string) {
  const mcp = `${api}/mcp`;
  return {
    status: `curl ${api}/api/v1/status`,
    rest: `# 0) ระบบรับรีวิวใหม่อยู่ไหม และขีดจำกัดตอนนี้
curl ${api}/api/v1/status

# 1) ส่งคำถาม (ไม่ต้องมี key; ถ้าคิวเต็มหรือโควตารายวันหมดจะได้ 503 พร้อม reason และ Retry-After)
curl -X POST ${api}/api/v1/reviews \\
  -H "Content-Type: application/json" \\
  -d '{"topic": "metformin and colorectal cancer", "language": "en",
       "options": {"review_type": "slr", "study_types": ["RCT", "Cohort"], "year_from": 2015}}'

# ไม่ส่ง max_papers = วิเคราะห์ตามค่าเริ่มต้น (ช่วงที่ส่งได้อยู่ใน limits.max_papers ของ /status)

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

const TOC = [
  { id: "h-start", label: "เริ่มต้นใช้งาน" },
  { id: "h-live", label: "ขีดจำกัดตอนนี้" },
  { id: "h-how", label: "ระบบทำอะไรให้" },
  { id: "h-rest", label: "REST API" },
  { id: "h-keys", label: "API key และ webhook" },
  { id: "h-mcp", label: "MCP สำหรับ AI agent" },
  { id: "h-limits", label: "ขอบเขตและข้อจำกัด" },
];

const MCP_TOOLS: [string, string][] = [
  ["search_papers", "ค้นงานวิจัยจาก 8 แหล่งในครั้งเดียว ได้ชื่อเรื่อง บทคัดย่อ และรหัสประจำบทความ"],
  ["start_review", "เริ่มรีวิวได้ 4 รูปแบบเหมือนหน้าเว็บ เลือกชนิดงานวิจัยและปีได้ รายงานเป็นภาษาไทยหรืออังกฤษ"],
  ["get_review_status", "ดูสถานะ: รอคิว (queued) กำลังทำ (running) เสร็จ (done) ผิดพลาด (error) ไม่รับหัวข้อ (rejected) หรือยกเลิก (cancelled)"],
  ["get_review_result", "คำถามวิจัย ตารางเทียบ ข้อขัดแย้ง ระดับหลักฐาน เครือข่ายการอ้างอิง และค่ารวมจากการวิเคราะห์อภิมาน พร้อมประโยคต้นฉบับของทุกตัวเลข"],
];

type Method = "GET" | "POST" | "DELETE";
const ENDPOINTS: [Method, string, string][] = [
  ["GET", "/api/v1/status", "สถานะระบบและขีดจำกัดตอนนี้"],
  ["POST", "/api/v1/reviews", "เริ่มรีวิว (ตอบ 202 พร้อม review_id)"],
  ["GET", "/api/v1/reviews/{id}/events", "ความคืบหน้าแบบสด (Server-Sent Events)"],
  ["GET", "/api/v1/reviews/{id}", "สถานะและผลลัพธ์ (ระหว่างรอคิวมี queue_position)"],
  ["GET", "/api/v1/reviews/{id}/export", "ดาวน์โหลดเมื่อเสร็จ: format=md | csv | json"],
  ["DELETE", "/api/v1/reviews/{id}", "ยกเลิกรีวิวที่รอคิวหรือกำลังทำ (ต้องใช้ API key ที่สร้างรีวิวนั้น)"],
  ["GET", "/api/v1/reviews", "รีวิวสาธารณะที่เสร็จล่าสุด"],
  ["GET", "/api/v1/papers/search", "ค้นงานวิจัย (ได้ชื่อเรื่อง บทคัดย่อ และตัวระบุ)"],
];

const METHOD_STYLE: Record<Method, string> = {
  GET: "border-rule text-ink",
  POST: "border-primary text-primary",
  DELETE: "border-transparent bg-warn-bg text-ink",
};

const H2 = "scroll-mt-[calc(var(--header-h)+env(safe-area-inset-top,0px)+1.5rem)] text-[1.6rem] font-bold";
const CODE = "font-code text-[0.88em]";

/** A docs section: prose on the left and, from 1280px, its code samples beside it on the right. */
function DocSection({ id, title, children, aside }: { id: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id}
      className={`grid grid-cols-[minmax(0,1fr)] gap-6 border-t border-rule pt-10 ${aside ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:gap-10" : ""}`}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
        <h2 id={id} className={H2}>{title}</h2>
        {children}
      </div>
      {aside && <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 xl:pt-14">{aside}</div>}
    </section>
  );
}

/** A ruled two-column list (term · description) that stacks on a phone. */
function RuledList({ label, rows }: { label: string; rows: [ReactNode, ReactNode, string?][] }) {
  return (
    <ul aria-label={label} className="grid border-t border-rule">
      {rows.map(([term, body, key], i) => (
        <li key={key ?? i} className="grid gap-x-6 gap-y-1 border-b border-rule py-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="min-w-0">{term}</div>
          <div className="min-w-0 text-[0.95rem] leading-[1.7] text-muted">{body}</div>
        </li>
      ))}
    </ul>
  );
}

function QuickStart({ label, purpose, href, children }: { label: string; purpose: string; href: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 rounded-sm border border-rule bg-surface p-4">
      <div className="grid gap-1">
        <h2 className="font-display text-[1.1rem] font-semibold">{label}</h2>
        <p className="text-[0.95rem] text-muted">{purpose}</p>
      </div>
      {children}
      <a href={href} className="inline-flex min-h-11 w-fit items-center text-[0.95rem] text-primary underline underline-offset-2 hover:decoration-2 md:min-h-0">
        อ่านต่อ<span aria-hidden="true">&nbsp;↓</span>
      </a>
    </div>
  );
}

export default async function DevelopersPage() {
  await connection();
  const api = await publicApiUrl();
  const s = snippets(api);
  const lc = limitsCopy((await getServerStatus())?.limits ?? null);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-12">
      <header className="grid grid-cols-[minmax(0,1fr)] gap-8">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-12">
          <div className="grid gap-3">
            <p className="label">สำหรับนักพัฒนา</p>
            <h1 id="h-start" className="scroll-mt-[calc(var(--header-h)+env(safe-area-inset-top,0px)+1.5rem)] text-[clamp(2rem,4vw,2.75rem)] font-bold leading-[1.15]">ใช้งานผ่าน API และ MCP</h1>
          </div>
          <p className="max-w-[65ch] text-[1.05rem] leading-[1.75] text-muted">
            ระบบอื่นและ AI agent ใช้ Medical Reviewer Agent ได้ครบทุกความสามารถเหมือนหน้าเว็บนี้ ผ่าน <Gloss k="api">REST API</Gloss> หรือ <Gloss k="mcp">Model Context Protocol หรือ MCP</Gloss>
            ทุกช่องทางใช้ข้อจำกัดอัตราและแคชผลลัพธ์ชุดเดียวกัน หัวข้อ ภาษา และตัวเลือกเดิมภายใน 24 ชั่วโมง (หรือที่ยังทำอยู่)
            จะได้รีวิวเดิมกลับไปโดยไม่นับโควตา
          </p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
          <QuickStart label="REST API" purpose="เช็กสถานะและขีดจำกัด แล้วส่งคำถามด้วย POST" href="#h-rest">
            <CodeBlock label="เริ่มที่ /status" code={s.status} />
          </QuickStart>
          <QuickStart label="Claude Code" purpose="เพิ่มเป็น MCP server ด้วยคำสั่งเดียว" href="#h-mcp">
            <CodeBlock label="Claude Code" code={s.claudeCode} />
          </QuickStart>
          <QuickStart label="MCP client อื่น" purpose="ใส่ในไฟล์ตั้งค่าของโปรแกรมที่รองรับ MCP" href="#h-mcp">
            <CodeBlock label="ตั้งค่า MCP (JSON)" code={s.mcpJson} />
          </QuickStart>
        </div>
        <p className="flex flex-wrap gap-x-6 gap-y-1 text-[0.95rem] text-muted">
          <span>เอกสาร OpenAPI: <a className="text-primary underline underline-offset-2 hover:decoration-2" href={`${api}/api/docs`}>{api}/api/docs</a></span>
          <span>เอกสารอ้างอิงฉบับเต็ม: <code className={CODE}>docs/api.md</code> ในโค้ดของโปรเจกต์</span>
        </p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
        <DocsToc items={TOC} />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-12">
          <DocSection id="h-live" title="ขีดจำกัดตอนนี้">
            <LiveLimits />
          </DocSection>

          <DocSection id="h-how" title="ระบบทำอะไรให้" aside={
            <RuledList label="พารามิเตอร์ของรีวิว" rows={[
              [<code key="t" className={CODE}>review_type</code>, <><code className={CODE}>slr</code> การทบทวนวรรณกรรมอย่างเป็นระบบ (ค่าเริ่มต้น) · <code className={CODE}>meta_analysis</code> แบบเดียวกันพร้อมค่ารวมที่ระบบคำนวณ · <code className={CODE}>scoping</code> สำรวจขอบเขต · <code className={CODE}>narrative</code> แบบบรรยาย</>, "review_type"],
              [<code key="t" className={CODE}>study_types</code>, <>RCT, Cohort, Case-control, Cross-sectional, Non-randomized trial, Qualitative, Mixed methods, Systematic review, Meta-analysis หรือ <code className={CODE}>&quot;Other: …&quot;</code> (ไม่เกิน 60 ตัวอักษร) · ไม่ระบุ = ไม่จำกัด</>, "study_types"],
              [<code key="t" className={CODE}>language</code>, <><code className={CODE}>th</code> (ค่าเริ่มต้น) หรือ <code className={CODE}>en</code> ภาษาของรายงาน</>, "language"],
              [<code key="t" className={CODE}>max_papers</code>, <>จำนวนงานวิจัยที่วิเคราะห์ {lc.papers}</>, "max_papers"],
              [<code key="t" className={CODE}>year_from</code>, "ปีที่เริ่มค้น (ปี ค.ศ. 4 หลัก) ไม่ระบุ = ไม่จำกัด", "year_from"],
              [<span key="t" className="font-display font-semibold text-ink">สิ่งที่อยู่ในผลลัพธ์</span>, <>ตารางเทียบผล ตารางงานวิจัย (literature matrix) แผนที่ความรู้ แผนภาพ PRISMA และ <Gloss k="forestPlot" /> เครือข่ายการอ้างอิง (<code className={CODE}>result.citations</code>) และค่ารวมของ meta-analysis (<code className={CODE}>result.meta_analysis</code>) ส่งออกได้เป็น Markdown, CSV, JSON และ HTML ที่เปิดได้ออฟไลน์</>, "result"],
            ]} />
          }>
            <ol aria-label="ขั้นตอนของระบบ" className="grid border-t border-rule">
              {[
                <>รับหัวข้อหรือคำถาม (ไม่เกิน 600 ตัวอักษร) แล้วตีความเป็นคำถามวิจัยตาม <Gloss k="pico" /> หรือ <Gloss k="pcc" /> สำหรับการทบทวนขอบเขต</>,
                <>ค้น 8 แหล่ง: PubMed, Europe PMC (รวม <Gloss k="preprint" /> จาก medRxiv/bioRxiv), OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ และ OpenAIRE ผ่าน <Gloss k="searxng" /> แล้วตัดงานซ้ำ</>,
                <>คัดกรองงานที่มี<Gloss k="abstract" />{lc.screen && ` ${lc.screen}`} ตามเกณฑ์ของรูปแบบการทบทวน พร้อมเหตุผลที่คัดออกตาม <Gloss k="prisma" /></>,
                <>อ่านบทคัดย่อของฉบับที่เกี่ยวข้องที่สุด{lc.read} สกัดผล ตัวเลข และ<Gloss k="riskOfBias" /> ตรวจตัวเลขทุกตัวกับประโยคต้นฉบับ</>,
                <>เทียบผลข้ามงานวิจัย อธิบายจุดที่ขัดกัน สรุปผล (ประเมินระดับความแข็งแรงของหลักฐานเฉพาะ <Gloss k="slr" /> และ <Gloss k="metaAnalysis" />{" "}
                  ไม่ประเมินใน <Gloss k="narrativeReview" /> หรือ <Gloss k="scopingReview" />) และแปลเป็นภาษาไทยโดยตัวเลขไม่เปลี่ยน</>,
              ].map((body, i) => (
                <li key={i} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-rule py-3.5">
                  <span aria-hidden="true" className="font-display text-[1.05rem] font-semibold tabular-nums text-muted">{i + 1}</span>
                  <p className="max-w-[65ch] leading-[1.75]">{body}</p>
                </li>
              ))}
            </ol>
          </DocSection>

          <DocSection id="h-rest" title="REST API" aside={<>
            <CodeBlock label="REST" code={s.rest} />
            <CodeBlock label="ค้นงานวิจัย" code={s.papers} />
          </>}>
            <ul aria-label="เส้นทางของ REST API" className="grid border-t border-rule">
              {ENDPOINTS.map(([method, path, body]) => (
                <li key={`${method} ${path}`} className="grid gap-x-4 gap-y-1 border-b border-rule py-3 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
                  <span className={`w-fit rounded-sm border px-1.5 py-0.5 font-code text-[0.75rem] font-semibold ${METHOD_STYLE[method]}`}>{method}</span>
                  <div className="grid min-w-0 gap-0.5">
                    <code className="font-code text-[0.88rem] break-all">{path}</code>
                    <span className="text-[0.92rem] text-muted">{body}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="max-w-[65ch] leading-[1.75]">
              ถ้าผู้ให้บริการเปิด Cloudflare Turnstile การส่งรีวิวแบบไม่ใช้ key ต้องมาจากหน้าเว็บ (หัว
              <code className={CODE}> cf-turnstile-response</code>) สคริปต์และระบบอื่นจึงควรใช้ API key
              ส่วน MCP ไม่ต้องผ่าน Turnstile ระบบเปิดสตรีม SSE พร้อมกันได้จำกัดต่อผู้ใช้ เกินแล้วจะได้ 429
            </p>
          </DocSection>

          <DocSection id="h-keys" title="API key และ webhook" aside={<>
            <CodeBlock label="ใช้ API key" code={s.key} />
            <CodeTabs label="ตรวจลายเซ็น" tabs={[{ name: "Python", code: s.pyVerify }, { name: "Node.js", code: s.nodeVerify }]} />
          </>}>
            <div className="grid gap-2">
              <h3 className="font-display text-[1.1rem] font-semibold">API key ให้อะไรเพิ่ม</h3>
              <p className="max-w-[65ch] leading-[1.75]">
                API key เพิ่มจำนวนรีวิวต่อชั่วโมง (พร้อมโควตาต่อวันของแต่ละ key) เปิดใช้ <code className={CODE}>callback_url</code> และให้ยกเลิกรีวิวที่ตัวเองสร้างได้
                ส่ง key ทาง <code className={CODE}>X-API-Key</code> หรือ <code className={CODE}>Authorization: Bearer</code> เท่านั้น
                key ที่ส่งมาแต่ใช้ไม่ได้จะได้ 401 ไม่ถูกลดเป็นผู้ใช้ไม่ระบุตัวตน
              </p>
            </div>
            <div className="grid gap-2">
              <h3 className="font-display text-[1.1rem] font-semibold">Webhook</h3>
              <p className="max-w-[65ch] leading-[1.75]">
                เมื่อรีวิวจบ (done, error, rejected หรือ cancelled) ระบบ POST <code className={CODE}>{"{review_id, status, result_url}"}</code> ไปยัง callback_url
                (ต้องเป็น HTTPS และเป็นที่อยู่สาธารณะ ลองส่งสูงสุด 3 ครั้งห่างกัน 10 และ 20 วินาที เมื่อเครือข่ายขัดข้อง 5xx หรือ 429)
                พร้อมหัว <code className={CODE}>X-Signature</code> ตรวจลายเซ็นด้วย secret = SHA-256 ของ API key
              </p>
              <p className="max-w-[65ch] leading-[1.75] text-muted">
                ถ้าการตอบกลับมี <code className={CODE}>&quot;cached&quot;: true</code> แปลว่าใช้รีวิวที่มีอยู่แล้วและไม่มี webhook ให้ดึงผลด้วย GET แทน
              </p>
            </div>
          </DocSection>

          <DocSection id="h-mcp" title="MCP สำหรับ AI agent" aside={
            <dl className="grid border-t border-rule">
              <div className="grid gap-1 border-b border-rule py-3">
                <dt className="font-display font-semibold">เชื่อมต่อ</dt>
                <dd className="text-[0.95rem] leading-[1.7] text-muted">
                  endpoint <code className={CODE}>/mcp</code> แบบ streamable HTTP ใช้ได้โดยไม่ต้องมี API key คำสั่งและไฟล์ตั้งค่าอยู่ใน
                  {" "}<a href="#h-start" className="text-primary underline underline-offset-2 hover:decoration-2">เริ่มต้นใช้งาน</a>
                </dd>
              </div>
              <div className="grid gap-1 border-b border-rule py-3">
                <dt className="font-display font-semibold">resources</dt>
                <dd className="text-[0.95rem] leading-[1.7] text-muted"><code className={CODE}>review://&lt;id&gt;</code> และ <code className={CODE}>review://&lt;id&gt;/report.md</code></dd>
              </div>
              <div className="grid gap-1 border-b border-rule py-3">
                <dt className="font-display font-semibold">prompt</dt>
                <dd className="text-[0.95rem] leading-[1.7] text-muted"><code className={CODE}>literature_review</code> · รอสถานะจนเป็น done, error, rejected หรือ cancelled (ปกติ 1–3 นาที)</dd>
              </div>
              <div className="grid gap-1 border-b border-rule py-3">
                <dt className="font-display font-semibold"><code className={CODE}>start_review</code></dt>
                <dd className="text-[0.95rem] leading-[1.7] text-muted">รับ topic, language, max_papers ({lc.mcpRange}), review_type, study_types และ year_from
                  เหมือน REST และเมื่อระบบเต็มเครื่องมือจะบอกเหตุผลและเวลาที่ควรลองใหม่</dd>
              </div>
            </dl>
          }>
            <RuledList label="เครื่องมือ MCP" rows={MCP_TOOLS.map(([name, body]) => [
              <code key={name} className="font-code text-[0.9rem] font-semibold">{name}</code>, body, name])} />
          </DocSection>

          <DocSection id="h-limits" title="ขอบเขตและข้อจำกัด">
            <p className="max-w-[65ch] rounded-sm bg-warn-bg p-4 leading-[1.75]">
              เป็นการทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติจากบทคัดย่อ แม้เลือกรูปแบบ systematic review ก็ไม่แทน systematic review ที่ผู้เชี่ยวชาญทำตามมาตรฐานเต็ม และไม่ใช่คำแนะนำทางการแพทย์
            </p>
            <ul aria-label="ข้อจำกัด" className="grid border-t border-rule md:grid-cols-2 md:gap-x-10">
              {[
                <>ใช้เฉพาะบทคัดย่อ ไม่ดาวน์โหลดฉบับเต็ม: {lc.scope} รายละเอียดที่มีแต่ในฉบับเต็มจึงอาจไม่ปรากฏ</>,
                <>ระบบรับรีวิวใหม่วันละจำนวนจำกัดและจำกัดค่าใช้จ่ายต่อวันและต่อรีวิว เมื่อคิวเต็มหรือครบกำหนดวันจะได้ 503 พร้อมเหตุผลและเวลาที่เปิดรับอีกครั้ง (รีวิวที่เคยทำยังเปิดดูได้)</>,
                <>ตัวเลขที่ตรวจกับประโยคในบทคัดย่อไม่ผ่านจะถูกเว้นว่างและแสดงเป็น “ไม่ยืนยัน” ไม่มีการเดาค่า</>,
                <>ความแข็งแรงของหลักฐาน (เฉพาะ systematic review และ meta-analysis) เป็นแบบ <Gloss k="grade" suffix="แบบย่อ">GRADE-lite</Gloss> ที่คำนวณจากรูปแบบการศึกษา ความเสี่ยงอคติ ความสอดคล้อง และขนาดตัวอย่าง</>,
                <>เครือข่ายการอ้างอิงใช้ข้อมูลเมทาดาทาจาก OpenAlex (สำรองด้วย Europe PMC) เฉพาะระหว่างงานวิจัยในรีวิวเดียวกัน ถ้าไม่มีข้อมูลจะแสดงว่า “ไม่มีข้อมูล” ไม่ใช่ “ไม่อ้างอิง”</>,
                <>งานเชิงคุณภาพและแบบผสมผสาน (Qualitative, Mixed methods) รองรับแบบจำกัด: สรุปเป็นประเด็นจากบทคัดย่อ ไม่มีค่าผลเชิงตัวเลข ไม่นับในทิศทางผล แผนภาพ หรือค่ารวม</>,
                <>ยังไม่รองรับการทบทวนความแม่นยำของการวินิจฉัย (diagnostic test accuracy): ค่าความไว (sensitivity) ความจำเพาะ (specificity) และ AUC แสดงเป็นผลทั่วไปจากบทคัดย่อ ไม่นำมารวมผลและไม่วาดใน forest plot คำถามด้านการวินิจฉัยไม่มีทิศทางของผล ระบบจึงไม่สรุปความเห็นพ้องหรือความขัดแย้งระหว่างงานวิจัย และระดับหลักฐาน GRADE-lite ไม่ประเมินความไม่สอดคล้อง (inconsistency) ควรตีความระดับหลักฐานอย่างระมัดระวัง</>,
                <>ชนิด meta-analysis รวมผลด้วยวิธี DerSimonian–Laird แบบ <Gloss k="randomEffects" /> เฉพาะงานวิจัยปฐมภูมิที่มีผลและช่วงเชื่อมั่น 95% ผ่านการตรวจกับบทคัดย่อ อย่างน้อย 3 ฉบับ ค่ารวมเป็นตัวเลขที่ระบบคำนวณเอง ไม่ใช่ผลจากงานวิจัยฉบับใด</>,
              ].map((body, i) => (
                <li key={i} className="border-b border-rule py-3.5 text-[0.98rem] leading-[1.75]">{body}</li>
              ))}
            </ul>
          </DocSection>
        </div>
      </div>
    </div>
  );
}
