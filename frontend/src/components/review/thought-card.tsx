import { Glyph, UncertainFlag } from "@/components/ui/evidence";
import { formatElapsed, type Scene } from "@/lib/agent-scene";
import { moreQueriesText, paperLines, thoughtFor, type Thought } from "@/lib/agent-thought";
import { StatusMark } from "./stage/status-mark";

function Detail({ d }: { d: NonNullable<Thought["detail"]> }) {
  if (d.kind === "queries") {
    return (
      <ul aria-label="คำค้นที่ใช้" className="grid gap-0.5 font-code text-xs text-muted">
        {d.items.map((q) => <li key={q} className="break-words">{q}</li>)}
        {d.more > 0 && <li className="font-display">{moreQueriesText(d.more)}</li>}
      </ul>
    );
  }
  const lines = paperLines(d);
  return (
    <div className="grid gap-0.5 text-sm">
      <p className="text-muted">
        {lines.lead.split(d.ref).flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className="font-code text-ink">{d.ref}</span>, part]))}
      </p>
      {d.title && <p className="line-clamp-2">{d.title}</p>}
      {d.ok && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {d.direction && <Glyph direction={d.direction} lang="th" />}
          <span className="text-muted">{lines.finding}</span>
          {lines.verified && <span className="font-display tabular-nums text-muted">{lines.verified}</span>}
          {d.uncertain && <UncertainFlag />}
        </p>
      )}
    </div>
  );
}

/** "What the agent is doing now", from the scene only. A labelled region, never a live region. */
export function ThoughtCard({ scene }: { scene: Scene }) {
  const thought = thoughtFor(scene);
  if (!thought) return null;
  return (
    <div aria-labelledby="h-thought" className="min-w-0 flex-1 rounded-sm bg-rail px-3 py-2.5">
      <div key={thought.key} className="grid gap-1 motion-safe:animate-[thought-in_200ms_ease-out] motion-reduce:animate-none">
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2">
            <StatusMark status={thought.status} />
            <span id="h-thought" className="label">เอเจนต์กำลังทำ</span>
            <span className="min-w-0 font-display font-semibold">· {thought.heading}</span>
          </p>
          {thought.since !== null && (
            <span className="flex-none font-display text-xs tabular-nums text-muted">เริ่ม {formatElapsed(thought.since)}</span>
          )}
        </div>
        <p className="line-clamp-3 text-sm md:line-clamp-none">{thought.body}</p>
        {thought.detail && <Detail d={thought.detail} />}
        <p className="hidden text-xs text-muted lg:block">จากเหตุการณ์จริงของรีวิวนี้</p>
      </div>
    </div>
  );
}
