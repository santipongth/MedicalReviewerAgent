import { headers } from "next/headers";

/** The API address visitors use, for code samples (server only). "/" means same origin: use the address they came in by. */
export async function publicApiUrl(): Promise<string> {
  const configured = (process.env.PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
  if (configured) return configured;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`;
}
