import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, FileVideo, Film, FolderOpen, Image as ImageIcon, Scissors, Share2, Sparkles, Trash2 } from "lucide-react";
import { del, get, patch } from "@/lib/api";
import { ago, bytes, dur, PLATFORM_LABELS, tc } from "@/lib/format";
import { Badge, Button, Card, Dialog, EmptyState, Input, PageHeader, Segmented, Spinner, Switch, useToast } from "@/components/ui";

type Kind = "all" | "sources" | "projects" | "edits" | "renders" | "highlights" | "social" | "assets";

export default function LibraryPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [archived, setArchived] = useState(false);
  const [confirm, setConfirm] = useState<any>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["library", kind, q, archived], queryFn: () => get<Record<string, any[]>>("/library", { q, kind, include_archived: archived }) });
  const archive = useMutation({
    mutationFn: (p: { id: string; archived: boolean }) => patch(`/projects/${p.id}`, { archived: p.archived }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["library"] }); qc.invalidateQueries({ queryKey: ["projects"] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/projects/${id}?delete_files=${deleteFiles}`),
    onSuccess: () => { setConfirm(null); qc.invalidateQueries({ queryKey: ["library"] }); qc.invalidateQueries({ queryKey: ["projects"] }); toast({ tone: "ok", text: "Project deleted (original videos untouched)" }); },
    onError: (e: any) => toast({ tone: "err", text: e.message }),
  });
  const show = (k: string) => kind === "all" || kind === k;
  const section = (title: string, icon: React.ReactNode, n: number, children: React.ReactNode) => (
    <Card className="mb-4">
      <div className="flex items-center gap-2 px-4 pt-3.5 text-[13px] font-semibold">{icon}{title}<Badge>{n}</Badge></div>
      <div className="p-4 pt-3">{n === 0 ? <p className="text-xs text-muted">Nothing here.</p> : children}</div>
    </Card>
  );
  return (
    <div className="mx-auto max-w-[1280px] px-8 py-7">
      <PageHeader title="Media Library" sub="Everything ClipForge knows about: sources, projects, edits, renders, highlights, social copy and brand assets." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="w-72" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Segmented value={kind} onChange={setKind} options={(["all", "sources", "projects", "edits", "renders", "highlights", "social", "assets"] as Kind[]).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))} />
        <Switch checked={archived} onChange={setArchived} label="Show archived" />
      </div>
      {isLoading && <Spinner />}
      {data && (
        <>
          {show("projects") && data.projects && section("Projects", <FolderOpen className="h-4 w-4 text-accent" />, data.projects.length, (
            <div className="divide-y divide-line">
              {data.projects.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2">
                  <Link to={`/projects/${p.id}`} className="flex-1 truncate text-[13px] hover:text-accent">{p.name}</Link>
                  {p.archived && <Badge tone="warn">archived</Badge>}
                  <span className="text-2xs text-muted">{ago(p.updated_at)}</span>
                  <Button size="xs" variant="ghost" icon={p.archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />} onClick={() => archive.mutate({ id: p.id, archived: !p.archived })}>{p.archived ? "Restore" : "Archive"}</Button>
                  <Button size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => setConfirm(p)}>Delete</Button>
                </div>
              ))}
            </div>
          ))}
          {show("sources") && data.sources && section("Source videos", <FileVideo className="h-4 w-4 text-accent" />, data.sources.length, (
            <div className="divide-y divide-line">
              {data.sources.map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-2 text-xs">
                  <span className="flex-1 truncate" title={s.path}>{s.original_name}</span>
                  {s.missing ? <Badge tone="err">missing — relink in project</Badge> : <Badge tone={s.kind === "reference" ? "neutral" : "ok"}>{s.kind === "reference" ? "linked" : s.kind}</Badge>}
                  <span className="w-20 text-right text-muted">{s.probe ? tc(s.probe.duration) : ""}</span>
                  <span className="w-20 text-right text-muted">{bytes(s.size_bytes)}</span>
                  <Link to={`/projects/${s.project_id}`} className="text-accent">Open</Link>
                </div>
              ))}
            </div>
          ))}
          {show("highlights") && data.highlights && section("Highlights", <Sparkles className="h-4 w-4 text-accent" />, data.highlights.length, (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              {data.highlights.slice(0, 60).map((h) => (
                <Link key={h.id} to={`/projects/${h.project_id}/highlights`} className="group">
                  <div className="aspect-video overflow-hidden rounded-md bg-raised">{h.thumb_url && <img src={h.thumb_url} alt="" className="h-full w-full object-cover" />}</div>
                  <div className="mt-1 line-clamp-2 text-2xs text-sub group-hover:text-fg">{h.title}</div>
                  <div className="text-2xs text-muted">{h.score.toFixed(0)}/100 · {dur(h.end - h.start)}</div>
                </Link>
              ))}
            </div>
          ))}
          {show("edits") && data.edits && section("Saved edits", <Scissors className="h-4 w-4 text-accent" />, data.edits.length, (
            <div className="divide-y divide-line">
              {data.edits.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2 text-xs">
                  <Link to={`/editor/${e.id}`} className="flex-1 truncate hover:text-accent">{e.name}</Link>
                  <Badge>v{e.version}</Badge>{e.is_current && <Badge tone="ok">current</Badge>}
                  <span className="text-muted">{e.style} · {e.aspect}</span>
                  <span className="w-20 text-right text-muted">{ago(e.updated_at)}</span>
                </div>
              ))}
            </div>
          ))}
          {show("renders") && data.renders && section("Rendered clips", <Film className="h-4 w-4 text-accent" />, data.renders.length, (
            <div className="divide-y divide-line">
              {data.renders.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-2 text-xs">
                  <span className="flex-1 truncate" title={r.output_path}>{r.name}</span>
                  <Badge tone={r.status === "completed" ? "ok" : r.status === "failed" || r.status === "failed_validation" ? "err" : "neutral"}>{r.status}</Badge>
                  <span className="text-muted">{r.width}×{r.height}</span>
                  {r.exists ? <a href={r.file_url} target="_blank" rel="noreferrer" className="text-accent">Play</a> : <span className="text-err">file missing</span>}
                </div>
              ))}
            </div>
          ))}
          {show("social") && data.social && section("Social copy", <Share2 className="h-4 w-4 text-accent" />, data.social.length, (
            <div className="divide-y divide-line">
              {data.social.map((s) => (
                <Link key={s.id} to={`/social?edit=${s.edit_id}`} className="flex items-center gap-3 py-2 text-xs hover:text-accent">
                  <span className="flex-1 truncate">{s.title}</span>
                  <Badge>{PLATFORM_LABELS[s.platform]}</Badge>
                  <span className="text-muted">{ago(s.updated_at)}</span>
                </Link>
              ))}
            </div>
          ))}
          {show("assets") && data.assets && section("Brand assets & media", <ImageIcon className="h-4 w-4 text-accent" />, data.assets.length, (
            <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
              {data.assets.map((a) => (
                <div key={a.id} className="rounded-md border border-line p-2 text-2xs">
                  {["logo", "image"].includes(a.kind) ? <img src={a.url} alt="" className="mb-1 h-16 w-full object-contain" /> : <div className="mb-1 flex h-16 items-center justify-center text-muted">{a.kind}</div>}
                  <div className="truncate">{a.name}</div>
                </div>
              ))}
            </div>
          ))}
          {kind === "all" && Object.values(data).every((x) => !x.length) && <EmptyState title="Your library is empty" sub="Import a video to get started." />}
        </>
      )}
      <Dialog open={!!confirm} onOpenChange={() => setConfirm(null)} title={`Delete “${confirm?.name}”?`} description="Removes the project, its highlights, edits and render records from ClipForge. Linked original videos are never deleted; exported clips stay on disk."
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(confirm.id)}>Delete project</Button></>}>
        <Switch checked={deleteFiles} onChange={setDeleteFiles} label="Also delete ClipForge-managed copies, proxies and analysis files for this project" />
      </Dialog>
    </div>
  );
}
