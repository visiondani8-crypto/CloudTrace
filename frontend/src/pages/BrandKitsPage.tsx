import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Save, Trash2, Upload } from "lucide-react";
import { del, errorMessage, get, post, put, uploadFile } from "@/lib/api";
import type { Asset, BrandKit } from "@/lib/types";
import { Button, Card, CardHeader, ColorInput, EmptyState, Field, Input, NativeSelect, PageHeader, Slider, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";

const FONTS = ["Inter", "Montserrat", "Poppins", "Anton", "BebasNeue", "SpaceGrotesk", "PlayfairDisplay", "Bangers", "Oswald", "DMSerifDisplay"];
const CAPTIONS = [["", "Keep edit's style"], ["bold_social", "Bold Social"], ["clean_white", "Clean White"], ["word_by_word", "Word-by-Word"], ["karaoke", "Karaoke"], ["cinematic_minimal", "Cinematic Minimal"], ["documentary", "Documentary"], ["creator", "Creator Style"], ["neon", "Neon Highlight"], ["gaming", "Gaming"], ["custom_brand", "Custom Brand"]];
const EMPTY = { primary_color: "#5B8CFF", secondary_color: "#FFFFFF", caption_color: "#FFFFFF", caption_font: "Montserrat", caption_weight: 800, heading_font: "Montserrat", heading_weight: 900, caption_preset: "", logo_asset_id: "", logo_position: "top_right", logo_size: 0.14, logo_opacity: 0.9, logo_aspect: 1, audio_preset: "", loudness_target: -14, transition: "cut", transition_duration: 0.3, export_preset: "social_hq", intro_asset_id: "", outro_asset_id: "" };

export default function BrandKitsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: kits } = useQuery({ queryKey: ["brand-kits"], queryFn: () => get<BrandKit[]>("/brand-kits") });
  const { data: logos } = useQuery({ queryKey: ["assets", "logo"], queryFn: () => get<Asset[]>("/assets", { kind: "logo" }) });
  const [cur, setCur] = useState<BrandKit | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!cur && kits?.length) setCur(kits[0]);
  }, [kits, cur]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["brand-kits"] });
  const create = useMutation({ mutationFn: () => post<BrandKit>("/brand-kits", { name: "New brand kit", data: EMPTY }), onSuccess: (k) => { refresh(); setCur(k); } });
  const save = useMutation({ mutationFn: () => put<BrandKit>(`/brand-kits/${cur!.id}`, { name: cur!.name, data: cur!.data }), onSuccess: () => { refresh(); toast({ tone: "ok", text: "Brand kit saved" }); }, onError: (e) => toast({ tone: "err", text: errorMessage(e) }) });
  const dup = useMutation({ mutationFn: () => post<BrandKit>(`/brand-kits/${cur!.id}/duplicate`), onSuccess: (k) => { refresh(); setCur(k); } });
  const remove = useMutation({ mutationFn: () => del(`/brand-kits/${cur!.id}`), onSuccess: () => { refresh(); setCur(null); } });
  const d = { ...EMPTY, ...(cur?.data ?? {}) };
  const set = (p: Record<string, any>) => cur && setCur({ ...cur, data: { ...d, ...p } });
  const uploadLogo = async (f: File) => {
    try {
      const a = await uploadFile<Asset>(`/assets?kind=logo&filename=${encodeURIComponent(f.name)}`, f, () => {}).promise;
      qc.invalidateQueries({ queryKey: ["assets"] });
      set({ logo_asset_id: a.id, logo_aspect: (a.meta.width ?? 1) / (a.meta.height ?? 1) });
    } catch (e) {
      toast({ tone: "err", text: errorMessage(e) });
    }
  };
  return (
    <div className="mx-auto max-w-[1200px] px-8 py-7">
      <PageHeader title="Brand Kits" sub="Reusable presets applied as editable properties — never burned into your source files." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => create.mutate()}>New brand kit</Button>} />
      {(kits ?? []).length === 0 ? (
        <EmptyState title="No brand kits yet" sub="Save your fonts, colours, logo and audio preferences once and apply them to any edit." action={<Button variant="primary" onClick={() => create.mutate()}>Create brand kit</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
          <Card className="h-fit p-2">
            {(kits ?? []).map((k) => (
              <button key={k.id} onClick={() => setCur(k)} className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px]", cur?.id === k.id ? "bg-raised" : "hover:bg-raised/60")}>
                <span className="h-4 w-4 rounded" style={{ background: k.data.primary_color }} />{k.name}
              </button>
            ))}
          </Card>
          {cur && (
            <Card>
              <CardHeader title={<Input value={cur.name} onChange={(e) => setCur({ ...cur, name: e.target.value })} className="h-8 w-72 text-sm font-semibold" />}
                action={<div className="flex gap-1.5"><Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => dup.mutate()}>Duplicate</Button><Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove.mutate()}>Delete</Button><Button size="sm" variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>} />
              <div className="grid grid-cols-1 gap-6 px-4 pb-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <h4 className="text-2xs font-semibold uppercase tracking-wider text-muted">Colours & type</h4>
                  <ColorInput label="Primary (accent / active word)" value={d.primary_color} onChange={(v) => set({ primary_color: v })} />
                  <ColorInput label="Secondary (heading box)" value={d.secondary_color} onChange={(v) => set({ secondary_color: v })} />
                  <ColorInput label="Caption text" value={d.caption_color} onChange={(v) => set({ caption_color: v })} />
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Caption font"><NativeSelect value={d.caption_font} onChange={(v) => set({ caption_font: v })} options={FONTS.map((f) => ({ value: f, label: f }))} /></Field>
                    <Field label="Weight"><NativeSelect value={d.caption_weight} onChange={(v) => set({ caption_weight: Number(v) })} options={[400, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))} /></Field>
                    <Field label="Heading font"><NativeSelect value={d.heading_font} onChange={(v) => set({ heading_font: v })} options={FONTS.map((f) => ({ value: f, label: f }))} /></Field>
                    <Field label="Weight"><NativeSelect value={d.heading_weight} onChange={(v) => set({ heading_weight: Number(v) })} options={[400, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))} /></Field>
                  </div>
                  <Field label="Caption style"><NativeSelect value={d.caption_preset} onChange={(v) => set({ caption_preset: v })} options={CAPTIONS.map(([value, label]) => ({ value, label }))} /></Field>
                  <div className="rounded-lg border border-line bg-black p-4 text-center" style={{ fontFamily: d.caption_font }}>
                    <span style={{ color: d.caption_color, fontWeight: d.caption_weight, fontSize: 22 }}>YOUR <span style={{ color: d.primary_color }}>BRAND</span> CAPTIONS</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <h4 className="text-2xs font-semibold uppercase tracking-wider text-muted">Logo / watermark</h4>
                  <div className="flex items-center gap-2">
                    <NativeSelect value={d.logo_asset_id} onChange={(v) => { const a = logos?.find((l) => l.id === v); set({ logo_asset_id: v, logo_aspect: a ? (a.meta.width ?? 1) / (a.meta.height ?? 1) : 1 }); }} options={[{ value: "", label: "No logo" }, ...(logos ?? []).map((l) => ({ value: l.id, label: l.name }))]} />
                    <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>Upload</Button>
                    <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" hidden onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                  </div>
                  {d.logo_asset_id && <img src={`/api/assets/${d.logo_asset_id}/file`} alt="Logo" className="h-16 rounded border border-line bg-[#222] object-contain p-1" />}
                  <Field label="Placement"><NativeSelect value={d.logo_position} onChange={(v) => set({ logo_position: v })} options={["top_left", "top_right", "bottom_left", "bottom_right"].map((p) => ({ value: p, label: p.replace("_", " ") }))} /></Field>
                  <Slider label="Logo size" value={d.logo_size} min={0.05} max={0.4} onChange={(v) => set({ logo_size: v })} />
                  <Slider label="Logo opacity" value={d.logo_opacity} min={0.1} max={1} onChange={(v) => set({ logo_opacity: v })} />
                  <h4 className="pt-2 text-2xs font-semibold uppercase tracking-wider text-muted">Audio, transitions & export</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Audio preset"><NativeSelect value={d.audio_preset} onChange={(v) => set({ audio_preset: v })} options={[{ value: "", label: "Keep" }, { value: "natural", label: "Natural" }, { value: "podcast_clean", label: "Podcast Clean" }, { value: "voice_forward", label: "Voice Forward" }, { value: "cinematic", label: "Cinematic" }, { value: "gaming", label: "Gaming" }]} /></Field>
                    <Field label="Loudness"><NativeSelect value={d.loudness_target} onChange={(v) => set({ loudness_target: Number(v) })} options={[-14, -16, -18, -23].map((l) => ({ value: l, label: `${l} LUFS` }))} /></Field>
                    <Field label="Standard transition"><NativeSelect value={d.transition} onChange={(v) => set({ transition: v })} options={["cut", "crossfade", "fade_black", "slide", "zoom", "blur"].map((t) => ({ value: t, label: t.replace("_", " ") }))} /></Field>
                    <Field label="Default export"><NativeSelect value={d.export_preset} onChange={(v) => set({ export_preset: v })} options={[{ value: "social_standard", label: "Social Standard" }, { value: "social_hq", label: "Social High Quality" }, { value: "4k_hq", label: "4K High Quality" }, { value: "archival", label: "Archival Master" }]} /></Field>
                  </div>
                  <p className="text-2xs text-muted">Intro/outro clips can be added to an edit's B-roll track from your uploaded media.</p>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
