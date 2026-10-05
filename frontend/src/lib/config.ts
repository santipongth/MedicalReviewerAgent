// The public API address is provided at runtime by the root layout (window.__MRA_CONFIG__), so one Docker image can
// serve any deployment; NEXT_PUBLIC_API_URL is only a build-time fallback for local development.

declare global {
  interface Window {
    __MRA_CONFIG__?: { apiUrl?: string };
  }
}

export const DEFAULT_API_URL = "http://localhost:8000";

export function apiUrl(): string {
  const configured = typeof window !== "undefined" ? window.__MRA_CONFIG__?.apiUrl : undefined;
  if (configured !== undefined) { // "" or "/" = same origin
    const url = configured.replace(/\/$/, "");
    return url === "" ? window.location.origin : url; // "/" = same origin, behind the single-origin proxy (Caddy)
  }
  return (process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");
}
