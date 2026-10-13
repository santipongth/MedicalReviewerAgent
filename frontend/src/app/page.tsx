import { Capabilities } from "@/components/landing/capabilities";
import { Intro, WhatItIs } from "@/components/landing/intro";
import { RecentReviews } from "@/components/landing/recent-reviews";
import { RequestSlip } from "@/components/landing/request-slip";
import { SampleBench } from "@/components/landing/sample-bench";
import { formStart } from "@/lib/quick";
import { getServerStatus } from "@/lib/server-api";

export default async function Home(props: PageProps<"/">) {
  // ?q= (a retry or an example) and, since Plan 27, the quick answer's "ทำรีวิวฉบับเต็ม" (?mode=full&lang=&year=&types=)
  const start = formStart(await props.searchParams);
  const status = await getServerStatus();
  const limits = status?.limits ?? null; // paper counts in copy come from /status (Plan 21)
  return (
    <div className="grid gap-16">
      <div className="grid gap-8 pt-12">
        <WhatItIs />
        <RequestSlip start={start} limits={limits} />
      </div>
      <SampleBench />
      <Intro />
      <Capabilities sources={status?.sources ?? null} />
      <RecentReviews />
    </div>
  );
}
