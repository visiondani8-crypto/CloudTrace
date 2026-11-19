import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { del, errorMessage, get, patch, post, put } from "@/lib/api";
import { MODE_LABELS, PLATFORM_LABELS, STYLE_LABELS } from "@/lib/format";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, NativeSelect, PageHeader, Spinner, Switch, Tab, TabList, TabPanel, Tabs, useToast } from "@/components/ui";
import { TuningPanel } from "./TuningPanel";

export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: st } = useQuery({ queryKey: ["settings"], queryFn: () => get<any>("/settings") });
  const { data: diag, refetch: rediag } = useQuery({ queryKey: ["diagnostics"], queryFn: () => get<any>("/diagnostics") });
  const { data: prov, refetch: reprov } = useQuery({ queryKey: ["providers"], queryFn: () => get<any>("/providers") });
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => get<any>("/dashboard") });
  const [s, setS] = useState<any>(null);
  const [key, setKey] = useState("");
  useEffect(() => { if (st && !s) setS(structuredClone(st)); }, [st, s]);
  const save = useMutation({
    mutationFn: () => patch("/settings", { storage: s.storage, cache: s.cache, transcription: s.transcription, ai: s.ai, defaults: s.defaults, export_defaults: s.export_defaults, performance: s.performance }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); qc.invalidateQueries({ queryKey: ["providers"] }); toast({ tone: "ok", text: "Settings saved" }); },
    onError: (e) => toast({ tone: "err", text: errorMessage(e) }),
  });
  const setKeyM = useMutation({ mutationFn: () => put<any>("/providers/anthropic/key", { api_key: key || null }), onSuccess: (r) => { setKey(""); reprov(); toast({ tone: "ok", text: r.masked ? `Key stored in ${r.stored_in}` : "Key removed" }); } });
  const verify = useMutation({ mutationFn: () => post<any>("/providers/anthropic/verify"), onSuccess: (r) => toast({ tone: r.ok ? "ok" : "err", text: r.ok ? `Key works (${r.model})` : r.error }) });
  const instVoice = useMutation({ mutationFn: () => post<any>("/speaker-model/install"), onSuccess: () => { reprov(); rediag(); toast({ tone: "ok", text: "Neural speaker model installed" }); }, onError: (e) => toast({ tone: "err", text: errorMessage(e) }) });
  const rmVoice = useMutation({ mutationFn: () => del<any>("/speaker-model"), onSuccess: () => { reprov(); rediag(); toast({ tone: "ok", text: "Speaker model removed" }); } });
  const cleanup = useMutation({ mutationFn: (b: any) => post<any>("/maintenance/cleanup", b), onSuccess: (r) => { toast({ tone: "ok", text: `Freed ${r.freed}` }); qc.invalidateQueries({ queryKey: ["dashboard"] }); } });
  if (!s) return <div className="p-8"><Spinner /></div>;
  const up = (sec: string, k: string, v: any) => setS({ ...s, [sec]: { ...s[sec], [k]: v } });
  const fwStatus = prov?.transcription?.["faster-whisper"];
  return (
    <div className="mx-auto max-w-[1100px] px-8 py-7">
      <PageHeader title="Settings" sub={`Data folder: ${s.data_dir}`} actions={<Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>} />
      <Tabs defaultValue="general">
        <TabList className="mb-4">
          {["general", "transcription", "ai", "tuning", "export", "storage", "privacy", "shortcuts", "diagnostics"].map((t) => <Tab key={t} value={t}>{t === "ai" ? "AI providers" : t === "tuning" ? "Personal tuning" : t[0].toUpperCase() + t.slice(1)}</Tab>)}
        </TabList>
        <TabPanel value="general">
          <Card><CardHeader title="Defaults for new projects" />
            <div className="grid grid-cols-2 gap-3 px-4 pb-4 md:grid-cols-3">
              <Field label="Platform"><NativeSelect value={s.defaults.platform} onChange={(v) => up("defaults", "platform", v)} options={Object.entries(PLATFORM_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Content type"><NativeSelect value={s.defaults.content_mode} onChange={(v) => up("defaults", "content_mode", v)} options={Object.entries(MODE_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Analysis mode"><NativeSelect value={s.defaults.analysis_mode} onChange={(v) => up("defaults", "analysis_mode", v)} options={["fast", "balanced", "deep"].map((v) => ({ value: v, label: v }))} /></Field>
              <Field label="Editing style"><NativeSelect value={s.defaults.edit_style} onChange={(v) => up("defaults", "edit_style", v)} options={Object.entries(STYLE_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Caption style"><NativeSelect value={s.defaults.caption_style} onChange={(v) => up("defaults", "caption_style", v)} options={["bold_social", "clean_white", "word_by_word", "karaoke", "cinematic_minimal", "documentary", "creator", "neon", "gaming", "custom_brand"].map((v) => ({ value: v, label: v.replace(/_/g, " ") }))} /></Field>
              <Field label="Aspect ratio"><NativeSelect value={s.defaults.aspect} onChange={(v) => up("defaults", "aspect", v)} options={["9:16", "1:1", "4:5", "16:9"].map((v) => ({ value: v, label: v }))} /></Field>
              <Field label="Max hashtags"><Input type="number" min={0} max={30} value={s.defaults.max_hashtags} onChange={(e) => up("defaults", "max_hashtags", Number(e.target.value))} /></Field>
            </div>
          </Card>
          <Card className="mt-4"><CardHeader title="Performance" sub="Worker counts apply after restarting ClipForge." />
            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
              <Field label="Render workers" hint={`0 = automatic (currently ${diag?.workers?.render ?? "?"})`}><Input type="number" min={0} max={4} value={s.performance.render_workers} onChange={(e) => up("performance", "render_workers", Number(e.target.value))} /></Field>
              <Field label="Hardware">{diag && <p className="text-xs text-sub">{diag.hardware.cpu_count} CPU threads · {diag.hardware.memory_gb} GB RAM · {diag.hardware.apple_silicon ? "Apple Silicon" : diag.hardware.machine}{diag.hardware.videotoolbox ? " · VideoToolbox" : ""}</p>}</Field>
            </div>
          </Card>
        </TabPanel>
        <TabPanel value="transcription">
          <Card><CardHeader title="Speech recognition" sub="Runs locally. Transcripts are cached per file." />
            <div className="space-y-3 px-4 pb-4">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Engine"><NativeSelect value={s.transcription.engine} onChange={(v) => up("transcription", "engine", v)} options={[{ value: "auto", label: "Auto (faster-whisper, fallback pocketsphinx)" }, { value: "faster-whisper", label: "faster-whisper" }, { value: "pocketsphinx", label: "pocketsphinx (English, offline, lower accuracy)" }]} /></Field>
                <Field label="Whisper model" hint="Size name (tiny/base/small/medium/large-v3/turbo) or a local CTranslate2 model folder"><Input value={s.transcription.model} onChange={(e) => up("transcription", "model", e.target.value)} /></Field>
                <Field label="Default language" hint="Blank = auto-detect"><Input value={s.transcription.language ?? ""} onChange={(e) => up("transcription", "language", e.target.value)} placeholder="auto" /></Field>
              </div>
              {fwStatus && <Alert tone={fwStatus.available ? "ok" : "warn"}>{fwStatus.available ? (fwStatus.reason ?? "faster-whisper model ready") : `faster-whisper unavailable: ${fwStatus.reason}`}</Alert>}
              <p className="text-2xs text-muted">Apple Silicon: faster-whisper runs on the CPU (int8). “small” is a good balance; “large-v3” is most accurate but slower.</p>
            </div>
          </Card>
          <Card className="mt-4" data-testid="speaker-model"><CardHeader title="Speaker detection" sub="Who is talking when — used for speaker framing and back-and-forth scoring." />
            <div className="space-y-3 px-4 pb-4">
              <Field label="Method">
                <NativeSelect value={s.transcription.speaker_model ?? "auto"} onChange={(v) => up("transcription", "speaker_model", v)}
                  options={[{ value: "auto", label: "Auto (neural model when installed, else spectral)" }, { value: "spectral", label: "Spectral heuristic only" }]} />
              </Field>
              {prov?.speaker_model?.installed ? (
                <div className="flex items-center justify-between gap-3">
                  <Alert tone="ok">Neural speaker model installed: {prov.speaker_model.source}</Alert>
                  <Button size="sm" variant="ghost" loading={rmVoice.isPending} onClick={() => rmVoice.mutate()}>Remove</Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/40 p-3 text-2xs text-sub">
                  <span>Optional neural model ({prov?.speaker_model?.source ?? "Resemblyzer voice encoder, Apache-2.0"}). Downloads {prov?.speaker_model?.download_mb ?? 15.7} MB once from PyPI; runs locally, no audio is uploaded. Separates voices better than the spectral heuristic, especially across changing mics or noise.</span>
                  <Button size="sm" variant="outline" loading={instVoice.isPending} onClick={() => instVoice.mutate()} data-testid="install-speaker-model">Install</Button>
                </div>
              )}
              <p className="text-2xs text-muted">Changes apply to the next analysis; speaker labels are cached per file and method.</p>
            </div>
          </Card>
        </TabPanel>
        <TabPanel value="ai">
          <Card><CardHeader title="AI providers" sub="Optional. Everything works without a language model." />
            <div className="space-y-4 px-4 pb-4">
              <Field label="Default provider"><NativeSelect value={s.ai.provider} onChange={(v) => up("ai", "provider", v)} options={[{ value: "local", label: "Local deterministic (no LLM)" }, { value: "ollama", label: "Ollama (local LLM)" }, { value: "anthropic", label: "Anthropic Claude (cloud)" }]} /></Field>
              <div className="rounded-lg border border-line p-3">
                <div className="mb-2 flex items-center justify-between text-[13px] font-medium">Ollama {prov?.ollama?.available ? <Badge tone="ok">available</Badge> : <Badge tone="warn">unavailable</Badge>}</div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Server URL"><Input value={s.ai.ollama_url} onChange={(e) => up("ai", "ollama_url", e.target.value)} /></Field>
                  <Field label="Model"><Input value={s.ai.ollama_model} onChange={(e) => up("ai", "ollama_model", e.target.value)} /></Field>
                </div>
                {prov?.ollama?.reason && <p className="mt-2 text-2xs text-warn">{prov.ollama.reason}</p>}
              </div>
              <div className="rounded-lg border border-line p-3">
                <div className="mb-2 flex items-center justify-between text-[13px] font-medium"><span className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" />Anthropic</span>{prov?.anthropic?.available ? <Badge tone="ok">key set</Badge> : <Badge>no key</Badge>}</div>
                <p className="mb-2 text-2xs text-muted">Requires a separately purchased API key — a Claude subscription does not include API access. The key is stored in {st.secrets.storage} and never sent to this web page.</p>
                <div className="flex gap-2">
                  <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={prov?.anthropic?.masked_key ?? "sk-ant-…"} autoComplete="off" />
                  <Button onClick={() => setKeyM.mutate()} disabled={!key}>Save key</Button>
                  <Button variant="ghost" onClick={() => verify.mutate()} loading={verify.isPending} disabled={!prov?.anthropic?.available}>Verify</Button>
                  {prov?.anthropic?.available && <Button variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { setKey(""); put("/providers/anthropic/key", { api_key: null }).then(() => reprov()); }}>Remove</Button>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Model"><Input value={s.ai.anthropic_model} onChange={(e) => up("ai", "anthropic_model", e.target.value)} /></Field>
                  <Field label="Effort"><NativeSelect value={s.ai.anthropic_effort} onChange={(v) => up("ai", "anthropic_effort", v)} options={["low", "medium", "high"].map((v) => ({ value: v, label: v }))} /></Field>
                </div>
                {prov?.usage && <p className="mt-2 text-2xs text-sub">Usage so far: {prov.usage.input_tokens.toLocaleString()} input / {prov.usage.output_tokens.toLocaleString()} output tokens · estimated ${prov.usage.estimated_cost_usd}</p>}
              </div>
            </div>
          </Card>
        </TabPanel>
        <TabPanel value="export">
          <Card><CardHeader title="Export defaults" />
            <div className="grid grid-cols-2 gap-3 px-4 pb-4 md:grid-cols-3">
              <Field label="Preset"><NativeSelect value={s.export_defaults.preset} onChange={(v) => up("export_defaults", "preset", v)} options={[{ value: "social_standard", label: "Social Standard" }, { value: "social_hq", label: "Social High Quality" }, { value: "4k_hq", label: "4K High Quality" }, { value: "archival", label: "Archival Master" }, { value: "custom", label: "Custom" }]} /></Field>
              <Field label="Resolution"><NativeSelect value={s.export_defaults.resolution} onChange={(v) => up("export_defaults", "resolution", v)} options={["720p", "1080p", "1440p", "2160p", "source"].map((v) => ({ value: v, label: v }))} /></Field>
              <Field label="Encoder"><NativeSelect value={s.export_defaults.hardware} onChange={(v) => up("export_defaults", "hardware", v)} options={[{ value: "cpu", label: "CPU" }, { value: "videotoolbox", label: "VideoToolbox" }, { value: "auto", label: "Auto" }]} /></Field>
              <Switch checked={s.export_defaults.burn_captions} onChange={(v) => up("export_defaults", "burn_captions", v)} label="Burn captions" />
              <Switch checked={s.export_defaults.export_srt} onChange={(v) => up("export_defaults", "export_srt", v)} label="Save SRT/VTT" />
            </div>
          </Card>
        </TabPanel>
        <TabPanel value="storage">
          <Card><CardHeader title="Storage" sub="Original videos are never deleted by cleanup." />
            <div className="space-y-3 px-4 pb-4">
              <Field label="Exports folder"><Input value={s.storage.exports_dir} onChange={(e) => up("storage", "exports_dir", e.target.value)} /></Field>
              <p className="text-2xs text-muted">To move the whole library, start ClipForge with CLIPFORGE_DATA_DIR=/path/to/folder.</p>
              {dash && (
                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                  {[["Projects", dash.storage.projects_bytes], ["Analysis cache & proxies", dash.storage.cache_bytes], ["Exports", dash.storage.exports_bytes], ["Temporary", dash.storage.temp_bytes]].map(([l, b]) => (
                    <div key={l as string} className="rounded-lg border border-line p-2.5"><div className="text-sub">{l}</div><div className="mt-1 font-semibold tabular">{((b as number) / 1e6).toFixed(1)} MB</div></div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => cleanup.mutate({ temp: true })}>Clear temporary files</Button>
                <Button onClick={() => cleanup.mutate({ temp: false, proxies: true })}>Remove preview proxies</Button>
                <Button variant="danger" onClick={() => cleanup.mutate({ temp: false, analysis_cache: true })}>Clear analysis cache</Button>
              </div>
              <p className="text-2xs text-muted">Clearing the analysis cache means transcripts and visual analysis are recomputed on the next analysis.</p>
            </div>
          </Card>
        </TabPanel>
        <TabPanel value="tuning">
          <TuningPanel />
        </TabPanel>
        <TabPanel value="privacy">
          <Card><CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-ok" />Privacy</span>} />
            <div className="space-y-3 px-4 pb-4 text-xs text-fg/85">
              <p>• The backend listens on {diag?.network?.bind ?? "127.0.0.1"} only and rejects requests from other sites.</p>
              <p>• No telemetry or analytics are collected — ClipForge has none.</p>
              <p>• Videos, audio and frames never leave this computer.</p>
              <Switch checked={s.ai.cloud_consent} onChange={(v) => up("ai", "cloud_consent", v)} label="Allow sending transcript text of candidate clips to the cloud AI provider (Anthropic)" />
              {s.ai.cloud_consent && <Alert tone="warn">Cloud processing enabled: when you choose Anthropic for an analysis or social copy, transcript text is sent to Anthropic's API.</Alert>}
            </div>
          </Card>
        </TabPanel>
        <TabPanel value="shortcuts">
          <Card><CardHeader title="Editor keyboard shortcuts" />
            <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 px-4 pb-4 text-xs md:grid-cols-2">
              {[["Play / pause", "Space"], ["Previous / next frame", "← / →"], ["Jump 1 second", "Shift + ← / →"], ["Split at playhead", "S"], ["Delete selection", "Delete"], ["Ripple delete", "Shift + Delete"], ["Undo / redo", "⌘Z / ⌘⇧Z"], ["Save", "⌘S"], ["Add marker", "M"], ["Zoom timeline", "= / −, ⌘ + scroll"], ["Start / end", "Home / End"], ["Deselect", "Esc"]].map(([a, k]) => (
                <div key={a} className="flex justify-between border-b border-line/60 py-1"><span className="text-sub">{a}</span><kbd className="rounded bg-raised px-1.5 font-mono text-2xs">{k}</kbd></div>
              ))}
            </div>
          </Card>
        </TabPanel>
        <TabPanel value="diagnostics">
          <Card><CardHeader title="Dependencies & diagnostics" action={<Button size="sm" onClick={() => rediag()}>Re-check</Button>} />
            <div className="space-y-2 px-4 pb-4">
              {(diag?.dependencies ?? []).map((d: any) => (
                <div key={d.name} className="flex items-start gap-2 text-xs">
                  {d.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-ok" /> : <XCircle className={d.required ? "mt-0.5 h-4 w-4 text-err" : "mt-0.5 h-4 w-4 text-warn"} />}
                  <div><span className="font-medium">{d.name}</span> <span className="text-sub">— {d.detail}</span>{d.fix && <div className="text-2xs text-warn">{d.fix}</div>}</div>
                </div>
              ))}
              {diag && (
                <div className="mt-3 rounded-lg border border-line bg-bg/40 p-3 font-mono text-2xs text-sub">
                  <div>python {diag.python} · schema v{diag.database.schema_version} · free disk {diag.free_disk}</div>
                  <div>workers {JSON.stringify(diag.workers)} · failed jobs {diag.failed_jobs}</div>
                  <div>database {diag.database.path}</div>
                  <div>log {diag.log_file}</div>
                  {diag.missing_sources.length > 0 && <div className="text-warn">missing sources: {diag.missing_sources.join(", ")}</div>}
                </div>
              )}
            </div>
          </Card>
        </TabPanel>
      </Tabs>
    </div>
  );
}
