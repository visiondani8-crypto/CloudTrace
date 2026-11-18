import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Download, Eye, Film, Image as ImageIcon, Music, Plus, RefreshCw, Sparkles, Upload, Volume2, Wand2 } from "lucide-react";
import { errorMessage, get, post, postText, uploadFile } from "@/lib/api";
import type { Asset, BrandKit, CaptionStyle, Edit, Timeline } from "@/lib/types";
import { STYLE_LABELS, tc } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Alert, Badge, Button, ColorInput, Field, NativeSelect, Segmented, Slider, Switch, Tab, TabList, TabPanel, Tabs, useToast } from "@/components/ui";
import { useEditor } from "./store";

const FONTS = ["Inter", "Montserrat", "Poppins", "Anton", "BebasNeue", "SpaceGrotesk", "PlayfairDisplay", "Bangers", "Oswald", "DMSerifDisplay"];
const EFFECTS: [string, string][] = [
  ["zoom", "Punch-in zoom"], ["slow_zoom", "Slow zoom"], ["pan", "Pan"], ["blur", "Blur"], ["vignette", "Vignette"], ["exposure", "Exposure"],
  ["contrast", "Contrast"], ["saturation", "Saturation"], ["sharpen", "Sharpen"], ["fade_in", "Fade in"], ["fade_out", "Fade out"],
  ["freeze", "Freeze frame"], ["mask", "Mask"], ["grade", "Colour grade"],
];
const AUDIO_PRESETS: [string, string, string][] = [
  ["natural", "Natural", "Loudness only"], ["podcast_clean", "Podcast Clean", "HPF, de-mud, presence, gentle denoise, compression"],
  ["voice_forward", "Voice Forward", "More presence, stronger compression"], ["cinematic", "Cinematic", "Warmth + air, soft compression"],
  ["gaming", "Gaming Commentary", "Bright voice cut-through"], ["off", "Off", "Untouched source audio"],
];
const AUDIO_EQ: Record<string, any> = {
  natural: { highpass: 0, eq: [], compressor: false, denoise: 0 },
  podcast_clean: { highpass: 80, eq: [{ f: 250, g: -2, q: 1 }, { f: 3000, g: 2, q: 1.2 }], compressor: true, denoise: 0.25 },
  voice_forward: { highpass: 90, eq: [{ f: 300, g: -3, q: 1 }, { f: 3500, g: 3, q: 1 }], compressor: true, denoise: 0.2 },
  cinematic: { highpass: 60, eq: [{ f: 120, g: 1.5, q: 0.8 }, { f: 8000, g: 1, q: 0.7 }], compressor: true, denoise: 0.15 },
  gaming: { highpass: 100, eq: [{ f: 2500, g: 3, q: 1 }], compressor: true, denoise: 0.1 },
  off: { highpass: 0, eq: [], compressor: false, denoise: 0 },
};

