"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, Segmented, TextField, TextareaField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/Toast";
import { Banner, CriticalityBadge, EmptyState, ImpactBadge, Mono, Panel } from "@/components/ui/primitives";
import type { BlastRadiusResult } from "@/lib/blast-radius";
import { api, fieldErrors } from "@/lib/client/api";
import { ASSET_PROVIDERS, CRITICALITIES } from "@/lib/domain/enums";
import { formatUtc } from "@/lib/domain/time";
import { ASSET_PROVIDER_LABELS, CRITICALITY_LABELS, textOf } from "@/lib/ui/labels";
import { DependencyExplorer, type AssetLite, type DependencyLite, type EvidenceLite } from "./DependencyExplorer";

interface AssetRow extends AssetLite {
  dependsOnCount: number;
  consumerCount: number;
  updatedAt: string;
}

export function AssetsWorkspace({
  assets,
  dependencies,
  incidents,
  overlay,
  overlayEvidence,
  canEdit,
}: {
  assets: AssetRow[];
  dependencies: DependencyLite[];
  incidents: { id: string; caseNumber: string; title: string }[];
  overlay: { incidentId: string; caseNumber: string; result: BlastRadiusResult; asOf: string | null } | null;
  overlayEvidence: EvidenceLite[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [mode, setMode] = useState<"graph" | "inventory">(params.get("mode") === "inventory" ? "inventory" : "graph");
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState("");
  const [criticality, setCriticality] = useState("");
  const [assetDialog, setAssetDialog] = useState<AssetLite | "new" | null>(null);
  const [depOpen, setDepOpen] = useState(false);

  const filtered = useMemo(
    () =>
      assets.filter(
        (a) => (!q || a.name.toLowerCase().includes(q.toLowerCase())) && (!provider || a.provider === provider) && (!criticality || a.criticality === criticality),
      ),
    [assets, q, provider, criticality],
  );
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div className="-mt-3 flex flex-wrap justify-end gap-2" id="asset-actions">
          <Button variant="primary" icon={<Plus />} onClick={() => setAssetDialog("new")}>
            Add asset
          </Button>
          <Button icon={<Plus />} onClick={() => setDepOpen(true)} disabled={assets.length < 2}>
            Add dependency
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3 rounded-[6px] border border-line bg-surface p-4">
        <Segmented
          label="Asset view"
          value={mode}
          onChange={(v) => {
            setMode(v);
            setParam("mode", v === "inventory" ? "inventory" : null);
          }}
          options={[
            { value: "graph", label: "Graph" },
            { value: "inventory", label: "Inventory" },
          ]}
        />
        <div className="min-w-[180px] flex-1">
          <label htmlFor="asset-q" className="ct-field-label">
            Name
          </label>
          <input id="asset-q" type="search" className="ct-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets" />
        </div>
        <div>
          <label htmlFor="asset-provider" className="ct-field-label">
            Provider
          </label>
          <select id="asset-provider" className="ct-field min-w-[150px]" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">All providers</option>
            {ASSET_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {ASSET_PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="asset-crit" className="ct-field-label">
            Criticality
          </label>
          <select id="asset-crit" className="ct-field min-w-[140px]" value={criticality} onChange={(e) => setCriticality(e.target.value)}>
            <option value="">All</option>
            {CRITICALITIES.map((c) => (
              <option key={c} value={c}>
                {CRITICALITY_LABELS[c].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="asset-overlay" className="ct-field-label">
            Incident overlay
          </label>
          <select id="asset-overlay" className="ct-field min-w-[220px]" value={overlay?.incidentId ?? ""} onChange={(e) => setParam("incident", e.target.value || null)}>
            <option value="">No overlay</option>
            {incidents.map((i) => (
              <option key={i.id} value={i.id}>
                {i.caseNumber} · {i.title.slice(0, 48)}
              </option>
            ))}
          </select>
        </div>
        {(q || provider || criticality) && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setProvider(""); setCriticality(""); }}>
            Reset view
          </Button>
        )}
      </div>
      {overlay && (
        <Banner>
          Overlay: {overlay.caseNumber}, incident impact {overlay.asOf ? `as of ${formatUtc(overlay.asOf)}` : "(no failure observations recorded — states remain Unknown)"}. Measured
          observations are distinguished from derived at-risk states.
        </Banner>
      )}

      {mode === "graph" ? (
        <DependencyExplorer
          assets={filtered}
          dependencies={dependencies}
          impact={overlay ? { result: overlay.result, asOf: overlay.asOf } : null}
          incident={overlay ? { id: overlay.incidentId, caseNumber: overlay.caseNumber } : null}
          evidence={overlayEvidence}
          canEdit={canEdit}
          mode="inventory"
          initialSelected={params.get("asset")}
          onEditAsset={(a) => setAssetDialog(a)}
        />
      ) : (
        <Panel flush title="Inventory" description={`${filtered.length} of ${assets.length} assets`}>
          {assets.length === 0 ? (
            <EmptyState title="No assets mapped yet.">{canEdit ? "Add an asset to start mapping dependencies." : undefined}</EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState title="No results match these filters." />
          ) : (
            <div className="ct-table-wrap">
              <table className="ct-table">
                <caption className="ct-sr-only">Asset inventory</caption>
                <thead>
                  <tr>
                    <th scope="col">Asset name</th>
                    <th scope="col">Provider</th>
                    <th scope="col">Category</th>
                    <th scope="col">Criticality</th>
                    <th scope="col">Owner</th>
                    <th scope="col" data-numeric="true">
                      Dependencies
                    </th>
                    {overlay && <th scope="col">Impact ({overlay.caseNumber})</th>}
                    <th scope="col">Last updated (UTC)</th>
                    {canEdit && (
                      <th scope="col">
                        <span className="ct-sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const impact = overlay?.result.impacts[a.id];
                    return (
                      <tr key={a.id}>
                        <td className="font-medium">
                          <button type="button" className="ct-link-btn text-left" onClick={() => { setMode("graph"); setParam("asset", a.id); }}>
                            {a.name}
                          </button>
                        </td>
                        <td className="text-fg-2">{textOf(ASSET_PROVIDER_LABELS, a.provider)}</td>
                        <td className="text-fg-2">{a.assetType}</td>
                        <td>
                          <CriticalityBadge value={a.criticality} />
                        </td>
                        <td className="text-fg-2">{a.owner ?? "—"}</td>
                        <td data-numeric="true" title={`${a.dependsOnCount} upstream, ${a.consumerCount} downstream`}>
                          {a.dependsOnCount} ↑ · {a.consumerCount} ↓
                        </td>
                        {overlay && <td>{impact ? <ImpactBadge state={impact.state} providerReported={impact.providerReported} /> : null}</td>}
                        <td>
                          <Mono className="whitespace-nowrap text-[12px] text-fg-2">{formatUtc(a.updatedAt)}</Mono>
                        </td>
                        {canEdit && (
                          <td>
                            <Button size="sm" variant="ghost" onClick={() => setAssetDialog(a)}>
                              Edit
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {canEdit && <AssetDialog target={assetDialog} onClose={() => setAssetDialog(null)} />}
      {canEdit && <DependencyDialog open={depOpen} onClose={() => setDepOpen(false)} assets={assets} dependencies={dependencies} />}
    </div>
  );
}

function AssetDialog({ target, onClose }: { target: AssetLite | "new" | null; onClose: () => void }) {
  const router = useRouter();
  const notify = useToast();
  const existing = target && target !== "new" ? target : null;
  const initial = existing
    ? { name: existing.name, provider: existing.provider, assetType: existing.assetType, owner: existing.owner ?? "", criticality: existing.criticality, description: existing.description ?? "" }
    : { name: "", provider: "INTERNAL", assetType: "", owner: "", criticality: "MEDIUM", description: "" };
  const [form, setForm] = useState(initial);
  const [lastTarget, setLastTarget] = useState(target);
  if (target !== lastTarget) {
    setLastTarget(target);
    setForm(initial);
  }
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (form.name.trim().length < 2) local.name = "Name must be at least 2 characters.";
    if (form.assetType.trim().length < 2) local.assetType = "Type must be at least 2 characters.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    const body = { ...form, owner: form.owner || null, description: form.description || null };
    const res = existing ? await api(`/api/assets/${existing.id}`, { method: "PATCH", body }) : await api("/api/assets", { body });
    setBusy(false);
    if (!res.ok) return setErrors({ ...fieldErrors(res.error), _: res.error.message });
    notify(existing ? "Changes saved." : "Asset added.");
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      dirty={!busy && JSON.stringify(form) !== JSON.stringify(initial)}
      title={existing ? `Edit ${existing.name}` : "Add asset"}
      description="Services, providers and business workflows that incidents can affect."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="asset-form" loading={busy}>
            {existing ? "Save changes" : "Add asset"}
          </Button>
        </>
      }
    >
      <form id="asset-form" className="grid gap-4 sm:grid-cols-2" onSubmit={save} noValidate>
        {errors._ && (
          <div className="sm:col-span-2">
            <Banner tone="danger">{errors._}</Banner>
          </div>
        )}
        <TextField className="sm:col-span-2" label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} maxLength={120} />
        <SelectField label="Provider" required value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} options={ASSET_PROVIDERS.map((p) => ({ value: p, label: ASSET_PROVIDER_LABELS[p] }))} />
        <TextField label="Type" required value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })} error={errors.assetType} placeholder="e.g. Web application" />
        <TextField label="Owner" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} error={errors.owner} />
        <SelectField label="Criticality" required value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })} options={CRITICALITIES.map((c) => ({ value: c, label: CRITICALITY_LABELS[c].label }))} />
        <TextareaField className="sm:col-span-2" label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={errors.description} />
      </form>
    </Dialog>
  );
}

function DependencyDialog({ open, onClose, assets, dependencies }: { open: boolean; onClose: () => void; assets: AssetLite[]; dependencies: DependencyLite[] }) {
  const router = useRouter();
  const notify = useToast();
  const [consumer, setConsumer] = useState("");
  const [provider, setProvider] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const name = (id: string) => assets.find((a) => a.id === id)?.name;

  // Client-side cycle preview (the server re-checks): is consumer reachable from provider?
  const createsCycle = useMemo(() => {
    if (!consumer || !provider || consumer === provider) return false;
    const forward = new Map<string, string[]>();
    for (const d of dependencies) forward.set(d.consumerAssetId, [...(forward.get(d.consumerAssetId) ?? []), d.providerAssetId]);
    const seen = new Set([provider]);
    const queue = [provider];
    for (let i = 0; i < queue.length; i++) {
      for (const next of forward.get(queue[i]) ?? []) {
        if (next === consumer) return true;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  }, [consumer, provider, dependencies]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!consumer) local.consumerAssetId = "Choose the consumer asset.";
    if (!provider) local.providerAssetId = "Choose the provider asset.";
    if (consumer && consumer === provider) local.providerAssetId = "An asset cannot depend on itself.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    const res = await api<{ createsCycle: boolean }>("/api/dependencies", { body: { consumerAssetId: consumer, providerAssetId: provider, description: description || null } });
    setBusy(false);
    if (!res.ok) return setErrors({ ...fieldErrors(res.error), _: res.error.message });
    notify(res.data.createsCycle ? "Dependency saved. Note: it creates a dependency cycle." : "Dependency saved.", res.data.createsCycle ? "warning" : "success");
    setConsumer("");
    setProvider("");
    setDescription("");
    onClose();
    router.refresh();
  }

  const options = assets.map((a) => ({ value: a.id, label: a.name }));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dirty={!busy && !!(consumer || provider)}
      title="Add dependency"
      description="Relationship: consumer DEPENDS_ON provider."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="dep-form" loading={busy}>
            Save dependency
          </Button>
        </>
      }
    >
      <form id="dep-form" className="flex flex-col gap-4" onSubmit={save} noValidate>
        {errors._ && <Banner tone="danger">{errors._}</Banner>}
        <SelectField label="Consumer asset (depends on…)" required value={consumer} onChange={(e) => setConsumer(e.target.value)} options={options} placeholder="Select consumer" error={errors.consumerAssetId} />
        <SelectField label="Provider asset" required value={provider} onChange={(e) => setProvider(e.target.value)} options={options} placeholder="Select provider" error={errors.providerAssetId} />
        {consumer && provider && consumer !== provider && (
          <div className="rounded-[6px] border border-line bg-raised p-3 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{name(provider)}</strong>
              <ArrowRight size={14} aria-hidden="true" />
              <strong>{name(consumer)}</strong>
            </div>
            <p className="ct-support mt-1">
              {name(consumer)} depends on {name(provider)}. If {name(provider)} is degraded, {name(consumer)} becomes at risk (not confirmed down).
            </p>
          </div>
        )}
        {createsCycle && <Banner tone="warning">This dependency creates a cycle. It is allowed, but traversal is bounded and a cycle warning will be shown.</Banner>}
        <TextareaField label="Reason / notes" value={description} onChange={(e) => setDescription(e.target.value)} />
      </form>
    </Dialog>
  );
}
