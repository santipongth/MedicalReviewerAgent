/**
 * The open/close marker for a `<details className="group">` whose `<summary>` is a flex row (flex drops the native
 * triangle). It turns a quarter when open; under reduced motion it never rotates, the glyph switches instead (▸ / ▾).
 * Decoration only: the summary's own text and the native expanded state carry the meaning.
 */
export function DisclosureChevron() {
  return (
    <span data-chevron aria-hidden="true" className="inline-flex w-4 flex-none justify-center text-muted">
      <span className="inline-block transition-transform duration-200 ease-in-out group-open:rotate-90 motion-reduce:hidden">▸</span>
      <span className="hidden motion-reduce:inline-block group-open:motion-reduce:hidden">▸</span>
      <span className="hidden group-open:motion-reduce:inline-block">▾</span>
    </span>
  );
}
