"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { AlertTriangle, Maximize2, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { EvidenceChip } from "@/components/evidence/EvidenceInspector";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { SelectField, Segmented } from "@/components/ui/fields";
import { useToast } from "@/components/ui/Toast";
import { Banner, CriticalityBadge, EmptyState, ImpactBadge, Mono, ProvenanceBadge, SectionLabel, Tag } from "@/components/ui/primitives";
import type { AssetImpact, BlastRadiusResult } from "@/lib/blast-radius";
import { api } from "@/lib/client/api";
import { ASSET_ASSERTION_STATUSES } from "@/lib/domain/enums";
import { formatUtc } from "@/lib/domain/time";
import { ASSET_PROVIDER_LABELS, IMPACT_LABELS, OBSERVED_STATUS_LABELS, textOf } from "@/lib/ui/labels";

export interface AssetLite {
  id: string;
  name: string;
  provider: string;
  assetType: string;
  criticality: string;
  owner: string | null;
  description: string | null;
  updatedAt?: string;
}
export interface DependencyLite {
  id: string;
  consumerAssetId: string;
  providerAssetId: string;
  description: string | null;
}
export interface EvidenceLite {
  id: string;
  ref: string;
  title: string;
  provenance: string;
  observedAt: string;
  assetId: string | null;
}

type DisplayState = AssetImpact["state"] | "PROVIDER_REPORTED";

function displayState(impact: AssetImpact | undefined): DisplayState {
  if (!impact) return "UNKNOWN";
  return impact.providerReported ? "PROVIDER_REPORTED" : impact.state;
}

