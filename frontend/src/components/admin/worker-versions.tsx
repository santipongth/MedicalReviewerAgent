import { formatWhen } from "@/lib/admin-copy";
import type { LoadedWorker } from "@/lib/admin-types";
import { isStale } from "@/lib/admin-workers";

/** Which settings or glossary version each worker runs (Plan 23c), by the rules of the models header (Plan 23b): a
 * worker on another version is "changing" while the page's own write settles and a warning after that, a failed
 * reload and a worker silent for over 2 minutes are warnings, and each says so in words as well as colour. `now` is
 * when the page read the reports. */
export function WorkerVersions({ loaded, field, expected, now, settling = false }: {
  loaded: LoadedWorker[]; field: "settings" | "glossary"; expected: string; now: number; settling?: boolean;
}) {
  if (loaded.length === 0) {
    return <p className="mt-2 text-sm text-muted">ยังไม่มี worker รายงาน (worker จะรายงานภายใน 30 วินาทีหลังเริ่มทำงาน)</p>;
  }
  return (
    <ul className="mt-2 grid gap-1 text-sm" aria-label="worker">
      {loaded.map((w) => {
        const version = w[field] ?? (field === "settings" ? "env" : "file");
        const other = version !== expected;
        const changing = other && settling;
        const stale = isStale(w.loaded_at, now);
        const off = (other && !changing) || Boolean(w.runtime_error) || stale;
        return (
          <li key={w.worker} className={off ? "rounded-sm bg-warn-bg px-2 py-1" : "text-muted"}>
            {`${w.worker} · ${other ? `ยังใช้ ${version}` : "ตรงกับที่ใช้งาน"} · รายงานล่าสุด ${formatWhen(w.loaded_at)}`}
            {changing ? ` · กำลังเปลี่ยนเป็น ${expected} (ภายใน 30 วินาที)` : ""}
            {w.runtime_error ? ` · โหลดไม่สำเร็จ: ${w.runtime_error}` : ""}
            {stale ? " · ไม่ได้รายงานเกิน 2 นาที (worker อาจหยุดทำงาน)" : ""}
          </li>
        );
      })}
    </ul>
  );
}
