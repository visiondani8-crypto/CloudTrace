import { useState } from "react";
import { Crosshair, RotateCcw, Trash2 } from "lucide-react";
import type { Animation, Effect, GraphicLayer, TextLayer, Timeline, TransitionType } from "@/lib/types";
import { tc } from "@/lib/format";
import { Alert, Badge, Button, ColorInput, Field, Input, NativeSelect, Segmented, Slider, Switch, Textarea } from "@/components/ui";
import { segments, interpKeyframes } from "./geometry";
import { useEditor } from "./store";

const FONTS = ["Inter", "Montserrat", "Poppins", "Anton", "BebasNeue", "SpaceGrotesk", "PlayfairDisplay", "Bangers", "Oswald", "DMSerifDisplay"];
const ANIMS: Animation["type"][] = ["none", "fade", "pop", "slide_up", "slide_down", "bounce", "scale", "typewriter"];
const TRANSITIONS: TransitionType[] = ["cut", "crossfade", "fade_black", "fade_white", "slide", "zoom", "blur"];
const EFFECT_LABEL: Record<string, string> = {
  zoom: "Zoom / punch-in", pan: "Pan", blur: "Blur", vignette: "Vignette", exposure: "Exposure", contrast: "Contrast", saturation: "Saturation",
  sharpen: "Sharpen (export only)", fade_in: "Fade in", fade_out: "Fade out", freeze: "Freeze frame", mask: "Mask", grade: "Colour grade",
};

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-2xs font-semibold uppercase tracking-wider text-muted">{title}</h4>
        {action}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Num({ label, value, onChange, step = 0.01, min, max, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <Field label={label} right={suffix && <span className="text-muted">{suffix}</span>}>
      <Input type="number" step={step} min={min} max={max} value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

function AnimEditor({ label, value, onChange }: { label: string; value: Animation; onChange: (a: Animation) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={label}><NativeSelect value={value.type} onChange={(v) => onChange({ ...value, type: v as Animation["type"] })} options={ANIMS.map((a) => ({ value: a, label: a === "typewriter" ? "typewriter (word reveal)" : a.replace("_", " ") }))} /></Field>
      <Num label="Duration" value={value.duration} step={0.05} min={0} max={3} onChange={(d) => onChange({ ...value, duration: d })} suffix="s" />
    </div>
  );
}

function TextStyleEditor({ style, onChange }: { style: TextLayer["style"]; onChange: (p: Partial<TextLayer["style"]>) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Font"><NativeSelect value={style.font} onChange={(v) => onChange({ font: v })} options={FONTS.map((f) => ({ value: f, label: f.replace(/([a-z])([A-Z])/g, "$1 $2") }))} /></Field>
        <Field label="Weight"><NativeSelect value={style.weight} onChange={(v) => onChange({ weight: Number(v) })} options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))} /></Field>
      </div>
      <Slider label="Size" value={style.size} min={0.015} max={0.12} step={0.001} onChange={(v) => onChange({ size: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
      <ColorInput label="Text colour" value={style.color} onChange={(v) => onChange({ color: v })} />
      <Slider label="Outline" value={style.outline} min={0} max={0.015} step={0.0005} onChange={(v) => onChange({ outline: v })} format={(v) => (v * 1000).toFixed(1)} />
      {style.outline > 0 && <ColorInput label="Outline colour" value={style.outline_color} onChange={(v) => onChange({ outline_color: v })} />}
      <Slider label="Shadow" value={style.shadow} min={0} max={0.012} step={0.0005} onChange={(v) => onChange({ shadow: v })} format={(v) => (v * 1000).toFixed(1)} />
      <Field label="Background"><Segmented size="sm" value={style.background} onChange={(v) => onChange({ background: v, background_opacity: v === "none" ? 0 : Math.max(style.background_opacity, 0.8) })} options={[{ value: "none", label: "None" }, { value: "box", label: "Box" }, { value: "rounded", label: "Rounded" }]} /></Field>
      {style.background !== "none" && (
        <>
          <ColorInput label="Background colour" value={style.background_color} onChange={(v) => onChange({ background_color: v })} />
          <Slider label="Bg opacity" value={style.background_opacity} min={0} max={1} onChange={(v) => onChange({ background_opacity: v })} />
        </>
      )}
      <Slider label="Letter spacing" value={style.letter_spacing} min={-0.05} max={0.3} step={0.005} onChange={(v) => onChange({ letter_spacing: v })} />
      <Slider label="Line height" value={style.line_height} min={0.8} max={2} onChange={(v) => onChange({ line_height: v })} />
      <Field label="Align"><Segmented size="sm" value={style.align} onChange={(v) => onChange({ align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }]} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Switch checked={style.uppercase} onChange={(v) => onChange({ uppercase: v })} label="Uppercase" />
        <Switch checked={style.italic} onChange={(v) => onChange({ italic: v })} label="Italic" />
      </div>
    </>
  );
}

function EffectRow({ e, clipDur, onChange, onDelete }: { e: Effect; clipDur: number; onChange: (p: Partial<Effect>) => void; onDelete: () => void }) {
  const P = e.params;
  const setP = (k: string, v: number | string) => onChange({ params: { ...P, [k]: v } });
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium">{EFFECT_LABEL[e.type] ?? e.type}</span>
        <div className="flex items-center gap-1">
          <Switch checked={e.enabled} onChange={(v) => onChange({ enabled: v })} />
          <button onClick={onDelete} className="rounded p-1 text-muted hover:text-err" aria-label="Remove effect"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Num label="Start" value={e.start} min={0} max={clipDur} step={0.05} onChange={(v) => onChange({ start: v })} suffix="s" />
        <Num label="End" value={e.end ?? clipDur} min={0} max={clipDur} step={0.05} onChange={(v) => onChange({ end: v >= clipDur - 1e-3 ? null : v })} suffix="s" />
      </div>
      {e.type === "zoom" && (
        <>
          <Slider label="From" value={Number(P.from ?? 1)} min={0.5} max={2.5} onChange={(v) => setP("from", v)} />
          <Slider label="To" value={Number(P.to ?? 1)} min={0.5} max={2.5} onChange={(v) => setP("to", v)} />
        </>
      )}
      {e.type === "pan" && (
        <>
          <Slider label="Pan X" value={Number(P.dx ?? 0)} min={-0.5} max={0.5} onChange={(v) => setP("dx", v)} />
          <Slider label="Pan Y" value={Number(P.dy ?? 0)} min={-0.5} max={0.5} onChange={(v) => setP("dy", v)} />
        </>
      )}
      {e.type === "blur" && <Slider label="Radius" value={Number(P.radius ?? 0.01)} min={0} max={0.05} step={0.001} onChange={(v) => setP("radius", v)} />}
      {e.type === "vignette" && <Slider label="Amount" value={Number(P.amount ?? 0.4)} min={0} max={1} onChange={(v) => setP("amount", v)} />}
      {e.type === "sharpen" && <Slider label="Amount" value={Number(P.amount ?? 0.5)} min={0} max={1} onChange={(v) => setP("amount", v)} />}
      {e.type === "exposure" && <Slider label="Exposure" value={Number(P.value ?? 0)} min={-1} max={1} onChange={(v) => setP("value", v)} />}
      {e.type === "contrast" && <Slider label="Contrast" value={Number(P.value ?? 1)} min={0.5} max={2} onChange={(v) => setP("value", v)} />}
      {e.type === "saturation" && <Slider label="Saturation" value={Number(P.value ?? 1)} min={0} max={2.5} onChange={(v) => setP("value", v)} />}
      {e.type === "grade" && (
        <>
          <Slider label="Exposure" value={Number(P.exposure ?? 0)} min={-1} max={1} onChange={(v) => setP("exposure", v)} />
          <Slider label="Contrast" value={Number(P.contrast ?? 1)} min={0.5} max={2} onChange={(v) => setP("contrast", v)} />
          <Slider label="Saturation" value={Number(P.saturation ?? 1)} min={0} max={2.5} onChange={(v) => setP("saturation", v)} />
          <Slider label="Temperature" value={Number(P.temperature ?? 0)} min={-1} max={1} onChange={(v) => setP("temperature", v)} />
        </>
      )}
      {(e.type === "fade_in" || e.type === "fade_out" || e.type === "mask") && <ColorInput label="Colour" value={String(P.color ?? "#000000")} onChange={(v) => setP("color", v)} />}
      {e.type === "mask" && (
        <>
          <Field label="Shape"><Segmented size="sm" value={String(P.shape ?? "rounded")} onChange={(v) => setP("shape", v)} options={[{ value: "rounded", label: "Rounded" }, { value: "circle", label: "Circle" }]} /></Field>
          <Slider label="Size" value={Number(P.size ?? 0.85)} min={0.2} max={1} onChange={(v) => setP("size", v)} />
          <Slider label="Feather" value={Number(P.feather ?? 0.03)} min={0} max={0.2} onChange={(v) => setP("feather", v)} />
        </>
      )}
      {e.type === "freeze" && <p className="text-2xs text-muted">Holds the frame at the effect start; dialogue keeps playing.</p>}
    </div>
  );
}

export function Inspector({ onReframe }: { onReframe: (mode: string) => void }) {
  const tl = useEditor((s) => s.timeline) as Timeline;
  const sel = useEditor((s) => s.selection);
  const playhead = useEditor((s) => s.playhead);
  const { commit, select } = useEditor.getState();
  const [kfOpen, setKfOpen] = useState(false);
  const segs = segments(tl);

  if (sel?.kind === "clip") {
    const sg = segs.find((s) => s.clip.id === sel.id);
    if (!sg) return null;
    const c = sg.clip;
    const dur = sg.t1 - sg.t0;
    const segIndex = sg.index;
    const upd = (fn: (c: Timeline["clips"][number]) => void) => commit((t) => fn(t.clips[segIndex]));
    const panel = tl.reframe.panels[0];
    const [cx, cy, z] = interpKeyframes(panel.keyframes, playhead);
    const setKf = (p: { cx?: number; cy?: number; zoom?: number }) =>
      commit((t) => {
        t.reframe.mode = "manual";
        const pn = t.reframe.panels[0];
        const ex = pn.keyframes.find((k) => Math.abs(k.t - playhead) < 0.02);
        if (ex) Object.assign(ex, p);
        else pn.keyframes.push({ t: Math.round(playhead * 1000) / 1000, cx: p.cx ?? cx, cy: p.cy ?? cy, zoom: p.zoom ?? z, ease: "ease_in_out" });
        pn.keyframes.sort((a, b) => a.t - b.t);
      });
    return (
      <div>
        <Section title={`Clip ${sg.index + 1} of ${segs.length}`} action={<Badge>{tc(sg.t0, true)} → {tc(sg.t1, true)}</Badge>}>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Source in" value={c.src_in} step={0.04} min={0} onChange={(v) => upd((x) => { x.src_in = Math.min(v, x.src_out - 0.2); })} suffix="s" />
            <Num label="Source out" value={c.src_out} step={0.04} onChange={(v) => upd((x) => { x.src_out = Math.max(v, x.src_in + 0.2); })} suffix="s" />
          </div>
          <Field label="Speed"><Segmented size="sm" value={String(c.speed)} onChange={(v) => upd((x) => { x.speed = Number(v); })} options={["0.5", "0.75", "1", "1.25", "1.5", "2"].map((s) => ({ value: s, label: `${s}×` }))} /></Field>
          <Slider label="Volume" value={c.volume_db} min={-30} max={12} step={0.5} onChange={(v) => upd((x) => { x.volume_db = v; })} format={(v) => `${v.toFixed(1)} dB`} />
          <Switch checked={c.muted} onChange={(v) => upd((x) => { x.muted = v; })} label="Mute clip audio" />
        </Section>
        {sg.index > 0 && (
          <Section title="Transition into this clip">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Type"><NativeSelect value={c.transition_in.type} onChange={(v) => upd((x) => { x.transition_in = { type: v as TransitionType, duration: v === "cut" ? 0 : Math.max(0.2, x.transition_in.duration || 0.4) }; })} options={TRANSITIONS.map((t) => ({ value: t, label: t.replace("_", " ") }))} /></Field>
              <Num label="Duration" value={c.transition_in.duration} step={0.05} min={0} max={2} onChange={(v) => upd((x) => { x.transition_in.duration = v; })} suffix="s" />
            </div>
            {["crossfade", "slide", "zoom"].includes(c.transition_in.type) && <p className="text-2xs text-muted">Live preview shows a cut here; use Exact Frame or export to see the blend.</p>}
          </Section>
        )}
        <Section title="Effects" action={<Badge>{c.effects.length}</Badge>}>
          {c.effects.length === 0 && <p className="text-2xs text-muted">Add effects from the Effects tab on the left.</p>}
          {c.effects.map((e, i) => (
            <EffectRow key={e.id} e={e} clipDur={dur}
              onChange={(p) => upd((x) => { Object.assign(x.effects[i], p); })}
              onDelete={() => upd((x) => { x.effects.splice(i, 1); })} />
          ))}
          {c.effects.length > 0 && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => upd((x) => { x.effects = []; })}>Reset effects</Button>}
        </Section>
        <Section title="Framing at playhead" action={<Button size="xs" variant="ghost" onClick={() => setKfOpen(!kfOpen)}>{kfOpen ? "Hide" : "Edit"}</Button>}>
          <p className="text-2xs text-sub">Reframe: <b className="text-fg">{tl.reframe.mode}</b> · {panel.keyframes.length} keyframe(s)</p>
          {kfOpen && (
            <>
              <Slider label="Centre X" value={cx} min={0} max={1} onChange={(v) => setKf({ cx: v })} />
              <Slider label="Centre Y" value={cy} min={0} max={1} onChange={(v) => setKf({ cy: v })} />
              <Slider label="Zoom" value={z} min={0.3} max={3} onChange={(v) => setKf({ zoom: v })} />
              <Button size="sm" variant="ghost" icon={<Crosshair className="h-3.5 w-3.5" />} onClick={() => setKf({})}>Add keyframe here</Button>
              <p className="text-2xs text-muted">Editing keyframes switches this edit to Manual crop.</p>
            </>
          )}
        </Section>
      </div>
    );
  }

  if (sel?.kind === "text") {
    const i = tl.texts.findIndex((x) => x.id === sel.id);
    if (i < 0) return null;
    const x = tl.texts[i];
    const upd = (p: Partial<TextLayer>) => commit((t) => Object.assign(t.texts[i], p));
    return (
      <div>
        <Section title={`Text · ${x.kind.replace("_", " ")}`} action={<button onClick={() => { commit((t) => { t.texts.splice(i, 1); }); select(null); }} className="text-muted hover:text-err" aria-label="Delete text"><Trash2 className="h-3.5 w-3.5" /></button>}>
          <Field label="Text"><Textarea rows={2} value={x.text} onChange={(e) => upd({ text: e.target.value })} data-testid="text-content" /></Field>
          {x.kind === "lower_third" && <Field label="Subtitle"><Input value={x.subtitle} onChange={(e) => upd({ subtitle: e.target.value })} /></Field>}
          <div className="grid grid-cols-2 gap-2">
            <Num label="Start" value={x.start} min={0} step={0.05} onChange={(v) => upd({ start: Math.min(v, x.end - 0.1) })} suffix="s" />
            <Num label="End" value={x.end} min={0} step={0.05} onChange={(v) => upd({ end: Math.max(v, x.start + 0.1) })} suffix="s" />
          </div>
          <Slider label="Position X" value={x.x} min={0} max={1} onChange={(v) => upd({ x: v })} />
          <Slider label="Position Y" value={x.y} min={0} max={1} onChange={(v) => upd({ y: v })} />
          <Slider label="Wrap width" value={x.width} min={0.1} max={1} onChange={(v) => upd({ width: v })} />
          <Slider label="Opacity" value={x.opacity} min={0} max={1} onChange={(v) => upd({ opacity: v })} />
        </Section>
        <Section title="Style"><TextStyleEditor style={x.style} onChange={(p) => commit((t) => Object.assign(t.texts[i].style, p))} /></Section>
        <Section title="Animation">
          <AnimEditor label="In" value={x.anim_in} onChange={(a) => upd({ anim_in: a })} />
          <AnimEditor label="Out" value={x.anim_out} onChange={(a) => upd({ anim_out: a })} />
        </Section>
      </div>
    );
  }

  if (sel?.kind === "graphic") {
    const i = tl.graphics.findIndex((x) => x.id === sel.id);
    if (i < 0) return null;
    const g = tl.graphics[i];
    const upd = (p: Partial<GraphicLayer>) => commit((t) => Object.assign(t.graphics[i], p));
    return (
      <div>
        <Section title={`Graphic · ${g.kind.replace("_", " ")}`} action={<button onClick={() => { commit((t) => { t.graphics.splice(i, 1); }); select(null); }} className="text-muted hover:text-err" aria-label="Delete graphic"><Trash2 className="h-3.5 w-3.5" /></button>}>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Start" value={g.start} min={0} step={0.05} onChange={(v) => upd({ start: Math.min(v, g.end - 0.1) })} suffix="s" />
            <Num label="End" value={g.end} min={0} step={0.05} onChange={(v) => upd({ end: Math.max(v, g.start + 0.1) })} suffix="s" />
          </div>
          <Slider label="X" value={g.x} min={0} max={1} onChange={(v) => upd({ x: v })} />
          <Slider label="Y" value={g.y} min={0} max={1} onChange={(v) => upd({ y: v })} />
          <Slider label="Width" value={g.w} min={0.01} max={1} onChange={(v) => upd({ w: v })} />
          <Slider label="Height" value={g.h} min={0.002} max={1} step={0.001} onChange={(v) => upd({ h: v })} />
          {g.kind === "arrow" && <Slider label="Rotation" value={g.rotation} min={-180} max={180} step={1} onChange={(v) => upd({ rotation: v })} format={(v) => `${v.toFixed(0)}°`} />}
          {!["image", "logo"].includes(g.kind) && (
            <>
              <ColorInput label="Colour" value={g.color} onChange={(v) => upd({ color: v })} />
              {g.kind !== "arrow" && g.kind !== "progress_bar" && <Slider label="Stroke" value={g.stroke} min={0} max={0.02} step={0.0005} onChange={(v) => upd({ stroke: v })} format={(v) => (v * 1000).toFixed(1)} />}
              {g.kind !== "arrow" && <Slider label="Fill" value={g.fill_opacity} min={0} max={1} onChange={(v) => upd({ fill_opacity: v })} />}
              {(g.kind === "rect" || g.kind === "highlight_box") && <Slider label="Corner radius" value={g.radius} min={0} max={0.1} step={0.001} onChange={(v) => upd({ radius: v })} />}
            </>
          )}
          <Slider label="Opacity" value={g.opacity} min={0} max={1} onChange={(v) => upd({ opacity: v })} />
        </Section>
        <Section title="Animation">
          <AnimEditor label="In" value={g.anim_in} onChange={(a) => upd({ anim_in: a })} />
          <AnimEditor label="Out" value={g.anim_out} onChange={(a) => upd({ anim_out: a })} />
        </Section>
      </div>
    );
  }

  if (sel?.kind === "audio") {
    const i = tl.audio_clips.findIndex((x) => x.id === sel.id);
    if (i < 0) return null;
    const a = tl.audio_clips[i];
    const upd = (p: Partial<typeof a>) => commit((t) => Object.assign(t.audio_clips[i], p));
    return (
      <Section title={a.label === "sfx" ? "Sound effect" : "Music"} action={<button onClick={() => { commit((t) => { t.audio_clips.splice(i, 1); }); select(null); }} className="text-muted hover:text-err" aria-label="Delete audio"><Trash2 className="h-3.5 w-3.5" /></button>}>
        <Slider label="Gain" value={a.gain_db} min={-40} max={6} step={0.5} onChange={(v) => upd({ gain_db: v })} format={(v) => `${v.toFixed(1)} dB`} />
        <div className="grid grid-cols-2 gap-2">
          <Num label="Fade in" value={a.fade_in} min={0} step={0.1} onChange={(v) => upd({ fade_in: v })} suffix="s" />
          <Num label="Fade out" value={a.fade_out} min={0} step={0.1} onChange={(v) => upd({ fade_out: v })} suffix="s" />
          <Num label="Start" value={a.start} min={0} step={0.1} onChange={(v) => upd({ start: v })} suffix="s" />
          <Num label="Source in" value={a.src_in} min={0} step={0.1} onChange={(v) => upd({ src_in: v })} suffix="s" />
        </div>
        <Switch checked={a.duck} onChange={(v) => upd({ duck: v })} label="Duck under dialogue" />
        <Switch checked={a.loop} onChange={(v) => upd({ loop: v })} label="Loop" />
        <p className="text-2xs text-muted">Music and SFX are mixed in the export; the live preview plays dialogue only.</p>
      </Section>
    );
  }

  if (sel?.kind === "word") {
    const i = tl.captions.words.findIndex((w) => w.id === sel.id);
    if (i < 0) return null;
    const w = tl.captions.words[i];
    const upd = (p: Partial<typeof w>) => commit((t) => Object.assign(t.captions.words[i], p));
    return (
      <Section title="Caption word">
        <Field label="Text" hint="Fix transcription errors here; timing is preserved."><Input value={w.text} onChange={(e) => upd({ text: e.target.value })} data-testid="word-input" /></Field>
        <Switch checked={w.emphasis} onChange={(v) => upd({ emphasis: v })} label="Emphasise (accent colour)" />
        <Switch checked={w.hidden} onChange={(v) => upd({ hidden: v })} label="Hide from captions" />
        <ColorInput label="Custom colour" value={w.color ?? tl.captions.style.color} onChange={(v) => upd({ color: v })} />
        {w.color && <Button size="xs" variant="ghost" onClick={() => upd({ color: null })}>Clear colour</Button>}
        <p className="text-2xs text-muted">Source time {w.src_s.toFixed(2)}–{w.src_e.toFixed(2)}s</p>
      </Section>
    );
  }

  if (sel?.kind === "marker") {
    const i = tl.markers.findIndex((m) => m.id === sel.id);
    if (i < 0) return null;
    const m = tl.markers[i];
    return (
      <Section title="Marker">
        <Field label="Label"><Input value={m.label} onChange={(e) => commit((t) => { t.markers[i].label = e.target.value; })} /></Field>
        <ColorInput label="Colour" value={m.color} onChange={(v) => commit((t) => { t.markers[i].color = v; })} />
        <Button size="sm" variant="danger" onClick={() => { commit((t) => { t.markers.splice(i, 1); }); select(null); }}>Delete marker</Button>
      </Section>
    );
  }

  // Nothing selected: edit-wide settings
  const c = tl.color;
  const setC = (p: Partial<typeof c>) => commit((t) => Object.assign(t.color, p));
  return (
    <div>
      <Section title="Framing">
        <Field label="Reframe mode">
          <NativeSelect value={tl.reframe.mode} onChange={(v) => onReframe(v)} options={[
            { value: "auto", label: "Auto focus (follow subject)" }, { value: "speaker", label: "Speaker focus" }, { value: "split", label: "Split screen (two people)" },
            { value: "fill", label: "Smart fill (full frame + blur)" }, { value: "original", label: "Original frame" }, { value: "manual", label: "Manual crop (keyframes)" },
          ]} />
        </Field>
        {tl.reframe.note && <p className="text-2xs text-sub">{tl.reframe.note}</p>}
        {tl.reframe.confidence < 0.4 && tl.reframe.mode !== "fill" && tl.reframe.mode !== "original" && <Alert tone="warn">Low tracking confidence — consider Smart fill.</Alert>}
        <Field label="Background"><Segmented size="sm" value={tl.reframe.background} onChange={(v) => commit((t) => { t.reframe.background = v; })} options={[{ value: "blur", label: "Blur" }, { value: "black", label: "Black" }, { value: "color", label: "Colour" }]} /></Field>
        {tl.reframe.background === "color" && <ColorInput label="Background colour" value={tl.reframe.background_color} onChange={(v) => commit((t) => { t.reframe.background_color = v; })} />}
      </Section>
      <Section title="Colour" action={<Button size="xs" variant="ghost" onClick={() => setC({ exposure: 0, contrast: 1, saturation: 1, temperature: 0, vignette: 0, sharpen: 0 })}>Reset</Button>}>
        <Slider label="Exposure" value={c.exposure} min={-1} max={1} onChange={(v) => setC({ exposure: v })} />
        <Slider label="Contrast" value={c.contrast} min={0.5} max={2} onChange={(v) => setC({ contrast: v })} />
        <Slider label="Saturation" value={c.saturation} min={0} max={2.5} onChange={(v) => setC({ saturation: v })} />
        <Slider label="Temperature" value={c.temperature} min={-1} max={1} onChange={(v) => setC({ temperature: v })} />
        <Slider label="Vignette" value={c.vignette} min={0} max={1} onChange={(v) => setC({ vignette: v })} />
        <Slider label="Sharpen" value={c.sharpen} min={0} max={1} onChange={(v) => setC({ sharpen: v })} />
        <p className="text-2xs text-muted">Sharpening is applied at export (not shown in live preview).</p>
      </Section>
      <Section title="Edit notes">
        {tl.notes.map((n, i) => <p key={i} className="text-2xs text-sub">• {n}</p>)}
        <p className="text-2xs text-muted">Canvas {tl.canvas.width}×{tl.canvas.height} · {tl.canvas.fps} fps · {tl.canvas.aspect}</p>
      </Section>
    </div>
  );
}
