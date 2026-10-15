"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LoadedWorker } from "@/lib/admin-types";
import { isStale } from "@/lib/admin-workers";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import type { WriteTracker } from "./models-save-bar";
import { BUTTON_GHOST } from "./ui";
import { useWorkerFollowUp } from "./use-worker-follow-up";

/** The rules of the versioned documents of the console: the models page (Plan 23b, on this hook since Plan 31), the
 * runtime settings and the glossary (Plan 23c) and the search sources (Plan 23d). A draft keeps the version it was loaded from (`base`), and its save is built
 * on that version, so a save on top of a newer one is the server's 409, never a silent overwrite. A read replaces a
 * draft without edits and keeps one with edits; the page then says the server moved on and offers to discard the edits
 * or to build on the latest version. While a worker lags behind the page's version, the page re-reads every 10 s. */
export interface VersionedState { version: number | null; loaded: LoadedWorker[] }

/** `doc` is what the admin edits; `origin` the document it was loaded from ("dirty" means it differs from that); `base`
 * the version its save is built on. `refused` is the text of this very document as the check of a refused save made it
 * (the models page's YAML tab starts from it). It belongs to the document: every new draft (an edit, a discard, the
 * server's copy) comes without it. */
export interface VersionedDraft<D> { doc: D; origin: D; base: number | null; refused?: string }

/** A page's document kind. Pass a module-level constant: the page's effects depend on it. */
export interface VersionedSpec<S extends VersionedState, D> {
  read: () => Promise<S>;
  /** The draft a read starts from. */
  docOf: (state: S) => D;
  /** Same content (keys that exist only for the page, such as row ids, do not count). */
  same: (a: D, b: D) => boolean;
  /** What a worker reports for this kind, and what it should report for the page's version. */
  workerVersion: (w: LoadedWorker) => string;
  wanted: (state: S) => string;
  /** How the page names a version; null is the default (env values, the built-in glossary). */
  versionName: (version: number | null) => string;
}

/** What a read does to the draft (ModelsView's rule, Plan 23b). `saved` and `savedId` are set only on the re-read that
 * follows the admin's own save: the document saved and the version it became.
 * - The draft is still that document: the server's copy replaces it.
 * - It was edited since, and the server is on the version just saved: the edits stay, on top of it, still unsaved.
 * - It was edited since and the server is on another version (someone saved after us): the ordinary rule applies.
 * Otherwise a draft without edits follows the server (keeping its own object when the content is the same, so row ids
 * and focus survive a background read) and a draft with edits stays as it is. */
export function reconcileDraft<D>(same: (a: D, b: D) => boolean, draft: VersionedDraft<D> | null, doc: D,
  version: number | null, saved?: D, savedId?: number): VersionedDraft<D> {
  const fresh = { doc, origin: doc, base: version };
  if (draft === null) return fresh;
  if (saved !== undefined) {
    if (same(draft.doc, saved)) return fresh;
    if (version === savedId) return { doc: draft.doc, origin: doc, base: version };
  }
  if (!same(draft.doc, draft.origin)) return draft;
  return same(draft.doc, doc) ? { doc: draft.doc, origin: draft.doc, base: version } : fresh;
}

/** What a page adds to the shared rules (the models page, Plan 31). Unlike the spec, these may change every render. */
export interface VersionedOptions<S> {
  /** Why the state read cannot be edited (models: a configuration that no longer passes the checks). Such a read
   * replaces the state but leaves the draft as it was; the hook exposes the reason as `stateError`. */
  error?: (state: S) => string | null | undefined;
  /** Reasons that block saving besides the page's own (models: YAML text not applied yet); the first one is `blocked`. */
  blockers?: (string | null | undefined)[];
  /** Runs after "discard" has replaced the draft (models: the YAML text goes too). */
  onDiscard?: () => void;
}

