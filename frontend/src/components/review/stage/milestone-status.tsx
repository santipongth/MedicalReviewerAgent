"use client";
import { useEffect, useRef, useState } from "react";
import { AGENT_LABEL, currentAgent, type Scene } from "@/lib/agent-scene";

export const ANNOUNCE_GAP_MS = 5000;

/** Visually hidden, throttled announcer. The timer only changes the announced text, never scene state. */
export function MilestoneStatus({ scene }: { scene: Scene }) {
  const agent = currentAgent(scene);
  const role = agent ? AGENT_LABEL[agent].role : null;
  const [text, setText] = useState("");
  const lastAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string | null>(null);

  useEffect(() => {
    latest.current = role;
    if (!role) return;
    const now = Date.now();
    const wait = lastAt.current === null ? 0 : lastAt.current + ANNOUNCE_GAP_MS - now;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (wait <= 0) {
      lastAt.current = now;
      setText(role);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      lastAt.current = Date.now();
      if (latest.current) setText(latest.current);
    }, wait);
  }, [role]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return <p role="status" className="sr-only">{text}</p>;
}
