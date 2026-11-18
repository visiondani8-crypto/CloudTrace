import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FileVideo, Globe, Link2, UploadCloud, X } from "lucide-react";
import { errorMessage, post, uploadFile } from "@/lib/api";
import type { MediaSource, Project } from "@/lib/types";
import { bytes } from "@/lib/format";
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Progress, Switch } from "@/components/ui";
import { cn } from "@/lib/cn";

const ACCEPT = ".mp4,.mov,.mkv,.webm,.avi,.m4v,.mts,.m2ts,.ts,.mxf";

interface UploadItem { file: File; progress: number; status: "pending" | "uploading" | "done" | "error"; error?: string; projectId?: string }

export default function NewProjectPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const fileInput = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [path, setPath] = useState("");
  const [copy, setCopy] = useState(false);
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameFrom = (s: string) => s.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled";

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => /\.(mp4|mov|mkv|webm|avi|m4v|mts|m2ts|ts|mxf)$/i.test(f.name));
    if (!list.length) {
      setErr("No supported video files. Supported: MP4, MOV, MKV, WebM, AVI, M4V, MTS, MXF.");
      return;
    }
    setErr(null);
    const start = items.length;
    setItems((x) => [...x, ...list.map((file) => ({ file, progress: 0, status: "pending" as const }))]);
    let lastProject: string | undefined;
    for (let k = 0; k < list.length; k++) {
      const idx = start + k;
      const f = list[k];
      try {
        const p = await post<Project>("/projects", { name: nameFrom(f.name) });
        setItems((x) => x.map((it, i) => (i === idx ? { ...it, status: "uploading", projectId: p.id } : it)));
        const up = uploadFile<MediaSource>(`/projects/${p.id}/upload?filename=${encodeURIComponent(f.name)}`, f, (pr) =>
          setItems((x) => x.map((it, i) => (i === idx ? { ...it, progress: pr } : it))),
        );
        await up.promise;
        setItems((x) => x.map((it, i) => (i === idx ? { ...it, status: "done", progress: 1 } : it)));
        lastProject = p.id;
      } catch (e) {
        setItems((x) => x.map((it, i) => (i === idx ? { ...it, status: "error", error: errorMessage(e) } : it)));
      }
    }
    qc.invalidateQueries({ queryKey: ["projects"] });
    if (list.length === 1 && lastProject) nav(`/projects/${lastProject}${params.get("batch") ? "?batch=1" : ""}`);
  }

  async function linkPath() {
    setBusy(true);
    setErr(null);
    try {
      const p = await post<Project>("/projects", { name: nameFrom(path.split(/[\\/]/).pop() ?? "Video") });
      await post(`/projects/${p.id}/reference`, { path, copy_file: copy });
      qc.invalidateQueries({ queryKey: ["projects"] });
      nav(`/projects/${p.id}${params.get("batch") ? "?batch=1" : ""}`);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function importUrl() {
    setBusy(true);
    setErr(null);
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      const p = await post<Project>("/projects", { name: `Import from ${host}` });
      await post(`/projects/${p.id}/url`, { url, confirm_rights: rights });
      qc.invalidateQueries({ queryKey: ["projects"] });
      nav(`/projects/${p.id}`);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1080px] px-8 py-7">
      <PageHeader title="Import video" sub="Add one or many long-form videos. Originals are never modified." />
      {err && <div className="mb-4"><Alert tone="err" title="Import problem">{err}</Alert></div>}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
        className={cn("flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors", drag ? "border-accent bg-accent/5" : "border-line bg-surface")}
        data-testid="dropzone"
      >
        <UploadCloud className="h-10 w-10 text-accent" />
        <p className="mt-3 font-display text-lg font-semibold">Drop videos here</p>
        <p className="mt-1 max-w-md text-xs text-sub">MP4, MOV, MKV, WebM, AVI (H.264, HEVC and more). Multiple files create one project each. Files are copied into your ClipForge library.</p>
        <Button className="mt-4" variant="primary" onClick={() => fileInput.current?.click()}>Choose files…</Button>
        <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden data-testid="file-input" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      </div>
      {items.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Uploads" />
          <ul className="space-y-2 px-4 pb-4">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-3 rounded-lg border border-line bg-bg/40 p-2.5">
                <FileVideo className="h-4 w-4 shrink-0 text-sub" />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="truncate">{it.file.name}</span>
                    <span className="shrink-0 text-muted">{bytes(it.file.size)}</span>
                  </div>
                  <Progress className="mt-1.5" value={it.progress} tone={it.status === "error" ? "err" : it.status === "done" ? "ok" : "accent"} />
                  {it.error && <p className="mt-1 text-2xs text-err">{it.error}</p>}
                </div>
                {it.status === "done" && it.projectId && <Button size="xs" onClick={() => nav(`/projects/${it.projectId}`)}>Open</Button>}
                {it.status === "error" && <X className="h-4 w-4 text-err" />}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Link2 className="h-4 w-4 text-accent" />Link a local file</span>} sub="Recommended for large files: no copy is made. Moving the file later will need a Relink." />
          <div className="space-y-3 px-4 pb-4">
            <Field label="File path on this computer">
              <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/Movies/episode-42.mov" data-testid="path-input" />
            </Field>
            <Switch checked={copy} onChange={setCopy} label="Copy into the ClipForge library instead" />
            <Button variant="primary" disabled={!path.trim()} loading={busy} onClick={linkPath} data-testid="link-button">Import file</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Globe className="h-4 w-4 text-accent" />Import from URL</span>} sub="Uses yt-dlp for supported sites. No DRM circumvention, paywall bypassing or login cookies." />
          <div className="space-y-3 px-4 pb-4">
            <Field label="Video URL">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </Field>
            <label className="flex items-start gap-2 text-xs text-sub">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" />
              I own this video or have permission to download and edit it.
            </label>
            <Button variant="primary" disabled={!url.trim() || !rights} loading={busy} onClick={importUrl}>Download &amp; import</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
