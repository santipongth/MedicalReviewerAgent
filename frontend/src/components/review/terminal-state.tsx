import Link from "next/link";
import { HOTLINE_LABEL, PERSONAL_MEDICAL_COPY } from "@/lib/refusal-copy";

const COPY = {
  rejected: {
    title: "หัวข้อนี้ไม่ใช่คำถามวิจัยทางการแพทย์",
    body: "เอเจนต์ทบทวนเฉพาะคำถามด้านการแพทย์ สาธารณสุข เภสัชวิทยา และชีววิทยาที่ตอบได้จากงานวิจัยที่ตีพิมพ์แล้ว ลองระบุชื่อโรค ยา หรือสาร",
  },
  error: {
    title: "รีวิวนี้ไม่สำเร็จ",
    body: "เกิดปัญหาระหว่างทำงาน ส่วนใหญ่เป็นปัญหาชั่วคราวของบริการภายนอก ลองส่งคำถามเดิมอีกครั้ง",
  },
  cancelled: {
    title: "รีวิวนี้หยุดก่อนเสร็จ",
    body: "อาจถูกหยุดโดยผู้ส่งผ่าน API หรือผู้ดูแลระบบ ส่งคำถามเดิมอีกครั้งได้เลย",
  },
} as const;

const BUTTON = "inline-flex min-h-11 w-fit items-center rounded-sm border px-4 py-2 font-display font-semibold no-underline";

/**
 * Plan 26: a personal medical question (the topic guard's personal_medical) gets a fixed, kind message: no topic, no
 * model reason, no "edit and resend" link that would send the same question again.
 */
function PersonalMedical() {
  return (
    <section className="grid max-w-[65ch] gap-4 pt-12" data-refusal="personal_medical">
      <h1 className="text-[clamp(1.6rem,3vw,2.25rem)] font-bold">{PERSONAL_MEDICAL_COPY.title}</h1>
      <p>{PERSONAL_MEDICAL_COPY.body}</p>
      <p className="text-[0.95rem] text-muted">{PERSONAL_MEDICAL_COPY.askAgain}</p>
      <div className="flex flex-wrap gap-3">
        <a href="tel:1669" className={`${BUTTON} border-primary bg-primary text-on-primary hover:brightness-110`}>{HOTLINE_LABEL["1669"]}</a>
        <a href="tel:1323" className={`${BUTTON} border-primary bg-primary text-on-primary hover:brightness-110`}>{HOTLINE_LABEL["1323"]}</a>
        <Link href="/" className={`${BUTTON} border-rule hover:bg-rail`}>ถามคำถามใหม่</Link>
      </div>
    </section>
  );
}

export function TerminalState({
  status, message, topic, code,
}: { status: "rejected" | "error" | "cancelled"; message?: string | null; topic: string; code?: string | null }) {
  // the code from the event or the review; the stored error's prefix covers a client that missed both
  if (status === "rejected" && (code === "personal_medical" || !!message?.startsWith("personal_medical: "))) return <PersonalMedical />;
  const copy = COPY[status];
  const retryHref = `/?q=${encodeURIComponent(topic)}#request`;
  const primary = status === "rejected" ? "แก้หัวข้อแล้วส่งใหม่" : "ลองอีกครั้ง";
  return (
    <section className="grid max-w-[65ch] gap-4 pt-12">
      <span className="label break-words">{topic}</span>
      <h1 className="text-[clamp(1.6rem,3vw,2.25rem)] font-bold">{copy.title}</h1>
      <p>{copy.body}</p>
      {message && status === "rejected" && (
        <p className="rounded-sm bg-rail px-4 py-3 text-[0.92rem]">
          <span className="label mr-2">เหตุผล</span>
          {message}
        </p>
      )}
      {message && status !== "rejected" && (
        <details className="rounded-sm bg-rail px-4 py-3 text-[0.92rem]">
          <summary className="cursor-pointer">รายละเอียดทางเทคนิค</summary>
          <p className="mt-2 break-words font-code">{message}</p>
        </details>
      )}
      <div className="flex flex-wrap gap-3">
        <Link href={retryHref} className="w-fit rounded-sm border border-primary bg-primary px-4 py-2 font-display font-semibold text-on-primary no-underline hover:brightness-110">
          {primary}
        </Link>
        <Link href="/" className="w-fit rounded-sm border border-rule px-4 py-2 font-display font-semibold no-underline hover:bg-rail">
          ถามคำถามใหม่
        </Link>
      </div>
    </section>
  );
}
