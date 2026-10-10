import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { teamLayout3D } from "@/lib/agent-layout-3d";
import type { MemberStatus, Phase } from "@/lib/agent-team";

// jsdom has no WebGL: the R3F intrinsics (<mesh>, <meshBasicMaterial>...) render as plain unknown elements, which is
// enough to read which token colour each part was given. Edges becomes a marker carrying its colour.
vi.mock("@react-three/fiber", () => ({ useFrame: () => {} }));
vi.mock("@react-three/drei", () => ({
  Edges: ({ color }: { color: string }) => <i data-edges={color} />,
}));

import { Robot3D } from "./robot-3d";
import type { Tokens3D } from "./tokens-3d";

// every token a distinct, recognisable value, so a wrong mapping cannot pass by coincidence
const T = Object.fromEntries(
  ["primary", "ink", "rule", "muted", "ok", "err", "warn", "surface", "rail", "sup", "harm", "none", "mixed", "unclear"].map((k) => [k, `#tok-${k}`]),
) as Tokens3D;

const m = teamLayout3D().members.reader;

function mount(status: MemberStatus, speaking = false, phase: Phase | null = null, passed: Phase[] = []) {
  vi.spyOn(console, "error").mockImplementation(() => {}); // React warns about the unknown lower-case elements
  const { container } = render(<Robot3D m={m} status={status} speaking={speaking} phase={phase} passed={passed} tokens={T} />);
  const meshes = [...container.querySelectorAll("mesh")];
  const color = (el: Element) => el.querySelector("meshbasicmaterial")?.getAttribute("color");
  const edge = (el: Element) => el.querySelector("[data-edges]")?.getAttribute("data-edges");
  // order in Robot3D: body, head, two eyes, antenna, ball, (ping), then the four tiles
  return { container, body: meshes[0], head: meshes[1], eyes: meshes.slice(2, 4), tiles: meshes.slice(-4), color, edge };
}

describe("Robot3D status -> material", () => {
  it("draws every part unlit (basic, not tone-mapped) so tokens show exactly", () => {
    const r = mount("idle");
    expect(r.container.querySelectorAll("meshstandardmaterial")).toHaveLength(0);
    expect(r.container.querySelector("meshbasicmaterial")).not.toBeNull();
  });

  it("idle and done robots get different fills and different outlines", () => {
    const idle = mount("idle");
    expect(idle.color(idle.body)).toBe(T.rule);
    expect(idle.edge(idle.body)).toBe(T.muted);
    const done = mount("done");
    expect(done.color(done.body)).toBe(T.surface);
    expect(done.edge(done.body)).toBe(T.ink);
    expect(done.color(done.head)).not.toBe(idle.color(idle.head));
  });

  it("working / speaking is solid primary; failed err; paused warn; stopped muted", () => {
    const work = mount("working");
    expect([work.color(work.body), work.edge(work.head), work.color(work.eyes[0])]).toEqual([T.primary, T.primary, T.surface]);
    const speak = mount("idle", true);
    expect(speak.color(speak.body)).toBe(T.primary);
    const failed = mount("failed", true); // a failed member is never painted as the speaker
    expect([failed.color(failed.body), failed.edge(failed.body), failed.color(failed.eyes[0])]).toEqual([T.surface, T.err, T.err]);
    const paused = mount("paused");
    expect(paused.edge(paused.body)).toBe(T.warn);
    const stopped = mount("stopped");
    expect([stopped.color(stopped.body), stopped.edge(stopped.body)]).toEqual([T.surface, T.muted]);
  });

  it("only rest tiles get a muted outline; active is primary, passed ink, rest rule", () => {
    const r = mount("working", true, "analyse", ["think"]);
    expect(r.tiles).toHaveLength(4);
    expect(r.tiles.map((t) => r.color(t))).toEqual([T.ink, T.primary, T.rule, T.rule]); // think, analyse, plan, act
    expect(r.tiles.map((t) => r.edge(t) ?? null)).toEqual([null, null, T.muted, T.muted]);
  });
});
