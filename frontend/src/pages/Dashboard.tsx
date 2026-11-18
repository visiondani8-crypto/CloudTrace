import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Clapperboard, Film, FolderOpen, HardDrive, Plus, Sparkles, Timer, Upload, Wand2 } from "lucide-react";
import { get } from "@/lib/api";
import type { Project } from "@/lib/types";
import { ago, bytes, dur } from "@/lib/format";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { JobRow } from "@/components/layout/JobsPanel";

interface DashboardData {
  projects: number;
  sources: number;
  highlights: number;
  edits: number;
  renders: number;
  rendered_seconds: number;
  analysed_seconds: number;
  avg_analysis_s: number | null;
  recent_renders: { id: string; name: string; duration: number; width: number; height: number; finished_at: string; project_id: string; file_url: string }[];
  active_jobs: any[];
  storage: { data_dir: string; projects_bytes: number; cache_bytes: number; exports_bytes: number; temp_bytes: number; free_bytes: number };
}

function Stat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-sub">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 font-display text-2xl font-semibold tabular">{value}</div>
      {sub && <div className="mt-0.5 text-2xs text-muted">{sub}</div>}
    </Card>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ["dashboard"], queryFn: () => get<DashboardData>("/dashboard"), refetchInterval: 10000 });
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => get<Project[]>("/projects") });
  if (isLoading) return <div className="p-8"><Spinner /></div>;
  if (error || !data)
    return (
      <div className="p-8">
        <EmptyState title="Backend not reachable" sub="Start ClipForge with ./clipforge.sh (it launches the local backend on 127.0.0.1:8765)." />
      </div>
    );
  const st = data.storage;
  const used = st.projects_bytes + st.cache_bytes + st.exports_bytes + st.temp_bytes;
  return (
    <div className="mx-auto max-w-[1280px] px-8 py-7">
      <PageHeader
        title="Dashboard"
        sub="Turn long-form video into edited short clips — everything runs on this machine."
        actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => nav("/new")}>Import Video</Button>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={FolderOpen} label="Projects" value={data.projects} sub={`${data.sources} source video(s)`} />
        <Stat icon={Timer} label="Footage analysed" value={dur(data.analysed_seconds)} sub={data.avg_analysis_s ? `avg ${dur(data.avg_analysis_s)} per analysis` : "no analyses yet"} />
        <Stat icon={Sparkles} label="Highlights found" value={data.highlights} sub={`${data.edits} edit(s) prepared`} />
        <Stat icon={Film} label="Clips rendered" value={data.renders} sub={dur(data.rendered_seconds) + " of video"} />
        <Stat icon={HardDrive} label="Storage used" value={bytes(used)} sub={`${bytes(st.free_bytes)} free on disk`} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent projects" action={<Link to="/library" className="text-xs text-accent hover:underline">View library</Link>} />
          <div className="px-4 pb-4">
            {projects && projects.length === 0 && (
              <EmptyState icon={<Upload className="h-6 w-6" />} title="No projects yet" sub="Import a podcast, interview, lesson or stream to find its best moments." action={<Button variant="primary" onClick={() => nav("/new")}>Import your first video</Button>} />
            )}
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {(projects ?? []).slice(0, 8).map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="group flex gap-3 rounded-lg border border-line bg-bg/40 p-2.5 hover:border-accent/40">
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded-md bg-raised">
                    {p.thumb_url ? <img src={p.thumb_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted"><Film className="h-5 w-5" /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium group-hover:text-accent">{p.name}</div>
                    <div className="mt-0.5 text-2xs text-muted">Updated {ago(p.updated_at)}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone={p.status === "ready" ? "ok" : p.status === "analysing" ? "accent" : "neutral"}>{p.status}</Badge>
                      {!!p.highlight_count && <Badge>{p.highlight_count} highlights</Badge>}
                      {!!p.render_count && <Badge>{p.render_count} renders</Badge>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Processing queue" sub={data.active_jobs.length ? `${data.active_jobs.length} active job(s)` : "Idle"} />
            <div className="space-y-2 px-4 pb-4">
              {data.active_jobs.length === 0 && <p className="text-xs text-muted">No jobs running. Analyses and renders appear here with live progress.</p>}
              {data.active_jobs.slice(0, 4).map((j) => <JobRow key={j.id} job={j} compact />)}
            </div>
          </Card>
          <Card>
            <CardHeader title="Quick start" />
            <div className="grid gap-2 px-4 pb-4">
              <Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => nav("/new")} className="justify-start">Import &amp; analyse a video</Button>
              <Button variant="outline" icon={<Wand2 className="h-4 w-4" />} onClick={() => nav("/new?batch=1")} className="justify-start">Batch: analyse → prepare edits</Button>
              <Button variant="outline" icon={<Clapperboard className="h-4 w-4" />} onClick={() => nav("/export")} className="justify-start">Open Export Centre</Button>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title="Completed clips" sub="Latest validated renders" action={<Link to="/export" className="text-xs text-accent hover:underline">Export Centre</Link>} />
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 md:grid-cols-4 xl:grid-cols-8">
          {data.recent_renders.length === 0 && <p className="col-span-full text-xs text-muted">No renders yet.</p>}
          {data.recent_renders.map((r) => (
            <a key={r.id} href={r.file_url} target="_blank" rel="noreferrer" className="group">
              <div className="aspect-[9/16] overflow-hidden rounded-md border border-line bg-black">
                <video src={r.file_url + "#t=0.5"} preload="metadata" muted className="h-full w-full object-contain" />
              </div>
              <div className="mt-1 truncate text-2xs text-sub group-hover:text-fg">{r.name}</div>
              <div className="text-2xs text-muted">{r.width}×{r.height} · {dur(r.duration)}</div>
            </a>
          ))}
        </div>
      </Card>
      <p className="mt-6 text-2xs text-muted">Data folder: {st.data_dir}</p>
    </div>
  );
}
