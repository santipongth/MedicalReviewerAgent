"use client";
import { animate, m, useMotionValue, useReducedMotion, useTransform, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { MAX_DOTS, PACKET_CAP, planDots, takeFreshPulses, type PulseKind, type Scene } from "@/lib/agent-scene";
import { segX, segY, type Seg, type StageLayout } from "@/lib/agent-layout";

const KIND_CLS: Record<PulseKind, string> = {
  query: "fill-ink", paper: "fill-ink", kept: "fill-primary", card: "fill-primary", failed: "fill-err", signal: "fill-muted",
};
const ZERO: Seg = { a: { x: 0, y: 0 }, c: { x: 0, y: 0 }, b: { x: 0, y: 0 } };

export interface DotHandle { launch(seg: Seg, kind: PulseKind, delayMs: number): void }

function PacketDot({ handle }: { handle: Ref<DotHandle> }) {
  const t = useMotionValue(0);
  const segRef = useRef<Seg>(ZERO);
  const el = useRef<SVGCircleElement>(null);
  const ctl = useRef<AnimationPlaybackControls | null>(null);
  const cx = useTransform(t, (v) => segX(segRef.current, v));
  const cy = useTransform(t, (v) => segY(segRef.current, v));
  const opacity = useTransform(t, [0, 0.1, 0.9, 1], [0, 1, 1, 0]);
  // Two trailing ghosts a few percent behind the packet (Plan 17b): a short flat wake, no glow.
  const lag = (d: number) => (v: number) => Math.max(0, v - d);
  const t1 = useTransform(t, lag(0.05));
  const t2 = useTransform(t, lag(0.1));
  const x1 = useTransform(t1, (v) => segX(segRef.current, v));
  const y1 = useTransform(t1, (v) => segY(segRef.current, v));
  const x2 = useTransform(t2, (v) => segX(segRef.current, v));
  const y2 = useTransform(t2, (v) => segY(segRef.current, v));
  const o1 = useTransform(t, [0, 0.15, 0.85, 1], [0, 0.45, 0.45, 0]);
  const o2 = useTransform(t, [0, 0.2, 0.8, 1], [0, 0.22, 0.22, 0]);
  const tail1 = useRef<SVGCircleElement>(null);
  const tail2 = useRef<SVGCircleElement>(null);
  useEffect(() => () => ctl.current?.stop(), []);
  useImperativeHandle(handle, () => ({
    launch(seg, kind, delayMs) {
      ctl.current?.stop();
      segRef.current = seg;
      const node = el.current;
      if (node) {
        node.setAttribute("data-packet", kind); // DOM attribute only: no React state per packet
        node.setAttribute("class", KIND_CLS[kind]);
      }
      tail1.current?.setAttribute("class", KIND_CLS[kind]);
      tail2.current?.setAttribute("class", KIND_CLS[kind]);
      t.set(0);
      const c = animate(t, [0, 1], { duration: 0.7, delay: delayMs / 1000, ease: "easeInOut" });
      ctl.current = c;
      c.then(() => {
        if (ctl.current === c) el.current?.removeAttribute("data-packet");
      });
    },
  }), [t]);
  return (
    <>
      <m.circle ref={tail2} r={2} className="fill-ink" style={{ cx: x2, cy: y2, opacity: o2 }} />
      <m.circle ref={tail1} r={2.75} className="fill-ink" style={{ cx: x1, cy: y1, opacity: o1 }} />
      <m.circle ref={el} r={3.5} className="fill-ink" style={{ cx, cy, opacity }} data-head />
    </>
  );
}

/** Fixed pool of dots; each fresh pulse (never replayed ones) animates along its edge's cached segment. */
export function PacketLayer({ scene, layout }: { scene: Scene; layout: StageLayout }) {
  const reduced = useReducedMotion();
  const seen = useRef(scene.lastSeq);
  const next = useRef(0);
  const dots = useRef<(DotHandle | null)[]>([]);
  const [setters] = useState(() =>
    Array.from({ length: MAX_DOTS }, (_, i) => (h: DotHandle | null) => { dots.current[i] = h; }));
  const latest = useRef({ scene, layout });
  useEffect(() => { latest.current = { scene, layout }; });
  const seq = scene.lastSeq;
  useEffect(() => {
    const { scene: sc, layout: lay } = latest.current;
    const fresh = takeFreshPulses(sc.pulses, seen.current, PACKET_CAP);
    seen.current = seq;
    if (reduced || fresh.length === 0 || (typeof document !== "undefined" && document.hidden)) return;
    for (const d of planDots(fresh, MAX_DOTS)) {
      const edge = lay.edges.find((e) => e.id === d.edge);
      const h = dots.current[next.current];
      next.current = (next.current + 1) % MAX_DOTS;
      if (edge && h) h.launch(edge.seg, d.kind, d.delayMs);
    }
  }, [seq, reduced]);
  if (reduced) return null;
  return (
    <g aria-hidden="true" pointerEvents="none">
      {Array.from({ length: MAX_DOTS }, (_, i) => (
        <PacketDot key={i} handle={setters[i]} />
      ))}
    </g>
  );
}
