import { AgentBand } from "@/components/landing/agent-band";
import { Anatomy } from "@/components/landing/anatomy";
import { Capabilities } from "@/components/landing/capabilities";
import { Intro, WhatItIs } from "@/components/landing/intro";
import { RecentReviews } from "@/components/landing/recent-reviews";
import { SampleBench } from "@/components/landing/sample-bench";
import { Timeline } from "@/components/landing/timeline";
import { publicApiUrl } from "@/lib/public-api";
import { getServerStatus } from "@/lib/server-api";
import { RequestSlip } from "@/components/landing/request-slip";

export default async function Home(props: PageProps<"/">) {
  const { q } = await props.searchParams;
  const initialTopic = (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 600) || undefined;
  const limits = (await getServerStatus())?.limits ?? null; // paper counts in copy come from /status (Plan 21)
  return (
    <div className="grid gap-16">
      <div className="grid gap-8 pt-12">
        <section aria-labelledby="h-home" className="grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
          <h1 id="h-home" className="text-[clamp(2rem,4.2vw,3.25rem)] font-bold leading-[1.15]">
            <span className="nw">อย่าเพิ่งเชื่อเรา</span> <span className="nw">แตะที่ตัวเลข</span><span className="nw">ดูก่อน</span>
          </h1>
          <WhatItIs />
        </section>
        <RequestSlip initialTopic={initialTopic} limits={limits} />
      </div>
      <Intro />
      <SampleBench />
      <Capabilities />
      <Anatomy />
      <Timeline limits={limits} />
      <AgentBand api={await publicApiUrl()} />
      <RecentReviews />
    </div>
  );
}
