import type { Review } from "@/lib/types";

/** Placeholder replaced by the report bench in Task 6. */
export function Report({ review }: { review: Review }) {
  return (
    <section className="grid gap-4 pt-10">
      <h1 className="text-3xl font-bold">{review.topic}</h1>
      <p>{review.result?.summary}</p>
    </section>
  );
}
