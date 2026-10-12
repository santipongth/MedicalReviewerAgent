"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { AdminApiError, adminApi, adminErrorText } from "@/lib/admin-api";
import { NOT_BEHIND_SITE } from "@/lib/admin-copy";
import { BUTTON_PRIMARY, INPUT } from "./ui";

export function SignInForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const userId = useId();
  const passId = useId();

  useEffect(() => {
    let alive = true;
    adminApi.me()
      .then(() => { if (alive) router.replace("/admin/dashboard"); })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof AdminApiError && e.status === 404) setError(NOT_BEHIND_SITE);
        else if (new URLSearchParams(window.location.search).get("expired") === "1") setNote("หมดเวลาเข้าสู่ระบบ กรุณาเข้าใหม่");
      });
    return () => { alive = false; };
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.signIn(username, password);
      router.replace("/admin/dashboard");
    } catch (err) {
      setPassword("");
      if (err instanceof AdminApiError && err.status === 401) setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      else if (err instanceof AdminApiError && err.status === 404) setError(NOT_BEHIND_SITE);
      else setError(adminErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="sign-in-title" className="mx-auto max-w-sm py-12">
      <h1 id="sign-in-title" className="font-display text-2xl font-semibold">เข้าสู่ระบบผู้ดูแล</h1>
      {note && <p role="status" className="mt-4 rounded-sm bg-info-bg px-3 py-2">{note}</p>}
      <form onSubmit={submit} className="mt-6 grid gap-4" noValidate>
        <div className="grid gap-1">
          <label htmlFor={userId} className="label">ชื่อผู้ใช้</label>
          <input id={userId} name="username" autoComplete="username" required value={username}
            onChange={(e) => setUsername(e.target.value)} className={INPUT} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={passId} className="label">รหัสผ่าน</label>
          <input id={passId} name="password" type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} className={INPUT} />
        </div>
        {error && <p role="alert" className="rounded-sm bg-err-bg px-3 py-2">{error}</p>}
        <button type="submit" disabled={busy || !username || !password} className={BUTTON_PRIMARY}>
          {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
      </form>
    </section>
  );
}