/** Layered left-to-right layout (provider → consumer). Bounded relaxation keeps cycles finite. */
function layout(assets: AssetLite[], deps: DependencyLite[]) {
  const ids = new Set(assets.map((a) => a.id));
  const rank = new Map(assets.map((a) => [a.id, 0]));
  const valid = deps.filter((d) => ids.has(d.consumerAssetId) && ids.has(d.providerAssetId) && d.consumerAssetId !== d.providerAssetId);
  const maxRank = Math.min(assets.length, 12);
  for (let i = 0; i < maxRank; i++) {
    let changed = false;
    for (const d of valid) {
      const next = Math.min((rank.get(d.providerAssetId) ?? 0) + 1, maxRank);
      if (next > (rank.get(d.consumerAssetId) ?? 0)) {
        rank.set(d.consumerAssetId, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const columns = new Map<number, AssetLite[]>();
  for (const a of assets) {
    const r = rank.get(a.id) ?? 0;
    columns.set(r, [...(columns.get(r) ?? []), a]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [r, list] of columns) {
    list.sort((a, b) => a.name.localeCompare(b.name)).forEach((a, i) => pos.set(a.id, { x: r * 250, y: i * 96 }));
  }
  return pos;
}

interface AssetNodeData extends Record<string, unknown> {
  name: string;
  meta: string;
  state: DisplayState;
  selected: boolean;
  synthetic: boolean;
}

const AssetNode = memo(function AssetNode({ data }: NodeProps<Node<AssetNodeData>>) {
  const label =
    data.state === "PROVIDER_REPORTED" ? "Provider reported" : data.state === "UNKNOWN" ? "Unknown" : IMPACT_LABELS[data.state].label;
  return (
    <div className="ct-node" data-state={data.state} data-selected={data.selected} aria-label={`${data.name}: ${label}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ background: "#39485A", border: 0 }} />
      <div className="ct-node-name">{data.name}</div>
      <div className="ct-node-meta">{data.meta}</div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="ct-tag" data-tone={data.state === "CONFIRMED_AFFECTED" ? "danger" : data.state === "POTENTIALLY_AFFECTED" ? "warning" : data.state === "CONFIRMED_HEALTHY" ? "success" : data.state === "PROVIDER_REPORTED" ? "info" : undefined}>
          {label}
        </span>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ background: "#39485A", border: 0 }} />
    </div>
  );
});

const nodeTypes = { asset: AssetNode };

function GraphToolbar({ onReset }: { onReset: () => void }) {
  const flow = useReactFlow();
  return (
    <div className="absolute left-3 top-3 z-10 flex gap-1" role="toolbar" aria-label="Graph controls">
      <Button size="sm" aria-label="Fit view" title="Fit view" icon={<Maximize2 />} onClick={() => flow.fitView({ padding: 0.15 })} />
      <Button size="sm" aria-label="Zoom in" title="Zoom in" icon={<Plus />} onClick={() => flow.zoomIn()} />
      <Button size="sm" aria-label="Zoom out" title="Zoom out" icon={<Minus />} onClick={() => flow.zoomOut()} />
      <Button
        size="sm"
        aria-label="Reset view"
        title="Reset view"
        icon={<RotateCcw />}
        onClick={() => {
          onReset();
          flow.fitView({ padding: 0.15 });
        }}
      />
    </div>
  );
}

function Graph({
  assets,
  deps,
  impacts,
  selectedId,
  onSelect,
}: {
  assets: AssetLite[];
  deps: DependencyLite[];
  impacts: Record<string, AssetImpact> | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const positions = useMemo(() => layout(assets, deps), [assets, deps]);
  const nodes: Node<AssetNodeData>[] = useMemo(
    () =>
      assets.map((a) => ({
        id: a.id,
        type: "asset",
        position: positions.get(a.id) ?? { x: 0, y: 0 },
        data: {
          name: a.name,
          meta: `${textOf(ASSET_PROVIDER_LABELS, a.provider)} · ${a.assetType}`,
          state: impacts ? displayState(impacts[a.id]) : "UNKNOWN",
          selected: selectedId === a.id,
          synthetic: false,
        },
        draggable: false,
        connectable: false,
        ariaLabel: `${a.name}. Press Enter to inspect.`,
      })),
    [assets, positions, impacts, selectedId],
  );
  const ids = useMemo(() => new Set(assets.map((a) => a.id)), [assets]);
  const edges: Edge[] = useMemo(
    () =>
      deps
        .filter((d) => ids.has(d.consumerAssetId) && ids.has(d.providerAssetId))
        .map((d) => {
          const consumer = impacts?.[d.consumerAssetId];
          const onRiskPath = !!consumer?.path && consumer.path.some((id, i) => id === d.providerAssetId && consumer.path![i + 1] === d.consumerAssetId);
          const color = onRiskPath ? "#E4AD68" : "#527CAB";
          return {
            id: d.id,
            source: d.providerAssetId,
            target: d.consumerAssetId,
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
            style: { stroke: color, strokeWidth: onRiskPath ? 2 : 1.25 },
            focusable: false,
            ariaLabel: `${assets.find((a) => a.id === d.consumerAssetId)?.name} depends on ${assets.find((a) => a.id === d.providerAssetId)?.name}`,
          };
        }),
    [deps, ids, impacts, assets],
  );
  const [resetKey, setResetKey] = useState(0);

  return (
    <div className="ct-graph relative" aria-label="Dependency graph. Use the list view for a text alternative.">
      <ReactFlow
        key={resetKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        onNodeClick={(_, node) => onSelect(node.id)}
        onSelectionChange={({ nodes: sel }) => {
          if (sel[0]) onSelect(sel[0].id);
        }}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background color="#1b2533" gap={22} />
        <GraphToolbar onReset={() => setResetKey((k) => k + 1)} />
      </ReactFlow>
    </div>
  );
}

function Legend({ withImpact }: { withImpact: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-[11.5px] text-fg-2">
      <span>
        <strong className="text-fg">Edge semantics:</strong> consumer depends on provider. Arrows point provider → consumer.
      </span>
      {withImpact && (
        <>
          <span className="inline-flex items-center gap-1.5"><span className="ct-tag" data-tone="info">Provider reported</span> public provider notice only</span>
          <span className="inline-flex items-center gap-1.5"><span className="ct-tag" data-tone="danger">Confirmed affected</span> direct evidence</span>
          <span className="inline-flex items-center gap-1.5"><span className="ct-tag" data-tone="warning">At risk</span> dependency path only</span>
          <span className="inline-flex items-center gap-1.5"><span className="ct-tag" data-tone="success">Confirmed healthy</span> fresh positive observation</span>
          <span className="inline-flex items-center gap-1.5"><span className="ct-tag">Unknown</span> no sufficient observations</span>
        </>
      )}
    </div>
  );
}

export function DependencyExplorer({
  assets,
  dependencies,
  impact,
  incident,
  evidence,
  canEdit,
  mode,
  initialSelected,
  onEditAsset,
}: {
  assets: AssetLite[];
  dependencies: DependencyLite[];
  impact: { result: BlastRadiusResult; asOf: string | null } | null;
  incident: { id: string; caseNumber: string } | null;
  evidence: EvidenceLite[];
  canEdit: boolean;
  mode: "incident" | "inventory";
  initialSelected?: string | null;
  onEditAsset?: (asset: AssetLite) => void;
}) {
  const [view, setView] = useState<"graph" | "list">("graph");
  const [onlyImpacted, setOnlyImpacted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected ?? null);

  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setView("list");
  }, []);
  useEffect(() => {
    if (initialSelected) setSelectedId(initialSelected);
  }, [initialSelected]);

  const impacts = impact?.result.impacts ?? null;
  const visibleAssets = useMemo(() => {
    if (!onlyImpacted || !impact) return assets;
    const keep = new Set(impact.result.impactedAssetIds);
    for (const id of impact.result.impactedAssetIds) for (const p of impacts?.[id]?.path ?? []) keep.add(p);
    return assets.filter((a) => keep.has(a.id));
  }, [assets, onlyImpacted, impact, impacts]);
  const names = useMemo(() => new Map(assets.map((a) => [a.id, a.name])), [assets]);
  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const cycles = impact?.result.cycles ?? [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="ct-panel" aria-label="Dependency map">
        <div className="ct-panel-head flex-wrap">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Display mode"
              value={view}
              onChange={setView}
              options={[
                { value: "graph", label: "Graph" },
                { value: "list", label: "List" },
              ]}
            />
            {impact && (
              <label className="flex items-center gap-2 text-[12px] text-fg-2">
                <input type="checkbox" className="ct-checkbox" checked={onlyImpacted} onChange={(e) => setOnlyImpacted(e.target.checked)} />
                Show only impacted
              </label>
            )}
          </div>
          <span className="text-[12px] text-fg-2">
            {visibleAssets.length} assets · {dependencies.length} dependencies
          </span>
        </div>
        {cycles.length > 0 && (
          <div className="border-b border-line p-3">
            <Banner tone="warning" icon={<AlertTriangle size={14} />}>
              Dependency cycle detected: {cycles.map((c) => c.map((id) => names.get(id)).join(" ↔ ")).join("; ")}. Traversal is bounded, so the graph stays usable; review whether the loop is intended.
            </Banner>
          </div>
        )}
        {assets.length === 0 ? (
          <EmptyState title="No assets mapped yet.">{canEdit ? "Add assets and dependencies to build the map." : "Assets added by analysts will appear here."}</EmptyState>
        ) : view === "graph" ? (
          <ReactFlowProvider>
            <Graph assets={visibleAssets} deps={dependencies} impacts={impacts} selectedId={selectedId} onSelect={setSelectedId} />
          </ReactFlowProvider>
        ) : (
          <AssetList assets={visibleAssets} deps={dependencies} impacts={impacts} names={names} selectedId={selectedId} onSelect={setSelectedId} />
        )}
        <Legend withImpact={!!impact} />
      </section>
      <AssetInspector
        asset={selected}
        assets={assets}
        deps={dependencies}
        impact={selected && impacts ? impacts[selected.id] : undefined}
        names={names}
        incident={incident}
        evidence={evidence}
        canEdit={canEdit}
        mode={mode}
        onSelect={setSelectedId}
        onEditAsset={onEditAsset}
      />
    </div>
  );
}

function AssetList({
  assets,
  deps,
  impacts,
  names,
  selectedId,
  onSelect,
}: {
  assets: AssetLite[];
  deps: DependencyLite[];
  impacts: Record<string, AssetImpact> | null;
  names: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="ct-table-wrap">
      <table className="ct-table">
        <caption className="ct-sr-only">Assets with dependencies{impacts ? " and incident impact" : ""}</caption>
        <thead>
          <tr>
            <th scope="col">Asset</th>
            {impacts && <th scope="col">Impact</th>}
            <th scope="col">Provider</th>
            <th scope="col">Criticality</th>
            <th scope="col">Depends on</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => {
            const i = impacts?.[a.id];
            return (
              <tr key={a.id} data-selected={selectedId === a.id}>
                <td>
                  <button type="button" className="ct-link-btn text-left font-medium" onClick={() => onSelect(a.id)} aria-label={`Inspect ${a.name}`}>
                    {a.name}
                  </button>
                  <div className="text-[11.5px] text-fg-2">{a.assetType}</div>
                </td>
                {impacts && (
                  <td className="min-w-[220px]">
                    <ImpactBadge state={i?.state ?? "UNKNOWN"} providerReported={i?.providerReported} />
                    {i?.conflict && <Tag tone="warning" className="ml-1">Conflicting observations</Tag>}
                    {i && i.state !== "UNKNOWN" && <p className="mt-1 text-[11.5px] leading-4 text-fg-2">{i.reason}</p>}
                  </td>
                )}
                <td className="whitespace-nowrap text-fg-2">{textOf(ASSET_PROVIDER_LABELS, a.provider)}</td>
                <td>
                  <CriticalityBadge value={a.criticality} />
                </td>
                <td className="text-[12.5px] text-fg-2">
                  {deps
                    .filter((d) => d.consumerAssetId === a.id)
                    .map((d) => names.get(d.providerAssetId))
                    .join(", ") || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="ct-scroll-hint md:hidden">Scroll horizontally to view provider, criticality and dependencies.</p>
    </div>
  );
}

function AssetInspector({
  asset,
  assets,
  deps,
  impact,
  names,
  incident,
  evidence,
  canEdit,
  mode,
  onSelect,
  onEditAsset,
}: {
  asset: AssetLite | null;
  assets: AssetLite[];
  deps: DependencyLite[];
  impact: AssetImpact | undefined;
  names: Map<string, string>;
  incident: { id: string; caseNumber: string } | null;
  evidence: EvidenceLite[];
  canEdit: boolean;
  mode: "incident" | "inventory";
  onSelect: (id: string) => void;
  onEditAsset?: (asset: AssetLite) => void;
}) {
  const router = useRouter();
  const notify = useToast();
  const [status, setStatus] = useState("");
  const [statusEvidence, setStatusEvidence] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | undefined>();
  const [removing, setRemoving] = useState<DependencyLite | null>(null);
  const [busyRemove, setBusyRemove] = useState(false);

  useEffect(() => {
    setStatus("");
    setStatusEvidence("");
    setStatusError(undefined);
  }, [asset?.id]);

  const evidenceChip = useCallback(
    (id: string, label: string) =>
      mode === "incident" ? (
        <EvidenceChip key={id} id={id} label={label} />
      ) : (
        <Link prefetch={false} key={id} href={`/investigations/${incident?.id}?tab=evidence&evidence=${id}`} className="ct-chip-btn no-underline">
          {label}
        </Link>
      ),
    [mode, incident],
  );

  if (!asset) {
    return (
      <aside className="ct-panel" aria-label="Asset inspector">
        <div className="ct-panel-head">
          <h2 className="ct-panel-title">Asset inspector</h2>
        </div>
        <div className="ct-panel-body">
          <p className="ct-support">Select a node or list row to see its dependencies, impact reasoning and evidence. Graph nodes are keyboard focusable (Tab, then Enter).</p>
        </div>
      </aside>
    );
  }

  const upstream = deps.filter((d) => d.consumerAssetId === asset.id);
  const downstream = deps.filter((d) => d.providerAssetId === asset.id);
  const evRef = new Map(evidence.map((e) => [e.id, e]));
  const assetEvidence = evidence.filter((e) => e.assetId === asset.id);

  async function recordStatus() {
    if (!incident || !asset) return;
    if (!status) return setStatusError("Choose a status.");
    if (status !== "UNKNOWN" && !statusEvidence) return setStatusError("Select the evidence that supports this status.");
    setSaving(true);
    setStatusError(undefined);
    const res = await api(`/api/incidents/${incident.id}/asset-status`, {
      body: { assetId: asset.id, observedStatus: status, statusEvidenceId: status === "UNKNOWN" ? null : statusEvidence },
    });
    setSaving(false);
    if (!res.ok) return setStatusError(res.error.message);
    notify("Observed status recorded and audited.");
    router.refresh();
  }

  return (
    <aside className="ct-panel self-start" aria-label={`Asset inspector: ${asset.name}`}>
      <div className="ct-panel-head">
        <div className="min-w-0">
          <h2 className="ct-panel-title">{asset.name}</h2>
          <p className="ct-support">
            {textOf(ASSET_PROVIDER_LABELS, asset.provider)} · {asset.assetType}
          </p>
        </div>
        {mode === "inventory" && canEdit && onEditAsset && (
          <Button size="sm" onClick={() => onEditAsset(asset)}>
            Edit asset
          </Button>
        )}
      </div>
      <div className="ct-panel-body flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          <CriticalityBadge value={asset.criticality} />
          {impact && <ImpactBadge state={impact.state} providerReported={impact.providerReported} />}
          {impact?.conflict && <Tag tone="warning">Conflicting observations</Tag>}
        </div>
        {asset.description && <p className="text-[12.5px] leading-[19px] text-fg-2">{asset.description}</p>}
        {asset.owner && (
          <p className="text-[12.5px]">
            <span className="text-fg-2">Owner:</span> {asset.owner}
          </p>
        )}

        {impact && (
          <div>
            <SectionLabel>{incident ? `Impact in ${incident.caseNumber}` : "Impact"}</SectionLabel>
            <p className="text-[12.5px] leading-[19px]">{impact.reason}</p>
            {impact.path && impact.path.length > 1 && (
              <ol className="mt-2 flex flex-wrap items-center gap-1 text-[12px]" aria-label="Dependency path">
                {impact.path.map((id, i) => (
                  <li key={id} className="inline-flex items-center gap-1">
                    {i > 0 && <span aria-hidden="true" className="text-fg-2">→</span>}
                    <button type="button" className="ct-link-btn" onClick={() => onSelect(id)}>
                      {names.get(id)}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {impact.evidence.length > 0 && (
              <div className="mt-2">
                <p className="mb-1 text-[11.5px] text-fg-2">Evidence used to determine status:</p>
                <ul className="flex flex-col gap-1.5">
                  {impact.evidence.map((r) => (
                    <li key={`${r.evidenceId}-${r.observedAt}`} className="flex flex-wrap items-center gap-1.5 text-[12px]">
                      {evidenceChip(r.evidenceId, evRef.get(r.evidenceId)?.ref ?? "evidence")}
                      <ProvenanceBadge value={r.provenance} />
                      <Tag tone={OBSERVED_STATUS_LABELS[r.status].tone}>{OBSERVED_STATUS_LABELS[r.status].label}</Tag>
                      <Mono className="text-fg-2">{formatUtc(r.observedAt)}</Mono>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {impact.providerRestoredAt && <p className="ct-support mt-2">Provider reported restoration at {formatUtc(impact.providerRestoredAt)}.</p>}
          </div>
        )}

        <div>
          <SectionLabel>Depends on (upstream providers)</SectionLabel>
          {upstream.length === 0 ? (
            <p className="ct-support">No upstream dependencies.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {upstream.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <button type="button" className="ct-link-btn text-left" onClick={() => onSelect(d.providerAssetId)}>
                    {names.get(d.providerAssetId)}
                  </button>
                  {mode === "inventory" && canEdit && (
                    <Button size="sm" variant="ghost" aria-label={`Remove dependency on ${names.get(d.providerAssetId)}`} icon={<Trash2 />} onClick={() => setRemoving(d)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <SectionLabel>Used by (downstream consumers)</SectionLabel>
          {downstream.length === 0 ? (
            <p className="ct-support">No downstream consumers.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {downstream.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <button type="button" className="ct-link-btn text-left" onClick={() => onSelect(d.consumerAssetId)}>
                    {names.get(d.consumerAssetId)}
                  </button>
                  {mode === "inventory" && canEdit && (
                    <Button size="sm" variant="ghost" aria-label={`Remove dependency of ${names.get(d.consumerAssetId)}`} icon={<Trash2 />} onClick={() => setRemoving(d)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {incident && (
          <div>
            <SectionLabel>Incident events for this asset</SectionLabel>
            {assetEvidence.length === 0 ? (
              <p className="ct-support">No evidence in {incident.caseNumber} is linked to this asset.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {assetEvidence.map((e) => (
                  <li key={e.id} className="text-[12px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {evidenceChip(e.id, e.ref)}
                      <Mono className="text-fg-2">{formatUtc(e.observedAt)}</Mono>
                    </div>
                    <div className="mt-0.5">{e.title}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mode === "incident" && incident && canEdit && (
          <div className="rounded-[6px] border border-line bg-raised p-3">
            <SectionLabel>Record observed status</SectionLabel>
            <p className="ct-support mb-3">A recorded status must cite evidence from this incident. It is audited and feeds the blast-radius engine.</p>
            <div className="flex flex-col gap-3">
              <SelectField
                label="Observed status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={[...ASSET_ASSERTION_STATUSES, "UNKNOWN"].map((s) => ({ value: s, label: OBSERVED_STATUS_LABELS[s as keyof typeof OBSERVED_STATUS_LABELS].label }))}
                placeholder="Choose status"
              />
              {status && status !== "UNKNOWN" && (
                <SelectField
                  label="Supporting evidence"
                  value={statusEvidence}
                  onChange={(e) => setStatusEvidence(e.target.value)}
                  options={evidence.map((e) => ({ value: e.id, label: `${e.ref} · ${e.title}` }))}
                  placeholder="Select evidence"
                />
              )}
              {statusError && (
                <p className="ct-field-error" role="alert">
                  {statusError}
                </p>
              )}
              <Button size="sm" variant="primary" loading={saving} onClick={recordStatus}>
                Save status
              </Button>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        title="Remove dependency?"
        confirmLabel="Remove dependency"
        danger
        busy={busyRemove}
        onConfirm={async () => {
          if (!removing) return;
          setBusyRemove(true);
          const res = await api(`/api/dependencies/${removing.id}`, { method: "DELETE" });
          setBusyRemove(false);
          setRemoving(null);
          if (!res.ok) return notify(res.error.message, "danger");
          notify("Dependency removed. Recorded in the audit log.");
          router.refresh();
        }}
      >
        {removing && (
          <>
            <strong>{names.get(removing.consumerAssetId)}</strong> will no longer depend on <strong>{names.get(removing.providerAssetId)}</strong>. Impact
            assessments for every incident will change accordingly. Report snapshots already generated are not altered.
          </>
        )}
      </ConfirmDialog>
      {assets.length === 0 && null}
    </aside>
  );
}
