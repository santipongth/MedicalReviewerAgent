import { PHASES, PHASE_LABEL } from "@/lib/agent-team";
import { CHECK } from "../stage/icons";
import { LegendGroup, LegendItem, PapersLegendGroup } from "../stage/stage-legend";

/**
 * Key to the team view's phase marks (HTML text, not part of the stage image). 2D: the phase-name markers (filled
 * square now, check passed, hollow square rest) plus the papers group for the reader pool. 3D: the tiles above each
 * head (raised `primary` now, `ink` passed, `rule` rest) and their left-to-right order; there is no reader pool there.
 */
export function TeamLegend({ variant = "2d" }: { variant?: "2d" | "3d" }) {
  if (variant === "3d") {
    return (
      <ul aria-label="สัญลักษณ์" className="flex flex-wrap gap-x-10 gap-y-2 text-xs text-muted" data-team-legend="3d">
        <LegendGroup title="ขั้นคิด">
          <LegendItem sample={<rect x={-4.5} y={-6} width={9} height={9} rx={1} className="fill-primary" />}>ขั้นที่กำลังทำ (ยกสูง)</LegendItem>
          <LegendItem sample={<rect x={-3.5} y={-3.5} width={7} height={7} rx={1} className="fill-ink" />}>ผ่านแล้ว</LegendItem>
          <LegendItem sample={<rect x={-3.5} y={-3.5} width={7} height={7} rx={1} className="fill-rule" />}>ยังไม่ถึง</LegendItem>
          <li data-phase-order>เรียงจากซ้ายไปขวา: {PHASES.map((p) => PHASE_LABEL[p]).join(" · ")}</li>
        </LegendGroup>
      </ul>
    );
  }
  return (
    <ul aria-label="สัญลักษณ์" className="flex flex-wrap gap-x-10 gap-y-2 text-xs text-muted" data-team-legend="2d">
      <LegendGroup title="ขั้นคิด">
        <LegendItem sample={<rect x={-4} y={-4} width={8} height={8} rx={1} className="fill-primary" />}>ขั้นที่กำลังทำ</LegendItem>
        <LegendItem sample={<path d={CHECK} fill="none" className="stroke-ink" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}>ผ่านแล้ว</LegendItem>
        <LegendItem sample={<rect x={-3.5} y={-3.5} width={7} height={7} rx={1} fill="none" className="stroke-rule" strokeWidth={1} />}>ยังไม่ถึง</LegendItem>
      </LegendGroup>
      <PapersLegendGroup />
    </ul>
  );
}
