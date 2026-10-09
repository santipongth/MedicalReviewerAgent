// Server-only: read env that must not reach the browser. Import from server code only (routes, generateMetadata).

/** Server-side address of the API: INTERNAL_API_URL (e.g. http://api:8000 in compose), else an absolute public URL. */
export function serverApiUrl(): string {
  const configured = process.env.INTERNAL_API_URL ?? process.env.PUBLIC_API_URL ?? "";
  return (/^https?:\/\//.test(configured) ? configured : "http://localhost:8000").replace(/\/$/, "");
}
