import { Capabilities } from "@/components/landing/capabilities";
import { Intro, WhatItIs } from "@/components/landing/intro";
import { RecentReviews } from "@/components/landing/recent-reviews";
import { RequestSlip } from "@/components/landing/request-slip";
import { SampleBench } from "@/components/landing/sample-bench";
import { getServerStatus } from "@/lib/server-api";

export default async function Home(props: PageProps<"/">) {
  const { q } = await props.searchParams;
  const initialTopic = (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 600) || undefined;
  const limits = (await getServerStatus())?.limits ?? null; // paper counts in copy come from /status (Plan 21)
  return (
    <div className="grid gap-16">
      <div className="grid gap-8 pt-12">
        <WhatItIs />
        <RequestSlip initialTopic={initialTopic} limits={limits} />
      </div>
      <SampleBench />
      <Intro />
      <Capabilities />
      <RecentReviews />
    </div>
  );
}
