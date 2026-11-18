import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clapperboard, FolderOpen, Gauge, Library, Palette, Plus, Send, Settings, Share2, Zap } from "lucide-react";
import { get } from "@/lib/api";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Button, Progress, Tip } from "@/components/ui";
import { JobsPanel } from "./JobsPanel";
import { useState } from "react";

const NAV = [
  { to: "/", label: "Dashboard", icon: Gauge, end: true },
  { to: "/library", label: "Media Library", icon: Library },
  { to: "/export", label: "Export Centre", icon: Send },
  { to: "/social", label: "Social Packages", icon: Share2 },
  { to: "/brand-kits", label: "Brand Kits", icon: Palette },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ compact }: { compact?: boolean }) {
  const nav = useNavigate();
  const [jobsOpen, setJobsOpen] = useState(false);
  const { data: jobs } = useQuery({ queryKey: ["jobs", "active"], queryFn: () => get<Job[]>("/jobs", { status: "queued,running,paused", limit: 50 }), refetchInterval: 4000 });
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => get<any[]>("/projects") });
  const active = jobs ?? [];
  const running = active.find((j) => j.status === "running");
  if (compact) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-sidebar py-3">
        <button onClick={() => nav("/")} className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent" aria-label="ClipForge home">
          <Zap className="h-4 w-4" />
        </button>
        {NAV.map((n) => (
          <Tip key={n.to} label={n.label} side="right">
            <NavLink to={n.to} end={n.end} className={({ isActive }) => cn("flex h-9 w-9 items-center justify-center rounded-md text-sub hover:bg-raised hover:text-fg", isActive && "bg-raised text-fg")} aria-label={n.label}>
              <n.icon className="h-4 w-4" />
            </NavLink>
          </Tip>
        ))}
        <div className="flex-1" />
        <Tip label={`${active.length} active job(s)`} side="right">
          <button onClick={() => setJobsOpen(true)} className="relative flex h-9 w-9 items-center justify-center rounded-md text-sub hover:bg-raised" aria-label="Processing queue">
            <Clapperboard className="h-4 w-4" />
            {active.length > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" />}
          </button>
        </Tip>
        <JobsPanel open={jobsOpen} onOpenChange={setJobsOpen} />
      </aside>
    );
  }
  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Zap className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-[15px] font-semibold tracking-tight">ClipForge</div>
          <div className="text-2xs text-muted">Studio · private &amp; local</div>
        </div>
      </div>
      <div className="px-3">
        <Button variant="primary" className="w-full" icon={<Plus className="h-4 w-4" />} onClick={() => nav("/new")}>
          Import Video
        </Button>
      </div>
      <nav className="mt-4 flex flex-col gap-0.5 px-2" aria-label="Main">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn("flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-sub transition-colors hover:bg-raised hover:text-fg", isActive && "bg-raised text-fg")
            }
          >
            <n.icon className="h-4 w-4" />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-5 px-4 text-2xs font-semibold uppercase tracking-wider text-muted">Recent projects</div>
      <div className="mt-1.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {(projects ?? []).slice(0, 12).map((p) => (
          <NavLink
            key={p.id}
            to={`/projects/${p.id}`}
            className={({ isActive }) => cn("flex items-center gap-2 truncate rounded-md px-2.5 py-1.5 text-xs text-sub hover:bg-raised hover:text-fg", isActive && "bg-raised text-fg")}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{p.name}</span>
          </NavLink>
        ))}
        {projects && projects.length === 0 && <p className="px-2.5 text-2xs text-muted">No projects yet.</p>}
      </div>
      <button onClick={() => setJobsOpen(true)} className="m-2 rounded-lg border border-line bg-surface p-2.5 text-left hover:border-accent/40" aria-label="Open processing queue">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">Processing queue</span>
          <span className="text-sub">{active.length ? `${active.length} active` : "idle"}</span>
        </div>
        {running ? (
          <div className="mt-2">
            <div className="truncate text-2xs text-sub">{running.title} · {running.stages.find((s) => s.name === running.stage)?.label ?? running.stage}</div>
            <Progress className="mt-1.5" value={running.progress} />
          </div>
        ) : (
          <div className="mt-1 text-2xs text-muted">Nothing running</div>
        )}
      </button>
      <JobsPanel open={jobsOpen} onOpenChange={setJobsOpen} />
    </aside>
  );
}
