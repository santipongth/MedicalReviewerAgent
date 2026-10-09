/**
 * Surname of an author string. Sources differ: Europe PMC gives "Surname Initials"
 * ("Kim JH", "van der Berg AB"), others "Surname, Given" or "Given Surname".
 */
export function surnameOf(name: string | undefined | null): string {
  const full = (name ?? "").trim();
  if (!full) return "";
  if (full.includes(",")) return full.split(",")[0].trim();
  const tokens = full.split(/\s+/);
  if (tokens.length === 1) return tokens[0];
  const last = tokens[tokens.length - 1];
  if (/^(?:[A-Z]\.?){1,3}$/.test(last)) return tokens.slice(0, -1).join(" ");
  return last;
}
