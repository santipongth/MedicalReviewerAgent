import { AgentBand } from "@/components/landing/agent-band";
import { Anatomy } from "@/components/landing/anatomy";
import { RecentReviews } from "@/components/landing/recent-reviews";
import { SampleBench } from "@/components/landing/sample-bench";
import { Timeline } from "@/components/landing/timeline";
import { publicApiUrl } from "@/lib/public-api";
import { RequestSlip } from "@/components/landing/request-slip";

export default async function Home(props: PageProps<"/">) {
  const { q } = await props.searchParams;
  const initialTopic = (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 300) || undefined;
  return (
    <div className="grid gap-16">
      <section aria-labelledby="h-home" className="grid items-center gap-8 pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <div className="min-w-0">
          <h1 id="h-home" className="text-[clamp(2rem,4.2vw,3.25rem)] font-bold leading-[1.15]">
            <span className="nw">อย่าเพิ่งเชื่อเรา</span> <span className="nw">แตะที่ตัวเลข</span><span className="nw">ดูก่อน</span>
          </h1>
          <p className="mt-5 max-w-[52ch] text-[1.05rem] text-muted">
            ส่งคำถามเรื่องโรค ยา หรือสาร เอเจนต์จะอ่านงานวิจัยที่เกี่ยวข้อง เทียบผลที่ตรงกันและขัดกัน
            และให้คุณตรวจทุกตัวเลขกับประโยคต้นฉบับได้ ฟรี ไม่ต้องสมัคร
          </p>
          <a href="#request" className="mt-5 inline-flex min-h-11 items-center rounded-sm border border-rule px-4 font-display font-medium text-primary hover:border-primary lg:hidden">
            ส่งคำถามของคุณ ↓
          </a>
        </div>
        <RequestSlip initialTopic={initialTopic} />
      </section>
      <SampleBench />
      <Anatomy />
      <Timeline />
      <AgentBand api={await publicApiUrl()} />
      <RecentReviews />
    </div>
  );
}
