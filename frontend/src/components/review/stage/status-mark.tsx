// 12px status mark: the same shapes as the stage legend, pure SVG (no motion) so eager code can use it.
import type { AgentStatus } from "@/lib/agent-scene";
import { CHECK, CROSS } from "./icons";

export function StatusMark({ status }: { status: AgentStatus | null }) {
  const box = { x: -5, y: -5, width: 10, height: 10, rx: 1 } as const;
  let body;
  switch (status) {
    case "active":
      body = <rect {...box} className="fill-primary" data-mark="active" />;
      break;
    case "working":
      body = <rect {...box} fill="none" className="stroke-primary" strokeWidth={1.5} strokeDasharray="3 2" data-mark="working" />;
      break;
    case "done":
      body = (
        <g data-mark="done">
          <rect {...box} className="fill-ink" />
          <path d={CHECK} transform="scale(.9)" fill="none" className="stroke-ok" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
      break;
    case "failed":
      body = (
        <g data-mark="failed">
          <rect {...box} className="fill-err" />
          <path d={CROSS} transform="scale(.8)" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
        </g>
      );
      break;
    case "paused":
      body = <rect {...box} className="fill-warn" data-mark="paused" />;
      break;
    default: // skipped, idle, or no agent yet
      body = <rect {...box} fill="none" className="stroke-rule" strokeWidth={1.5} strokeDasharray="3 2" data-mark="skipped" />;
  }
  return <svg aria-hidden="true" width={12} height={12} viewBox="-6 -6 12 12" className="shrink-0">{body}</svg>;
}
