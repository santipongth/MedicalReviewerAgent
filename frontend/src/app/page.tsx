import { connection } from "next/server";
import { AgentBand } from "@/components/landing/agent-band";
import { Anatomy } from "@/components/landing/anatomy";
import { SampleBench } from "@/components/landing/sample-bench";
import { Timeline } from "@/components/landing/timeline";
import { publicApiUrl } from "@/lib/public-api";
import { RequestSlip } from "@/components/landing/request-slip";

export default async function Home() {
  await connection(); // the API address is read per request so one image serves every deployment
  return (
    <div className="grid gap-16">
      <section aria-labelledby="h-home" className="grid items-center gap-8 pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <div className="min-w-0">
          <h1 id="h-home" className="text-[clamp(2.1rem,5vw,3.6rem)] font-bold leading-[1.15]">
            <span className="nw">อย่าเพิ่งเชื่อเรา</span> <span className="nw">แตะที่ตัวเลข</span><span className="nw">ดูก่อน</span>
          </h1>
          <p className="mt-5 max-w-[52ch] text-[1.05rem] text-muted">
            ด้านล่างคือรายงานจริงที่ระบบทำไว้ ตัวเลขที่มีเส้นเทปลายทแยงตรวจกับบทคัดย่อแล้ว แตะเพื่อดูประโยคต้นฉบับ
            ส่วนช่องลายเส้นคือค่าที่ตรวจไม่ผ่าน ระบบเว้นว่างไว้ ไม่เดา ส่งคำถามของคุณเองได้ที่ใบส่งคำถาม ฟรี ไม่ต้องสมัคร
          </p>
        </div>
        <RequestSlip />
      </section>
      <SampleBench />
      <Anatomy />
      <Timeline />
      <AgentBand api={await publicApiUrl()} />
    </div>
  );
}