function Block({ title, children, sub }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line px-3 py-3">
      <h4 className="text-2xs font-semibold uppercase tracking-wider text-muted">{title}</h4>
      {sub && <p className="mt-0.5 text-2xs text-muted">{sub}</p>}
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

function CaptionsTab({ editId }: { editId: string }) {
  const tl = useEditor((s) => s.timeline) as Timeline;
  const { commit, select, setPlayhead } = useEditor.getState();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: presets } = useQuery({ queryKey: ["caption-presets"], queryFn: () => get<{ key: string; label: string; style: CaptionStyle }[]>("/caption-presets"), staleTime: Infinity });
  const cs = tl.captions.style;
  const set = (p: Partial<CaptionStyle>) => commit((t) => Object.assign(t.captions.style, p));
  const importSubs = async (f: File) => {
    try {
      const r = await postText<{ cues: number; timeline: Timeline }>(`/edits/${editId}/captions/import`, await f.text());
      useEditor.getState().commit((t) => { t.captions = r.timeline.captions; });
      toast({ tone: "ok", text: `Imported ${r.cues} subtitle cue(s)` });
    } catch (e) {
      toast({ tone: "err", text: errorMessage(e) });
    }
  };
  return (
    <>
      <Block title="Captions">
        <Switch checked={tl.captions.enabled} onChange={(v) => commit((t) => { t.captions.enabled = v; })} label="Show captions" />
        <div className="grid grid-cols-2 gap-1.5">
          {(presets ?? []).map((p) => (
            <button key={p.key} onClick={() => commit((t) => { t.captions.style = { ...p.style }; })}
              className={cn("rounded-md border px-2 py-2 text-left transition-colors", cs.preset === p.key ? "border-accent bg-accent/10" : "border-line bg-bg/40 hover:border-sub")}
              data-testid={`caption-preset-${p.key}`}>
              <div className="truncate text-[12px]" style={{ fontFamily: `"cf-${p.style.font}-${p.style.weight}", ${p.style.font}`, fontWeight: p.style.weight, color: p.style.color, textTransform: p.style.uppercase ? "uppercase" : "none", fontStyle: p.style.italic ? "italic" : "normal" }}>
                Ab <span style={{ color: p.style.active_color }}>cd</span>
              </div>
              <div className="mt-0.5 text-2xs text-sub">{p.label}</div>
            </button>
          ))}
        </div>
      </Block>
      <Block title="Style">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Font"><NativeSelect value={cs.font} onChange={(v) => set({ font: v })} options={FONTS.map((f) => ({ value: f, label: f.replace(/([a-z])([A-Z])/g, "$1 $2") }))} /></Field>
          <Field label="Weight"><NativeSelect value={cs.weight} onChange={(v) => set({ weight: Number(v) })} options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))} /></Field>
        </div>
        <Field label="Mode"><Segmented size="sm" value={cs.mode} onChange={(v) => set({ mode: v, max_words: v === "word" ? 1 : Math.max(cs.max_words, 3) })} options={[{ value: "phrase", label: "Phrase" }, { value: "highlight", label: "Highlight" }, { value: "karaoke", label: "Karaoke" }, { value: "word", label: "Word" }]} /></Field>
        <Slider label="Size" value={cs.size} min={0.02} max={0.12} step={0.001} onChange={(v) => set({ size: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
        <ColorInput label="Text colour" value={cs.color} onChange={(v) => set({ color: v })} />
        <ColorInput label="Active / emphasis colour" value={cs.active_color} onChange={(v) => set({ active_color: v })} />
        <Slider label="Outline" value={cs.outline} min={0} max={0.015} step={0.0005} onChange={(v) => set({ outline: v })} format={(v) => (v * 1000).toFixed(1)} />
        <ColorInput label="Outline colour" value={cs.outline_color} onChange={(v) => set({ outline_color: v })} />
        <Slider label="Shadow" value={cs.shadow} min={0} max={0.012} step={0.0005} onChange={(v) => set({ shadow: v })} format={(v) => (v * 1000).toFixed(1)} />
        <Slider label="Glow" value={cs.glow} min={0} max={0.03} step={0.001} onChange={(v) => set({ glow: v })} format={(v) => (v * 1000).toFixed(0)} />
        <Field label="Background"><Segmented size="sm" value={cs.background} onChange={(v) => set({ background: v, background_opacity: v === "none" ? 0 : Math.max(0.6, cs.background_opacity) })} options={[{ value: "none", label: "None" }, { value: "box", label: "Box" }, { value: "rounded", label: "Rounded" }, { value: "word_box", label: "Word" }]} /></Field>
        {cs.background !== "none" && (
          <>
            <ColorInput label="Background colour" value={cs.background_color} onChange={(v) => set({ background_color: v })} />
            <Slider label="Bg opacity" value={cs.background_opacity} min={0} max={1} onChange={(v) => set({ background_opacity: v })} />
          </>
        )}
        <Slider label="Letter spacing" value={cs.letter_spacing} min={-0.05} max={0.3} step={0.005} onChange={(v) => set({ letter_spacing: v })} />
        <Slider label="Line height" value={cs.line_height} min={0.8} max={2} onChange={(v) => set({ line_height: v })} />
        <Field label="Align"><Segmented size="sm" value={cs.align} onChange={(v) => set({ align: v, position_x: v === "left" ? 0.08 : v === "right" ? 0.92 : 0.5 })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }]} /></Field>
        <Slider label="Position Y" value={cs.position_y} min={0.05} max={0.95} onChange={(v) => set({ position_y: v })} />
        <Slider label="Max width" value={cs.max_width} min={0.3} max={1} onChange={(v) => set({ max_width: v })} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Words / page"><NativeSelect value={cs.max_words} onChange={(v) => set({ max_words: Number(v) })} options={[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => ({ value: n, label: String(n) }))} /></Field>
          <Field label="Max lines"><NativeSelect value={cs.max_lines} onChange={(v) => set({ max_lines: Number(v) })} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} /></Field>
        </div>
        <Field label="Animation"><NativeSelect value={cs.animation} onChange={(v) => set({ animation: v as any })} options={["none", "fade", "pop", "slide", "bounce", "scale"].map((a) => ({ value: a, label: a }))} /></Field>
        <Slider label="Anim speed" value={cs.animation_speed} min={0.25} max={4} onChange={(v) => set({ animation_speed: v })} format={(v) => `${v.toFixed(2)}×`} />
        <Slider label="Active scale" value={cs.active_scale} min={1} max={1.3} onChange={(v) => set({ active_scale: v })} />
        <div className="grid grid-cols-2 gap-2">
          <Switch checked={cs.uppercase} onChange={(v) => set({ uppercase: v })} label="Uppercase" />
          <Switch checked={cs.italic} onChange={(v) => set({ italic: v })} label="Italic" />
        </div>
      </Block>
      <Block title="Words" sub="Click a word to correct it, emphasise or hide it.">
        <div className="flex max-h-56 flex-wrap gap-1 overflow-y-auto rounded-md border border-line bg-bg/40 p-2 text-xs leading-6">
          {tl.captions.words.map((w) => (
            <button key={w.id} onClick={() => { select({ kind: "word", id: w.id }); }} onDoubleClick={() => setPlayhead(0)}
              className={cn("rounded px-0.5 hover:bg-raised", w.hidden && "text-muted line-through", w.emphasis && "text-warn")}>
              {w.text}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" icon={<Upload className="h-3 w-3" />} onClick={() => fileRef.current?.click()}>Import SRT/VTT</Button>
          <input ref={fileRef} type="file" accept=".srt,.vtt" hidden onChange={(e) => e.target.files?.[0] && importSubs(e.target.files[0])} />
          <a href={`/api/edits/${editId}/captions.srt`} className="inline-flex"><Button size="xs" icon={<Download className="h-3 w-3" />}>SRT</Button></a>
          <a href={`/api/edits/${editId}/captions.vtt`} className="inline-flex"><Button size="xs" icon={<Download className="h-3 w-3" />}>VTT</Button></a>
        </div>
        <p className="text-2xs text-muted">Downloads reflect the last saved version.</p>
      </Block>
    </>
  );
}

function HooksTab({ editId, onApplied }: { editId: string; onApplied: (e: Edit) => void }) {
  const tl = useEditor((s) => s.timeline) as Timeline;
  const toast = useToast();
  const { data: hooks, isLoading, refetch } = useQuery({ queryKey: ["hooks", editId], queryFn: () => get<any[]>(`/edits/${editId}/hooks`) });
  const [preview, setPreview] = useState<string | null>(null);
  const apply = useMutation({
    mutationFn: (s: any) => post<Edit>(`/edits/${editId}/hooks/apply`, { suggestion: s, timeline: tl }),
    onSuccess: (e) => { toast({ tone: "ok", text: "Hook applied as a new version (the previous version is kept)" }); onApplied(e); },
    onError: (e) => toast({ tone: "err", text: errorMessage(e) }),
  });
  const previewHook = async (s: any) => {
    const r = await post<Timeline>(`/edits/${editId}/hooks/preview`, { suggestion: s, timeline: tl });
    useEditor.getState().commit((t) => Object.assign(t, r));
    useEditor.getState().setPlayhead(0);
    setPreview(s.id);
  };
  return (
    <Block title="Opening hook" sub="Analyses the first seconds. Suggestions only re-cut real speech or add on-screen text — they never invent words.">
      {isLoading && <p className="text-xs text-sub">Analysing…</p>}
      {(hooks ?? []).length === 0 && !isLoading && <p className="text-xs text-sub">The opening already looks strong.</p>}
      {(hooks ?? []).map((h) => (
        <div key={h.id} className={cn("rounded-lg border p-2.5", preview === h.id ? "border-accent" : "border-line")}>
          <div className="text-xs font-medium">{h.label}</div>
          <p className="mt-1 text-2xs text-sub">{h.description}</p>
          <div className="mt-2 flex gap-1.5">
            <Button size="xs" icon={<Eye className="h-3 w-3" />} onClick={() => previewHook(h)}>Preview</Button>
            <Button size="xs" variant="primary" loading={apply.isPending} onClick={() => apply.mutate(h)}>Apply</Button>
          </div>
        </div>
      ))}
      {preview && <Alert tone="accent">Previewing a variation — press Undo (⌘Z) to compare with the original, or Apply to keep it.</Alert>}
      <Button size="xs" variant="ghost" icon={<RefreshCw className="h-3 w-3" />} onClick={() => refetch()}>Re-analyse</Button>
    </Block>
  );
}

function MediaTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { addAudio, addGraphic, addOverlay } = useEditor.getState();
  const { data: assets } = useQuery({ queryKey: ["assets"], queryFn: () => get<Asset[]>("/assets") });
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("image");
  const [busy, setBusy] = useState(false);
  const upload = async (f: File) => {
    setBusy(true);
    try {
      await uploadFile(`/assets?kind=${kind}&filename=${encodeURIComponent(f.name)}`, f, () => {}).promise;
      qc.invalidateQueries({ queryKey: ["assets"] });
    } catch (e) {
      toast({ tone: "err", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const icon = (k: string) => (k === "music" || k === "sfx" ? <Music className="h-3.5 w-3.5" /> : k === "broll" ? <Film className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />);
  return (
    <Block title="Your media" sub="Only use media you own or have licensed. Nothing is fetched from the internet.">
      <div className="flex gap-1.5">
        <NativeSelect value={kind} onChange={setKind} options={[{ value: "image", label: "Image" }, { value: "logo", label: "Logo" }, { value: "music", label: "Music" }, { value: "sfx", label: "Sound effect" }, { value: "broll", label: "B-roll video" }]} />
        <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} loading={busy} onClick={() => fileRef.current?.click()}>Upload</Button>
        <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      <div className="space-y-1">
        {(assets ?? []).map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded-md border border-line bg-bg/40 px-2 py-1.5 text-xs">
            {icon(a.kind)}
            <span className="flex-1 truncate">{a.name}</span>
            <Badge>{a.kind}</Badge>
            <button className="rounded p-0.5 text-sub hover:text-accent" aria-label={`Add ${a.name}`}
              onClick={() => {
                if (a.kind === "music" || a.kind === "sfx") addAudio(a.id, a.kind, a.meta.duration ?? 10);
                else if (a.kind === "broll") addOverlay(a.id, a.meta.duration ?? 3);
                else addGraphic(a.kind === "logo" ? "logo" : "image", a.id, (a.meta.width ?? 1) / (a.meta.height ?? 1));
              }}>
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {(assets ?? []).length === 0 && <p className="text-2xs text-muted">No assets yet.</p>}
      </div>
    </Block>
  );
}

function VersionsTab({ edit, onOpen }: { edit: Edit; onOpen: (id: string) => void }) {
  const toast = useToast();
  const [style, setStyle] = useState<string>(edit.style);
  const { data: versions, refetch } = useQuery({ queryKey: ["versions", edit.id], queryFn: () => get<Edit[]>(`/edits/${edit.id}/versions`) });
  const regen = useMutation({
    mutationFn: () => post<Edit>(`/edits/${edit.id}/regenerate`, { style }),
    onSuccess: (e) => { toast({ tone: "ok", text: `Created version ${e.version}` }); refetch(); onOpen(e.id); },
    onError: (e) => toast({ tone: "err", text: errorMessage(e) }),
  });
  return (
    <>
      <Block title="Regenerate edit" sub="Builds a new variation from the same source clip. Previous versions are preserved.">
        <Segmented value={style} onChange={setStyle} options={Object.entries(STYLE_LABELS).map(([value, label]) => ({ value, label: label.split(" ")[0] }))} />
        <Button variant="primary" size="sm" icon={<Wand2 className="h-3.5 w-3.5" />} loading={regen.isPending} onClick={() => regen.mutate()} data-testid="regenerate">Regenerate Edit</Button>
      </Block>
      <Block title="Versions">
        {(versions ?? []).map((v) => (
          <button key={v.id} onClick={() => onOpen(v.id)} className={cn("flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs", v.id === edit.id ? "border-accent bg-accent/10" : "border-line hover:border-sub")}>
            <span>v{v.version} · {STYLE_LABELS[v.style] ?? v.style}</span>
            <span className="text-2xs text-muted">{v.duration?.toFixed(1)}s {v.is_current && "· current"}</span>
          </button>
        ))}
      </Block>
    </>
  );
}

function BrandTab({ editId }: { editId: string }) {
  const tl = useEditor((s) => s.timeline) as Timeline;
  const toast = useToast();
  const { data: kits } = useQuery({ queryKey: ["brand-kits"], queryFn: () => get<BrandKit[]>("/brand-kits") });
  const apply = async (id: string) => {
    try {
      const r = await post<Timeline>(`/edits/${editId}/brand`, { brand_kit_id: id, timeline: tl });
      useEditor.getState().commit((t) => Object.assign(t, r));
      toast({ tone: "ok", text: "Brand kit applied (undo to revert)" });
    } catch (e) {
      toast({ tone: "err", text: errorMessage(e) });
    }
  };
  return (
    <Block title="Brand kits" sub="Applies fonts, colours, logo, audio and transitions as editable properties.">
      {(kits ?? []).map((k) => (
        <button key={k.id} onClick={() => apply(k.id)} className={cn("flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs hover:border-accent", tl.brand_kit_id === k.id ? "border-accent" : "border-line")}>
          <span className="h-4 w-4 rounded" style={{ background: k.data.primary_color ?? "#5B8CFF" }} />
          <span className="flex-1">{k.name}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted" />
        </button>
      ))}
      {(kits ?? []).length === 0 && <p className="text-2xs text-muted">Create brand kits on the Brand Kits page.</p>}
    </Block>
  );
}

export function LeftPanel({ edit, onOpenEdit }: { edit: Edit; onOpenEdit: (id: string) => void }) {
  const tl = useEditor((s) => s.timeline) as Timeline;
  const { addText, addGraphic, addEffect, commit } = useEditor.getState();
  const sel = useEditor((s) => s.selection);
  const audio = tl.audio;
  const setA = (p: Partial<typeof audio>) => commit((t) => Object.assign(t.audio, p));
  return (
    <Tabs defaultValue="captions" className="flex h-full flex-col">
      <TabList className="flex-wrap px-1">
        <Tab value="captions">Captions</Tab>
        <Tab value="text">Text</Tab>
        <Tab value="effects">Effects</Tab>
        <Tab value="audio">Audio</Tab>
        <Tab value="media">Media</Tab>
        <Tab value="hooks"><Sparkles className="mr-1 inline h-3 w-3" />Hooks</Tab>
        <Tab value="brand">Brand</Tab>
        <Tab value="versions">Versions</Tab>
      </TabList>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TabPanel value="captions"><CaptionsTab editId={edit.id} /></TabPanel>
        <TabPanel value="text">
          <Block title="Add text" sub="Added at the playhead for 3 s.">
            <div className="grid grid-cols-2 gap-1.5">
              {([["title", "Title"], ["hook", "Hook text"], ["callout", "Callout"], ["lower_third", "Lower third"], ["label", "Label"]] as const).map(([k, l]) => (
                <Button key={k} size="sm" variant="outline" onClick={() => addText(k)} data-testid={`add-text-${k}`}>{l}</Button>
              ))}
            </div>
          </Block>
          <Block title="Add graphic">
            <div className="grid grid-cols-2 gap-1.5">
              {([["highlight_box", "Highlight box"], ["rect", "Shape"], ["circle", "Circle"], ["arrow", "Arrow"], ["progress_bar", "Progress bar"]] as const).map(([k, l]) => (
                <Button key={k} size="sm" variant="outline" onClick={() => addGraphic(k)}>{l}</Button>
              ))}
            </div>
            <p className="text-2xs text-muted">Logos and images: upload them in the Media tab.</p>
          </Block>
        </TabPanel>
        <TabPanel value="effects">
          <Block title="Effects" sub={sel?.kind === "clip" ? "Applied to the selected clip." : "Applied to the clip under the playhead."}>
            <div className="grid grid-cols-2 gap-1.5">
              {EFFECTS.map(([k, l]) => (
                <Button key={k} size="sm" variant="outline" onClick={() => (k === "slow_zoom" ? addEffect("zoom", { from: 1, to: 1.08 }) : addEffect(k as any))}>{l}</Button>
              ))}
            </div>
          </Block>
          <Block title="Transitions" sub="Hard cuts are the default; add transitions intentionally.">
            <div className="grid grid-cols-2 gap-1.5">
              {(["crossfade", "fade_black", "fade_white", "slide", "zoom", "blur", "cut"] as const).map((k) => (
                <Button key={k} size="sm" variant="outline" disabled={tl.clips.length < 2}
                  onClick={() => commit((t) => t.clips.slice(1).forEach((c) => { c.transition_in = { type: k, duration: k === "cut" ? 0 : 0.4 }; }))}>
                  {k === "cut" ? "Hard cuts (all)" : `${k.replace("_", " ")} (all)`}
                </Button>
              ))}
            </div>
            <p className="text-2xs text-muted">Select a clip to set its own transition in the inspector.</p>
          </Block>
        </TabPanel>
        <TabPanel value="audio">
          <Block title="Voice preset">
            <div className="space-y-1">
              {AUDIO_PRESETS.map(([k, l, d]) => (
                <button key={k} onClick={() => setA({ preset: k as any, enabled: k !== "off", ...AUDIO_EQ[k] })}
                  className={cn("w-full rounded-md border px-2 py-1.5 text-left", audio.preset === k ? "border-accent bg-accent/10" : "border-line hover:border-sub")}>
                  <div className="flex items-center gap-1.5 text-xs"><Volume2 className="h-3 w-3" />{l}</div>
                  <div className="text-2xs text-muted">{d}</div>
                </button>
              ))}
            </div>
          </Block>
          <Block title="Mix">
            <Slider label="Dialogue gain" value={audio.dialogue_gain_db} min={-12} max={12} step={0.5} onChange={(v) => setA({ dialogue_gain_db: v })} format={(v) => `${v} dB`} />
            <Slider label="Denoise" value={audio.denoise} min={0} max={1} onChange={(v) => setA({ denoise: v })} />
            <Switch checked={audio.compressor} onChange={(v) => setA({ compressor: v })} label="Compressor" />
            <Switch checked={audio.limiter} onChange={(v) => setA({ limiter: v })} label="Limiter" />
            <Switch checked={audio.normalize} onChange={(v) => setA({ normalize: v })} label="Loudness normalisation" />
            {audio.normalize && <Field label="Loudness target"><NativeSelect value={audio.loudness_target} onChange={(v) => setA({ loudness_target: Number(v) })} options={[{ value: -14, label: "-14 LUFS (social / streaming)" }, { value: -16, label: "-16 LUFS (podcast)" }, { value: -18, label: "-18 LUFS" }, { value: -23, label: "-23 LUFS (broadcast)" }]} /></Field>}
            <div className="grid grid-cols-2 gap-2">
              <Slider label="Fade in" value={audio.fade_in} min={0} max={3} onChange={(v) => setA({ fade_in: v })} />
              <Slider label="Fade out" value={audio.fade_out} min={0} max={3} onChange={(v) => setA({ fade_out: v })} />
            </div>
            <Switch checked={audio.dialogue_mute} onChange={(v) => setA({ dialogue_mute: v })} label="Mute dialogue" />
            <Switch checked={audio.mono} onChange={(v) => setA({ mono: v })} label="Mono downmix" />
            <p className="text-2xs text-muted">Stereo is preserved unless you enable mono. Processing happens once at export from the original audio.</p>
          </Block>
        </TabPanel>
        <TabPanel value="media"><MediaTab /></TabPanel>
        <TabPanel value="hooks"><HooksTab editId={edit.id} onApplied={(e) => onOpenEdit(e.id)} /></TabPanel>
        <TabPanel value="brand"><BrandTab editId={edit.id} /></TabPanel>
        <TabPanel value="versions"><VersionsTab edit={edit} onOpen={onOpenEdit} /></TabPanel>
      </div>
      <div className="border-t border-line px-3 py-2 text-2xs text-muted">Source: {edit.source?.original_name} · clip {tc(edit.highlight?.start ?? 0)}–{tc(edit.highlight?.end ?? 0)}</div>
    </Tabs>
  );
}
