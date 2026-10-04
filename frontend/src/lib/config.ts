// The public API address is provided at runtime by the root layout (window.__MRA_CONFIG__), so one Docker image can
// serve any deployment; NEXT_PUBLIC_API_URL is only a build-time fallback for local development.

declare global {
  interface Window {
    __MRA_CONFIG__?: { apiUrl?: string };
  }
}

export const DEFAULT_API_URL = "http://localhost:8000";

export function apiUrl(): string {
  if (typeof window !== "undefined" && window.__MRA_CONFIG__?.apiUrl) {
    return window.__MRA_CONFIG__.apiUrl.replace(/\/$/, "");
  }
  return (process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");
}
