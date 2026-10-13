import { EMERGENCY_COPY, HOTLINE_LABEL, hotlinesFor, type EmergencyKind } from "@/lib/refusal-copy";

const CALL =
  "inline-flex min-h-12 items-center rounded-sm border border-primary bg-primary px-5 font-display font-semibold text-on-primary no-underline hover:brightness-110";

/** Plan 26: the answer to a topic that reads as an emergency. No review was created; the numbers are call links. */
export function EmergencyPanel({ kind, hotlines }: { kind: EmergencyKind; hotlines?: readonly string[] }) {
  const copy = EMERGENCY_COPY[kind];
  // the server's list, in its order (digits only: it becomes a tel: link); the built-in list when it sent none
  const sent = (hotlines ?? []).filter((n) => /^\d{3,6}$/.test(n));
  const numbers = sent.length ? sent : hotlinesFor(kind);
  return (
    <div role="alert" data-emergency={kind} className="grid gap-3 border-t border-rule bg-err-bg px-4 py-4 sm:px-6">
      <p className="font-display text-[1.15rem] font-semibold">{copy.title}</p>
      <p className="max-w-[65ch] text-[0.95rem] leading-[1.7]">{copy.body}</p>
      <div className="flex flex-wrap gap-3">
        {numbers.map((n) => (
          <a key={n} href={`tel:${n}`} className={CALL}>{HOTLINE_LABEL[n] ?? `โทร ${n}`}</a>
        ))}
      </div>
    </div>
  );
}
