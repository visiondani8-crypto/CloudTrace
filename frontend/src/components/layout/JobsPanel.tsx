import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDashed, Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { del, get, post } from "@/lib/api";
import type { Job } from "@/lib/types";
import { ago } from "@/lib/format";
import { Badge, Button, Dialog, IconButton, Progress } from "@/components/ui";
import { cn } from "@/lib/cn";

export function statusTone(s: Job["status"]) {
  return s === "completed" ? "ok" : s === "failed" ? "err" : s === "running" ? "accent" : s === "paused" ? "warn" : "neutral";
}

export function JobRow({ job, compact }: { job: Job; compact?: boolean }) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (a: string) => post<Job>(`/jobs/${job.id}/${a}`),
    onSuccess: (j) => {
      qc.setQueryData(["job", j.id], j);
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const stage = job.stages.find((s) => s.name === job.stage);
  const warnings = (job.result?.log ?? []).filter((l) => l.level === "warning");
  return (
    <div className="rounded-lg border border-line bg-bg/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(job.status) as any}>{job.status}</Badge>
            <span className="truncate text-[13px] font-medium">{job.title}</span>
          </div>
          <div className="mt-1 text-2xs text-muted">
            {job.kind} · {ago(job.created_at)}
            {job.attempts > 1 && ` · attempt ${job.attempts}`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {job.status === "running" && <IconButton label="Pause" onClick={() => act.mutate("pause")}><Pause className="h-3.5 w-3.5" /></IconButton>}
          {job.status === "paused" && <IconButton label="Resume" onClick={() => act.mutate("resume")}><Play className="h-3.5 w-3.5" /></IconButton>}
          {["queued", "running", "paused"].includes(job.status) && (
            <IconButton label="Cancel" onClick={() => act.mutate("cancel")}><Square className="h-3.5 w-3.5" /></IconButton>
          )}
          {["failed", "cancelled"].includes(job.status) && <IconButton label="Retry" onClick={() => act.mutate("retry")}><RotateCcw className="h-3.5 w-3.5" /></IconButton>}
        </div>
      </div>
      {["running", "paused", "queued"].includes(job.status) && (
        <div className="mt-2.5">
          <div className="mb-1 flex justify-between text-2xs text-sub">
            <span>{stage?.label ?? (job.status === "queued" ? "Waiting for a free worker" : job.stage)}</span>
            <span className="tabular">{Math.round(job.progress * 100)}%</span>
          </div>
          <Progress value={job.progress} tone={job.status === "paused" ? "warn" : "accent"} />
        </div>
      )}
      {!compact && job.stages.length > 0 && job.status !== "completed" && (
        <ol className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
          {job.stages.map((s) => (
            <li key={s.name} className={cn("flex items-center gap-1.5 text-2xs", s.status === "running" ? "text-fg" : s.status === "done" ? "text-sub" : "text-muted")}>
              {s.status === "done" ? <CheckCircle2 className="h-3 w-3 text-ok" /> : <CircleDashed className={cn("h-3 w-3", s.status === "running" && "animate-spin text-accent")} />}
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {job.error && (
        <div className="mt-2 rounded-md border border-err/30 bg-err/10 p-2 text-2xs text-err">
          <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span>{job.error}</span></div>
          {job.error_hint && <div className="mt-1 text-fg/70">{job.error_hint}</div>}
        </div>
      )}
      {warnings.length > 0 && !compact && (
        <ul className="mt-2 space-y-0.5">
          {warnings.slice(-3).map((w, i) => <li key={i} className="text-2xs text-warn">⚠ {w.msg}</li>)}
        </ul>
      )}
    </div>
  );
}

export function JobsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["jobs"], queryFn: () => get<Job[]>("/jobs", { limit: 60 }), enabled: open, refetchInterval: open ? 3000 : false });
  const clear = useMutation({ mutationFn: () => del("/jobs"), onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }) });
  const active = (data ?? []).filter((j) => ["queued", "running", "paused"].includes(j.status));
  const done = (data ?? []).filter((j) => !["queued", "running", "paused"].includes(j.status));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Processing queue" description="Jobs persist across restarts; interrupted work resumes from cached stages." wide>
      <div className="space-y-2">
        {active.length === 0 && <p className="text-xs text-sub">No active jobs.</p>}
        {active.map((j) => <JobRow key={j.id} job={j} />)}
      </div>
      <div className="mt-5 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-sub">History</h4>
        <Button size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => clear.mutate()}>Clear finished</Button>
      </div>
      <div className="mt-2 space-y-2">
        {done.slice(0, 25).map((j) => <JobRow key={j.id} job={j} compact />)}
      </div>
    </Dialog>
  );
}
