"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { adminApi, type ReviewQuery } from "@/lib/admin-api";
import { STATUS_LABEL, STATUS_ORDER, formatUsd, formatWhen } from "@/lib/admin-copy";
import type { AdminReview, AdminStatus } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";

const ACTIVE: AdminStatus[] = ["queued", "running"];

export function ReviewsView() {
  const { fail } = useAdmin();
  const [query, setQuery] = useState<ReviewQuery>({});
  const [draft, setDraft] = useState<ReviewQuery>({ q: "", status: "", listed: "" });
  const [items, setItems] = useState<AdminReview[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped by every new search: a load-more that finishes after that belongs to a superseded query and is dropped.
  const generation = useRef(0);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // Set when the control that was focused is gone (a delete removes its row, a cancel swaps its button): focus then
  // moves to the notice once it has rendered.
  const focusNotice = useRef(false);
  const qId = useId();
  const statusId = useId();
  const listedId = useId();

  useEffect(() => {
    let alive = true;
    adminApi.reviews(query)
      .then((page) => { if (alive) { setItems(page.items); setNext((page.next as string | null) ?? null); setLoading(false); } })
      .catch((e: unknown) => { if (alive) { setError(fail(e)); setLoading(false); } });
    return () => { alive = false; };
  }, [query, fail]);

  useEffect(() => {
    if (notice && focusNotice.current) {
      focusNotice.current = false;
      noticeRef.current?.focus();
    }
  }, [notice]);

  function search(e: FormEvent) {
    e.preventDefault();
    generation.current += 1;
    // the old rows and cursor belong to the old query: drop them so a failed search cannot leave them under new filters
    setItems([]);
    setNext(null);
    setLoading(true);
    setError(null);
    setNotice(null);
    setQuery({ ...draft });
  }

  async function more() {
    if (!next) return;
    const mine = generation.current;
    setLoading(true);
    try {
      const page = await adminApi.reviews({ ...query, before: next });
      if (mine !== generation.current) return;
      setItems((prev) => [...prev, ...page.items]);
      setNext((page.next as string | null) ?? null);
    } catch (e) {
      if (mine === generation.current) setError(fail(e));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }

  async function act(id: string, run: () => Promise<AdminReview | null>, done: string, moveFocus = false) {
    setError(null);
    setNotice(null);
    try {
      const updated = await run();
      focusNotice.current = moveFocus;
      setItems((prev) => prev.flatMap((r) => (r.id === id ? (updated ? [updated] : []) : [r])));
      setNotice(done);
    } catch (e) {
      setError(fail(e));
    }
  }

  return (
    <section aria-labelledby="reviews-title" className="py-6">
      <h1 id="reviews-title" className="font-display text-2xl font-semibold">รีวิว</h1>
      <form onSubmit={search} className="mt-4 grid items-end gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
        <div className="grid gap-1">
          <label htmlFor={qId} className="label">ค้นหาหัวข้อ</label>
          <input id={qId} type="search" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} className={INPUT} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={statusId} className="label">สถานะ</label>
          <select id={statusId} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as AdminStatus | "" })} className={INPUT}>
            <option value="">ทุกสถานะ</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor={listedId} className="label">รายการสาธารณะ</label>
          <select id={listedId} value={draft.listed} onChange={(e) => setDraft({ ...draft, listed: e.target.value as ReviewQuery["listed"] })} className={INPUT}>
            <option value="">ทั้งหมด</option>
            <option value="true">แสดงอยู่</option>
            <option value="false">ซ่อนอยู่</option>
          </select>
        </div>
        <button type="submit" className={BUTTON_PRIMARY}>ค้นหา</button>
      </form>

      {notice && <p ref={noticeRef} tabIndex={-1} role="status" className="mt-4 rounded-sm bg-info-bg px-4 py-2">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{error}</p>}

      <div className={TABLE_REGION} role="region" aria-label="รายการรีวิว" tabIndex={0}>
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <caption className="sr-only">รีวิวทั้งหมด ใหม่สุดก่อน</caption>
          <thead><tr>
            <th scope="col" className={TH}>หัวข้อ</th><th scope="col" className={TH}>สถานะ</th>
            <th scope="col" className={TH}>สร้างเมื่อ</th><th scope="col" className={TH}>ค่าใช้จ่าย</th>
            <th scope="col" className={TH}>รายการสาธารณะ</th><th scope="col" className={TH}>จัดการ</th>
          </tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <th scope="row" className={`${TD} font-normal`}>
                  <Link href={`/r/${r.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">{r.topic}</Link>
                  <span className="mt-1 block text-xs text-muted">
                    {r.review_type}{r.api_key_prefix ? ` · key ${r.api_key_prefix}` : ""}{r.prompt_version ? ` · ${r.prompt_version}` : ""}
                  </span>
                  {r.error && <span className="mt-1 block text-xs text-err">{r.error}</span>}
                </th>
                <td className={TD}>{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className={`${TD} whitespace-nowrap`}>{formatWhen(r.created_at)}</td>
                <td className={`${TD} tabular-nums`}>{formatUsd(r.cost_usd)}</td>
                <td className={TD}>
                  <button type="button" className={BUTTON_GHOST} onClick={() => act(r.id, async () => {
                    const res = await adminApi.setListed(r.id, !r.is_listed);
                    return { ...r, is_listed: res.is_listed };
                  }, r.is_listed ? "ซ่อนรีวิวจากรายการสาธารณะแล้ว" : "แสดงรีวิวในรายการสาธารณะแล้ว")}>
                    {r.is_listed ? "ซ่อน" : "แสดง"}
                  </button>
                </td>
                <td className={TD}>
                  {ACTIVE.includes(r.status) ? (
                    <button type="button" className={BUTTON_GHOST} onClick={() => act(r.id, async () => {
                      await adminApi.cancelReview(r.id);
                      return { ...r, status: "cancelled" };
                    }, "ยกเลิกรีวิวแล้ว", true)}>ยกเลิก</button>
                  ) : (
                    <ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={() => act(r.id, async () => {
                      await adminApi.deleteReview(r.id);
                      return null;
                    }, "ลบรีวิวแล้ว", true)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && items.length === 0 && !error && <p className="mt-4 text-muted">ไม่พบรีวิว</p>}
      {loading && <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      {next && !loading && <button type="button" onClick={more} className={`mt-4 ${BUTTON_GHOST}`}>โหลดเพิ่ม</button>}
    </section>
  );
}
