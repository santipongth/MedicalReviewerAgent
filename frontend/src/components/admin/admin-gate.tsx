"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AdminApiError, adminApi, adminErrorText } from "@/lib/admin-api";
import { NOT_BEHIND_SITE } from "@/lib/admin-copy";
import type { AdminMe } from "@/lib/admin-types";
import { AdminNav } from "./admin-nav";

interface AdminContextValue {
  me: AdminMe;
  /** Thai text for a failed call; a 401 (session expired) sends the admin back to sign-in. */
  fail: (e: unknown) => string;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdmin is only available inside <AdminGate>");
  return value;
}

type GateState = { kind: "checking" } | { kind: "in"; me: AdminMe } | { kind: "blocked"; message: string };

/** Every console page sits behind this: it checks GET /me once, then renders the admin nav and the page. */
export function AdminGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GateState>({ kind: "checking" });

  useEffect(() => {
    let alive = true;
    adminApi.me()
      .then((me) => { if (alive) setState({ kind: "in", me }); })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof AdminApiError && e.status === 401) router.replace("/admin");
        else setState({ kind: "blocked", message: e instanceof AdminApiError && e.status === 404 ? NOT_BEHIND_SITE : adminErrorText(e) });
      });
    return () => { alive = false; };
  }, [router]);

  const fail = useCallback((e: unknown) => {
    if (e instanceof AdminApiError && e.status === 401) {
      router.replace("/admin?expired=1");
      return "หมดเวลาเข้าสู่ระบบ กรุณาเข้าใหม่";
    }
    return adminErrorText(e);
  }, [router]);

  const value = useMemo(() => (state.kind === "in" ? { me: state.me, fail } : null), [state, fail]);

  if (state.kind === "checking") return <p role="status" className="py-12 text-muted">กำลังตรวจสิทธิ์…</p>;
  if (state.kind === "blocked") return <p role="alert" className="my-12 rounded-sm bg-err-bg px-4 py-3">{state.message}</p>;
  return (
    <AdminContext.Provider value={value}>
      <AdminNav me={state.me} />
      {children}
    </AdminContext.Provider>
  );
}
