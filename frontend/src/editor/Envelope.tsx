import { useRef } from "react";
import type { Timeline, VolumePoint } from "@/lib/types";
import { useEditor } from "./store";

// Gain range shown in the lane (dB). Envelope points are offsets added to the clip gain.
const G_MIN = -30;
const G_MAX = 12;

export const gainToY = (g: number, h: number) => h * (1 - (Math.max(G_MIN, Math.min(G_MAX, g)) - G_MIN) / (G_MAX - G_MIN));
export const yToGain = (y: number, h: number) => Math.round((G_MIN + (1 - y / h) * (G_MAX - G_MIN)) * 2) / 2;

function envOf(tl: Timeline, owner: "clip" | "audio", id: string): VolumePoint[] | undefined {
  return owner === "clip" ? tl.clips.find((c) => c.id === id)?.envelope : tl.audio_clips.find((a) => a.id === id)?.envelope;
}

/** Editable volume envelope: double-click adds a point, drag moves it, select + Delete removes it. */
export function Envelope({ owner, id, points, duration, width, height, color }: {
  owner: "clip" | "audio"; id: string; points: VolumePoint[]; duration: number; width: number; height: number; color: string;
}) {
  const sel = useEditor((s) => s.selection);
  const svgRef = useRef<SVGSVGElement>(null);
  const x = (t: number) => (t / Math.max(1e-3, duration)) * width;
  const sorted = [...points].map((p, i) => ({ ...p, i })).sort((a, b) => a.t - b.t);
  const d = sorted.length
    ? `M0,${gainToY(sorted[0].gain_db, height)} ` + sorted.map((p) => `L${x(p.t)},${gainToY(p.gain_db, height)}`).join(" ") + ` L${width},${gainToY(sorted[sorted.length - 1].gain_db, height)}`
    : "";

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { t: Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration)), g: yToGain(e.clientY - r.top, r.height) };
  };

  const startDrag = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    e.preventDefault();
    const st = useEditor.getState();
    st.select({ kind: "envpoint", owner, id, index });
    st.beginGesture();
    const move = (ev: PointerEvent) => {
      const { t, g } = local(ev);
      useEditor.getState().commit((tl) => {
        const env = envOf(tl, owner, id);
        if (env?.[index]) env[index] = { t: Math.round(t * 1000) / 1000, gain_db: g };
      }, { history: false });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      useEditor.getState().commit((tl) => envOf(tl, owner, id)?.sort((a, b) => a.t - b.t), { history: true });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const add = (e: React.MouseEvent) => {
    e.stopPropagation();
    const { t, g } = local(e);
    let index = 0;
    useEditor.getState().commit((tl) => {
      const env = envOf(tl, owner, id);
      if (!env) return;
      env.push({ t: Math.round(t * 1000) / 1000, gain_db: g });
      env.sort((a, b) => a.t - b.t);
      index = env.findIndex((p) => p.t === Math.round(t * 1000) / 1000);
    });
    useEditor.getState().select({ kind: "envpoint", owner, id, index });
  };

  return (
    <svg ref={svgRef} width={width} height={height} className="absolute inset-0 overflow-visible" onDoubleClick={add} data-testid={`envelope-${owner}`}>
      <title>Double-click to add a volume point; drag points to shape the gain</title>
      {d ? <path d={d} fill="none" stroke={color} strokeWidth={1.5} /> : <line x1={0} x2={width} y1={gainToY(0, height)} y2={gainToY(0, height)} stroke={color} strokeOpacity={0.45} strokeDasharray="3 3" />}
      {sorted.map((p) => {
        const active = sel?.kind === "envpoint" && sel.owner === owner && sel.id === id && sel.index === p.i;
        return (
          <circle key={p.i} cx={x(p.t)} cy={gainToY(p.gain_db, height)} r={active ? 4.5 : 3.5} fill={active ? "#E8AD52" : color} stroke="#0B0E14" strokeWidth={1}
            className="cursor-move" onPointerDown={(e) => startDrag(e, p.i)} data-testid="envelope-point" />
        );
      })}
    </svg>
  );
}
