import type { ReactNode } from "react";
import { FLAG_PATHS } from "@/components/ui/evidence";
import { CHECK, CROSS } from "./icons";

function Sample({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" width="22" height="18" viewBox="-11 -9 22 18" className="shrink-0">{children}</svg>;
}

/** Key to the stage's status shapes (HTML, so it is readable text, not part of the svg image). */
export function StageLegend() {
  return (
    <ul aria-label="สัญลักษณ์" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <li className="inline-flex items-center gap-1.5">
        <Sample><rect x={-8} y={-6} width={16} height={12} rx={2} fill="none" className="stroke-primary" strokeWidth={2} /></Sample>กำลังทำ
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Sample><rect x={-8} y={-6} width={16} height={12} rx={2} fill="none" className="stroke-primary" strokeWidth={1.5} strokeDasharray="4 3" /></Sample>กำลังทำ (ไม่มีความคืบหน้าให้ดู)
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Sample>
          <rect x={-8} y={-6} width={16} height={12} rx={2} fill="none" className="stroke-ink" strokeWidth={1} />
          <path d={CHECK} fill="none" className="stroke-ok" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
        </Sample>เสร็จ
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Sample><rect x={-8} y={-6} width={16} height={12} rx={2} fill="none" className="stroke-rule" strokeWidth={1} strokeDasharray="4 3" /></Sample>ข้ามขั้นนี้
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Sample>
          <circle r={7} fill="none" className="stroke-err" strokeWidth={1.25} />
          <path d={CROSS} fill="none" className="stroke-err" strokeWidth={1.25} strokeLinecap="round" />
        </Sample>อ่านไม่สำเร็จ
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Sample>
          <circle r={7} fill="none" className="stroke-warn" strokeWidth={1.25} />
          <g transform="translate(-4.8 -4.8) scale(.8)" className="fill-warn"><path d={FLAG_PATHS[0]} /><path d={FLAG_PATHS[1]} /></g>
        </Sample>สองโมเดลอ่านต่างกัน
      </li>
    </ul>
  );
}
