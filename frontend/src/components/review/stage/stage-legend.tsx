import type { ReactNode } from "react";
import { FLAG_PATHS } from "@/components/ui/evidence";
import { READING_OR_QUEUED } from "@/lib/copy";
import { CHECK, CROSS } from "./icons";

function Sample({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" width="22" height="18" viewBox="-11 -9 22 18" className="shrink-0">{children}</svg>;
}

export function LegendItem({ sample, children }: { sample: ReactNode; children: ReactNode }) {
  return <li className="inline-flex items-center gap-1.5"><Sample>{sample}</Sample>{children}</li>;
}
const Item = LegendItem;

export function LegendGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span aria-hidden="true" className="label">{title}</span>
      <ul aria-label={title} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">{children}</ul>
    </li>
  );
}

/**
 * Key to the stage's status shapes (HTML, so it is readable text, not part of the svg image), in two groups: the
 * agents' steps (tiles) and the papers (reader slots).
 */
const Group = LegendGroup;

/** The reader-slot key, shared by the steps and team views. */
export function PapersLegendGroup() {
  return (
    <Group title="งานวิจัย">
      <Item sample={<circle r={7} fill="none" className="stroke-primary" strokeWidth={1.5} />}>{READING_OR_QUEUED}</Item>
      <Item sample={<>
        <circle r={7} fill="none" className="stroke-err" strokeWidth={1.25} />
        <path d={CROSS} fill="none" className="stroke-err" strokeWidth={1.25} strokeLinecap="round" />
      </>}>อ่านไม่สำเร็จ</Item>
      <Item sample={<>
        <circle r={7} fill="none" className="stroke-warn" strokeWidth={1.25} />
        <g transform="translate(-4.8 -4.8) scale(.8)" className="fill-warn"><path d={FLAG_PATHS[0]} /><path d={FLAG_PATHS[1]} /></g>
      </>}>สองโมเดลอ่านต่างกัน</Item>
    </Group>
  );
}

export function StageLegend() {
  return (
    <ul aria-label="สัญลักษณ์" className="flex flex-wrap gap-x-10 gap-y-2 text-xs text-muted">
      <Group title="ขั้นตอน">
        <Item sample={<rect x={-8} y={-6} width={16} height={12} rx={2} fill="none" className="stroke-primary" strokeWidth={2} />}>กำลังทำ</Item>
        <Item sample={<rect x={-8} y={-6} width={16} height={12} rx={2} fill="none" className="stroke-primary" strokeWidth={1.5} strokeDasharray="4 3" />}>
          กำลังทำ (ไม่มีความคืบหน้าให้ดู)
        </Item>
        <Item sample={<>
          <rect x={-8} y={-6} width={16} height={12} rx={2} fill="none" className="stroke-ink" strokeWidth={1} />
          <path d={CHECK} fill="none" className="stroke-ok" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
        </>}>เสร็จ</Item>
        <Item sample={<rect x={-8} y={-6} width={16} height={12} rx={2} fill="none" className="stroke-rule" strokeWidth={1} strokeDasharray="4 3" />}>ข้ามขั้นนี้</Item>
      </Group>
      <PapersLegendGroup />
    </ul>
  );
}
