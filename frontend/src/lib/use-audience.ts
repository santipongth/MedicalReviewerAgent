// Plan 26: the audience preference in the browser. Reads the `?view=` parameter, then localStorage; every access is
// guarded (private windows, blocked storage, the offline file) and falls back to the default.
import { useSyncExternalStore } from "react";
import { AUDIENCE_KEY, AUDIENCE_PARAM, DEFAULT_AUDIENCE, parseAudience, type Audience } from "./audience";

export function readAudience(): Audience {
  if (typeof window === "undefined") return DEFAULT_AUDIENCE;
  let param: string | null = null;
  let stored: string | null = null;
  try {
    param = new URL(window.location.href).searchParams.get(AUDIENCE_PARAM);
  } catch {
    param = null;
  }
  try {
    stored = window.localStorage.getItem(AUDIENCE_KEY);
  } catch {
    stored = null;
  }
  return parseAudience(param, stored);
}

const noSubscription = () => () => undefined;

/** The stored (or linked) audience in a component: the default on the server, the browser's value after hydration. */
export function useStoredAudience(): Audience {
  return useSyncExternalStore(noSubscription, readAudience, () => DEFAULT_AUDIENCE);
}

/** Remember the choice for the next report (the request form's default). */
export function storeAudience(audience: Audience): void {
  try {
    window.localStorage.setItem(AUDIENCE_KEY, audience);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

/** Remember the choice and put it in the address, so a shared link opens in the same view. */
export function saveAudience(audience: Audience): void {
  storeAudience(audience);
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(AUDIENCE_PARAM, audience);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // the offline file (file://) or a sandboxed frame: the view still changes on screen
  }
}