export function useVersionedPage<S extends VersionedState, D>(spec: VersionedSpec<S, D>, options: VersionedOptions<S> = {}) {
  const { fail } = useAdmin();
  /** The options of the latest render, for the answer of a read already in flight. */
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  const [state, setState] = useState<S | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [draft, setDraft] = useState<VersionedDraft<D> | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the last "discard" or "build on the latest" did, for the base it applies to. Any edit clears it. */
  const [draftNote, setDraftNote] = useState<{ text: string; base: number | null } | null>(null);
  const mounted = useRef(true);
  /** Request numbers only: an answer older than one already applied is dropped. */
  const requests = useRef({ started: 0, applied: 0 });
  /** Writes in flight (`active`) and how many have begun (`began`): no background read starts during a write, and one
   * that began before it is dropped, so a plain read cannot land ahead of the write's own re-read. */
  const writes = useRef({ active: 0, began: 0 });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /** Reads the state. Resolves when the answer is applied or the read has failed; it never rejects. */
  const load = useCallback((saved?: D, savedId?: number, accept?: () => boolean): Promise<void> => {
    const seq = ++requests.current.started;
    return spec.read()
      .then((s) => {
        if (!mounted.current || seq < requests.current.applied || (accept && !accept())) return;
        requests.current.applied = seq;
        setState(s);
        setReadAt(Date.now());
        setError(null);
        if (latest.current.error?.(s)) return; // nothing to edit: the draft stays as it was
        setDraft((d) => reconcileDraft(spec.same, d, spec.docOf(s), s.version, saved, savedId));
      })
      .catch((e: unknown) => {
        if (mounted.current && seq >= requests.current.applied && (!accept || accept())) setError(fail(e));
      });
  }, [spec, fail]);

  useEffect(() => { void load(); }, [load]);

  const poll = useCallback(() => {
    if (writes.current.active > 0) return; // a write is in flight: its own re-read comes first
    const began = writes.current.began;
    void load(undefined, undefined, () => writes.current.active === 0 && writes.current.began === began);
  }, [load]);

  const lagging = state !== null && state.loaded.some((w) =>
    spec.workerVersion(w) !== spec.wanted(state) && !isStale(w.loaded_at, readAt));
  const { settling, wrote } = useWorkerFollowUp(lagging, poll);

  const track = useMemo<WriteTracker>(() => ({
    start: () => { writes.current.active += 1; writes.current.began += 1; },
    wrote,
    end: () => { writes.current.active -= 1; },
  }), [wrote]);

  const reload = useCallback(() => { void load(); }, [load]);
  const edit = useCallback((change: (doc: D) => D) => {
    setDraftNote(null);
    setDraft((d) => (d ? { doc: change(d.doc), origin: d.origin, base: d.base } : d));
  }, []);
  /** Sets or drops the refused text of the draft as it is (dropping keeps the object when there is none). */
  const setRefused = useCallback((text?: string) => {
    setDraft((d) => (!d || d.refused === text ? d : text === undefined ? { doc: d.doc, origin: d.origin, base: d.base }
      : { ...d, refused: text }));
  }, []);

  function discard() {
    if (!state) return;
    const doc = spec.docOf(state);
    setDraft({ doc, origin: doc, base: state.version });
    setDraftNote({ text: `ทิ้งการแก้ไขแล้ว: ร่างตรงกับเวอร์ชัน ${spec.versionName(state.version)}`, base: state.version });
    options.onDiscard?.();
  }
  function rebase() {
    if (!state) return;
    setDraft((d) => (d ? { ...d, base: state.version } : d));
    setDraftNote({ text: `ร่างนี้ใช้เวอร์ชัน ${spec.versionName(state.version)} เป็นฐานแล้ว: บันทึกต่อจากเวอร์ชันนั้นได้`,
      base: state.version });
  }

  const dirty = draft !== null && !spec.same(draft.doc, draft.origin);
  const moved = state !== null && draft !== null && dirty && draft.base !== state.version;
  return { state, readAt, draft, error, settling, track, load, reload, edit, setRefused, discard, rebase, dirty, moved,
    stateError: (state && options.error?.(state)) || null, blocked: options.blockers?.find((b) => b) ?? null,
    draftNote: draftNote && draft && draftNote.base === draft.base ? draftNote.text : null };
}

const DISCARD_HINT = "การแก้ไขที่ยังไม่ได้บันทึกจะหายไป และร่างจะตรงกับเวอร์ชันที่ใช้อยู่";

/** The "server moved on" note and the answer to its buttons (ModelsView's, Plan 23b). `note` appears only after
 * "discard" or "build on the latest", whose buttons are then gone, so focus moves to it. Only a note that appears
 * while this is mounted takes focus: one already shown when it mounts (the admin came back to the tab) does not. */
export function DraftStatus({ moved, base, current, note, onDiscard, onRebase, versionName, hint = DISCARD_HINT }: {
  moved: boolean; base: number | null; current: number | null; note: string | null;
  onDiscard: () => void; onRebase: () => void; versionName: (version: number | null) => string;
  /** What "discard" loses, said while it asks (models: the YAML text too). */
  hint?: string;
}) {
  const noteRef = useRef<HTMLParagraphElement>(null);
  /** The note last seen, starting with the one shown at mount. */
  const seen = useRef(note);
  useEffect(() => {
    if (note && note !== seen.current) noteRef.current?.focus();
    seen.current = note;
  }, [note]);
  return (
    <>
      {moved && (
        <div className="mt-6 grid gap-2 rounded-sm bg-warn-bg px-4 py-3">
          <p>{`ร่างนี้แก้จากเวอร์ชัน ${versionName(base)} แต่ตอนนี้ใช้เวอร์ชัน ${versionName(current)} อยู่`}</p>
          <div className="flex flex-wrap gap-2">
            <ConfirmButton label="ทิ้งการแก้ไข" confirmLabel="ยืนยันทิ้งการแก้ไข" onConfirm={onDiscard}
              hint={hint} />
            <button type="button" className={BUTTON_GHOST} onClick={onRebase}>ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด</button>
          </div>
          <p className="text-sm">ถ้าใช้ร่างนี้ต่อ การบันทึกครั้งต่อไปจะทับการเปลี่ยนแปลงที่เกิดขึ้นในเวอร์ชันล่าสุด</p>
        </div>
      )}
      {note && <p ref={noteRef} tabIndex={-1} role="status" className="mt-6 rounded-sm bg-info-bg px-4 py-2">{note}</p>}
    </>
  );
}
