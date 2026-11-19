import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, errorMessage, get, post } from "@/lib/api";
import type { TuningMode, TuningStatus } from "@/lib/types";
import { Alert, Badge, Button, Card, CardHeader, Spinner, Switch, useToast } from "@/components/ui";

const FACTOR_LABELS: Record<string, string> = {
  coherence: "Coherence", hook: "Hook", payoff: "Payoff", clarity: "Clarity", visual: "Visual", novelty: "Novelty", platform: "Platform fit",
};

const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);

function WeightBars({ m }: { m: TuningMode }) {
  const learned = m.learned?.weights;
  return (
    <div className="space-y-1" data-testid="tuning-weights">
      {Object.keys(FACTOR_LABELS).map((k) => {
        const d = m.defaults[k] ?? 0;
        const w = learned?.[k] ?? d;
        const delta = w - d;
        return (
          <div key={k} className="grid grid-cols-[96px_1fr_88px] items-center gap-2 text-2xs">
            <span className="text-sub">{FACTOR_LABELS[k]}</span>
            <div className="relative h-1.5 rounded-full bg-raised">
              <div className="absolute inset-y-0 left-0 rounded-full bg-line" style={{ width: `${d * 2}%` }} title={`Default ${d.toFixed(0)}`} />
              {learned && <div className="absolute inset-y-0 left-0 rounded-full bg-accent/80" style={{ width: `${w * 2}%` }} />}
            </div>
            <span className="tabular text-right text-fg">
              {w.toFixed(0)} pts
              {learned && Math.abs(delta) >= 0.5 && <span className={delta > 0 ? "text-ok" : "text-err"}> ({delta > 0 ? "+" : ""}{delta.toFixed(0)})</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ModeCard({ id, m, min }: { id: string; m: TuningMode; min: { total: number; each: number } }) {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => qc.invalidateQueries({ queryKey: ["tuning"] });
  const learn = useMutation({
    mutationFn: () => post<{ result: TuningMode["learned"]; enabled: boolean }>("/tuning/learn", { content_mode: id }),
    onSuccess: (r) => { refresh(); toast({ tone: r.enabled ? "ok" : "warn", text: r.enabled ? "Learned weights are now used for new analyses" : "Learned, but held-out ranking did not improve — not switched on" }); },
    onError: (e) => toast({ tone: "err", text: errorMessage(e) }),
  });
  const toggle = useMutation({ mutationFn: (v: boolean) => post("/tuning/enabled", { content_mode: id, enabled: v }), onSuccess: refresh });
  const reset = useMutation({ mutationFn: () => del(`/tuning/${id}`), onSuccess: () => { refresh(); toast({ tone: "ok", text: "Back to default weights" }); } });
  const r = m.learned;
  const total = m.ratings.good + m.ratings.bad;
  return (
    <Card data-testid={`tuning-${id}`}>
      <CardHeader
        title={<span className="flex items-center gap-2">{m.label}{m.enabled && <Badge tone="accent">Learned weights on</Badge>}</span>}
        sub={`${m.ratings.good} good · ${m.ratings.bad} bad clip ratings`}
        action={
          <Button size="sm" variant={m.can_learn ? "primary" : "outline"} disabled={!m.can_learn} loading={learn.isPending} onClick={() => learn.mutate()}>
            {r ? "Re-learn" : "Learn from my ratings"}
          </Button>
        }
      />
      <div className="space-y-3 px-4 pb-4">
        {!m.can_learn && (
          <p className="text-2xs text-muted">
            Needs {min.total}+ rated clips with at least {min.each} good and {min.each} bad ({total} so far). Rate clips with 👍 / 👎 on the highlights page.
          </p>
        )}
        <WeightBars m={m} />
        {r && (
          <div className="space-y-2">
            <div className="rounded-lg border border-line bg-bg/40 p-2.5 text-2xs text-sub">
              Ranking accuracy on ratings held out from learning ({r.cv_accuracy.held_out} clips, {r.cv_accuracy.folds}-fold):{" "}
              <span className="text-fg">default {pct(r.cv_accuracy.default)}</span> →{" "}
              <span className={r.recommended ? "text-ok" : "text-warn"}>learned {pct(r.cv_accuracy.learned)}</span>.
              {" "}This is how often a clip you liked outranks one you didn't — an estimate from your own ratings, not a promise of views.
            </div>
            {!r.recommended && <Alert tone="warn">The learned weights did not rank held-out clips better than the defaults, so they were not switched on.</Alert>}
            <div className="flex items-center justify-between">
              <Switch checked={m.enabled} onChange={(v) => toggle.mutate(v)} label="Use learned weights for new analyses in this mode" />
              <Button size="sm" variant="ghost" loading={reset.isPending} onClick={() => reset.mutate()}>Reset to defaults</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export function TuningPanel() {
  const { data } = useQuery({ queryKey: ["tuning"], queryFn: () => get<TuningStatus>("/tuning") });
  if (!data) return <Spinner />;
  const min = { total: data.min_ratings, each: data.min_per_class };
  const entries = Object.entries(data.modes).sort(([, a], [, b]) => b.ratings.good + b.ratings.bad - (a.ratings.good + a.ratings.bad));
  return (
    <div className="space-y-3">
      <p className="text-xs text-sub">
        Your 👍 / 👎 ratings teach ClipForge which scoring factors matter to you, per content mode. Weights are adjusted gradually from the
        mode's defaults (every factor keeps at least 2 points) and only switched on when they rank your held-out ratings better. Everything is computed locally.
      </p>
      {entries.map(([id, m]) => <ModeCard key={id} id={id} m={m} min={min} />)}
    </div>
  );
}
