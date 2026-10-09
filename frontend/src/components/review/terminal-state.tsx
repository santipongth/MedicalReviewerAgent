import Link from "next/link";

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

export function TerminalState({
  status, message, topic,
}: { status: "rejected" | "error" | "cancelled"; message?: string | null; topic: string }) {
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
      {message && status === "error" && (
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
