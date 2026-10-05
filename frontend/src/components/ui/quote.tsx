import type { Reported } from "@/lib/evidence";

/** The verbatim quote with the verified number marked at its exact position (never inside another number). */
export function HighlightedQuote({ quote, number }: { quote: string; number: Reported | null }) {
  if (!number) return <>&ldquo;{quote}&rdquo;</>;
  const { index, text } = number;
  return (
    <>
      &ldquo;{quote.slice(0, index)}
      <mark className="bg-highlight px-0.5 text-[var(--highlight-ink)]">{text}</mark>
      {quote.slice(index + text.length)}&rdquo;
    </>
  );
}
