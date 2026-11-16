/**
 * Blast-radius engine (pure, deterministic, no I/O).
 *
 * Edge semantics: consumer C DEPENDS_ON provider P. When P is degraded/down,
 * consumers of P are found by traversing *reverse* edges (P → consumers)
 * breadth-first with a visited set, so cycles terminate.
 *
 * Exactly one state per asset:
 *  - CONFIRMED_AFFECTED   direct DOWN/DEGRADED observation linked to evidence.
 *                         When the only evidence is a public provider report the
 *                         asset is flagged `providerReported` (UI: "Provider reported").
 *  - POTENTIALLY_AFFECTED a dependency path reaches a confirmed-affected asset
 *                         and there is no direct observation for this asset.
 *  - CONFIRMED_HEALTHY    the most recent customer/simulated observation is
 *                         HEALTHY and fresh (within `healthyWindowMs` of the
 *                         assessment time). Never inferred from absence of alerts.
 *  - UNKNOWN              no evidence and no upstream degradation path.
 *
 * Conflicts: if both failure and healthy observations exist for one asset, the
 * most recent wins, both evidence references are preserved and `conflict` is set.
 *
 * Assessment point (`asOf`): only observations recorded at or before `asOf`
 * are considered. `null` means "all observations" (latest view).
 */

import type { ImpactState, Provenance } from "@/lib/domain/enums";

export type ObservationStatus = "HEALTHY" | "DEGRADED" | "DOWN";

export interface GraphAsset {
  id: string;
  name: string;
}

export interface GraphEdge {
  id?: string;
  consumerAssetId: string;
  providerAssetId: string;
}

export interface Observation {
  assetId: string;
  status: ObservationStatus;
  observedAt: Date;
  evidenceId: string;
  provenance: Provenance;
}

export interface BlastRadiusOptions {
  asOf?: Date | null;
  /** A HEALTHY observation must be this recent relative to the assessment time. Default 24h. */
  healthyWindowMs?: number;
}

export interface ObservationRef {
  evidenceId: string;
  status: ObservationStatus;
  observedAt: string;
  provenance: Provenance;
}

export interface AssetImpact {
  assetId: string;
  state: ImpactState;
  /** Confirmed affected only on the strength of public provider reports. */
  providerReported: boolean;
  /** Basis provenance of the deciding observation, when one exists. */
  basis: Provenance | null;
  /** Evidence supporting the state (deciding observation first). */
  evidence: ObservationRef[];
  /** For POTENTIALLY_AFFECTED: shortest path origin → … → this asset (asset ids). */
  path: string[] | null;
  /** All confirmed-affected origins whose dependency paths reach this asset. */
  origins: string[];
  conflict: boolean;
  /** Human-readable reasoning, using asset names. */
  reason: string;
  /** Provider-reported restoration noted for an asset (not proof of customer health). */
  providerRestoredAt: string | null;
}

export interface BlastRadiusResult {
  assessedAt: string | null;
  referenceTime: string | null;
  impacts: Record<string, AssetImpact>;
  counts: Record<ImpactState, number> & { providerReported: number };
  cycles: string[][];
  /** Assets on at least one at-risk path, useful for "show only impacted". */
  impactedAssetIds: string[];
}

const FAILURE = new Set<ObservationStatus>(["DOWN", "DEGRADED"]);

export function buildReverseGraph(edges: GraphEdge[], validIds: Set<string>): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const e of edges) {
    if (e.consumerAssetId === e.providerAssetId) continue; // self-edges are ignored defensively
    if (!validIds.has(e.consumerAssetId) || !validIds.has(e.providerAssetId)) continue;
    const list = reverse.get(e.providerAssetId) ?? [];
    if (!list.includes(e.consumerAssetId)) list.push(e.consumerAssetId);
    reverse.set(e.providerAssetId, list);
  }
  for (const list of reverse.values()) list.sort();
  return reverse;
}

/**
 * Detects dependency cycles (strongly connected components with more than one
 * node). Iterative Tarjan — safe for large graphs, never recurses unboundedly.
 */
export function findCycles(assets: GraphAsset[], edges: GraphEdge[]): string[][] {
  const ids = new Set(assets.map((a) => a.id));
  const forward = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.consumerAssetId) || !ids.has(e.providerAssetId) || e.consumerAssetId === e.providerAssetId) continue;
    const list = forward.get(e.consumerAssetId) ?? [];
    list.push(e.providerAssetId);
    forward.set(e.consumerAssetId, list);
  }
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  for (const start of [...ids].sort()) {
    if (indices.has(start)) continue;
    const work: Array<{ node: string; next: number }> = [{ node: start, next: 0 }];
    indices.set(start, index);
    low.set(start, index);
    index++;
    stack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbours = forward.get(frame.node) ?? [];
      if (frame.next < neighbours.length) {
        const w = neighbours[frame.next++];
        if (!indices.has(w)) {
          indices.set(w, index);
          low.set(w, index);
          index++;
          stack.push(w);
          onStack.add(w);
          work.push({ node: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, indices.get(w)!));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1].node;
          low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
        }
        if (low.get(frame.node) === indices.get(frame.node)) {
          const component: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            component.push(w);
          } while (w !== frame.node);
          if (component.length > 1) sccs.push(component.sort());
        }
      }
    }
  }
  return sccs;
}

/** Would adding consumer → provider create a cycle? (Is consumer reachable from provider via DEPENDS_ON?) */
export function wouldCreateCycle(edges: GraphEdge[], consumerId: string, providerId: string): boolean {
  if (consumerId === providerId) return true;
  const forward = new Map<string, string[]>();
  for (const e of edges) {
    const list = forward.get(e.consumerAssetId) ?? [];
    list.push(e.providerAssetId);
    forward.set(e.consumerAssetId, list);
  }
  const visited = new Set<string>([providerId]);
  const queue = [providerId];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of forward.get(node) ?? []) {
      if (next === consumerId) return true;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

function toRef(o: Observation): ObservationRef {
  return { evidenceId: o.evidenceId, status: o.status, observedAt: o.observedAt.toISOString(), provenance: o.provenance };
}

function byTimeThenId(a: Observation, b: Observation): number {
  const t = a.observedAt.getTime() - b.observedAt.getTime();
  return t !== 0 ? t : a.evidenceId.localeCompare(b.evidenceId);
}

export function computeBlastRadius(
  assets: GraphAsset[],
  edges: GraphEdge[],
  observations: Observation[],
  options: BlastRadiusOptions = {},
): BlastRadiusResult {
  const healthyWindowMs = options.healthyWindowMs ?? 24 * 60 * 60 * 1000;
  const asOf = options.asOf ?? null;
  const ids = new Set(assets.map((a) => a.id));
  const names = new Map(assets.map((a) => [a.id, a.name]));
  const nameOf = (id: string) => names.get(id) ?? id;

  const considered = observations
    .filter((o) => ids.has(o.assetId))
    .filter((o) => !asOf || o.observedAt.getTime() <= asOf.getTime())
    .sort(byTimeThenId);

  const referenceTime =
    asOf ?? (considered.length > 0 ? considered[considered.length - 1].observedAt : null);

  const byAsset = new Map<string, Observation[]>();
  for (const o of considered) {
    const list = byAsset.get(o.assetId) ?? [];
    list.push(o);
    byAsset.set(o.assetId, list);
  }

  const impacts: Record<string, AssetImpact> = {};
  const directlyObserved = new Set<string>();

  // 1. Direct observations.
  for (const asset of assets) {
    const obs = byAsset.get(asset.id) ?? [];
    const providerReports = obs.filter((o) => o.provenance === "PUBLIC_REPORTED");
    const customer = obs.filter((o) => o.provenance !== "PUBLIC_REPORTED");
    const latestCustomer = customer[customer.length - 1];
    const latestProvider = providerReports[providerReports.length - 1];
    const customerFailures = customer.filter((o) => FAILURE.has(o.status));
    const customerHealthy = customer.filter((o) => o.status === "HEALTHY");
    const conflict = customerFailures.length > 0 && customerHealthy.length > 0;

    const base: AssetImpact = {
      assetId: asset.id,
      state: "UNKNOWN",
      providerReported: false,
      basis: null,
      evidence: [],
      path: null,
      origins: [],
      conflict,
      reason: "No observations and no upstream degradation path.",
      providerRestoredAt: null,
    };

    if (latestCustomer && FAILURE.has(latestCustomer.status)) {
      // Most recent customer/simulated observation is a failure.
      impacts[asset.id] = {
        ...base,
        state: "CONFIRMED_AFFECTED",
        basis: latestCustomer.provenance,
        evidence: [latestCustomer, ...customer.filter((o) => o !== latestCustomer).reverse()].map(toRef),
        reason: conflict
          ? `Conflicting observations: newest is a ${latestCustomer.status.toLowerCase()} observation; earlier healthy observation retained.`
          : `Direct ${latestCustomer.status.toLowerCase()} observation recorded.`,
      };
      directlyObserved.add(asset.id);
      continue;
    }

    if (latestCustomer && latestCustomer.status === "HEALTHY") {
      const fresh =
        referenceTime === null || referenceTime.getTime() - latestCustomer.observedAt.getTime() <= healthyWindowMs;
      if (fresh) {
        impacts[asset.id] = {
          ...base,
          state: "CONFIRMED_HEALTHY",
          basis: latestCustomer.provenance,
          evidence: [latestCustomer, ...customer.filter((o) => o !== latestCustomer).reverse()].map(toRef),
          reason: conflict
            ? "Conflicting observations: a newer healthy observation supersedes earlier failure evidence (both retained)."
            : "Fresh positive health observation recorded.",
        };
        directlyObserved.add(asset.id);
        continue;
      }
      base.evidence = customer.slice().reverse().map(toRef);
      base.reason = "Latest healthy observation is outside the freshness window; health is not assumed.";
    }

    if (latestProvider && FAILURE.has(latestProvider.status)) {
      // Provider-reported impact on the provider's own service.
      impacts[asset.id] = {
        ...base,
        state: "CONFIRMED_AFFECTED",
        providerReported: true,
        basis: "PUBLIC_REPORTED",
        evidence: [latestProvider, ...providerReports.filter((o) => o !== latestProvider).reverse()].map(toRef),
        reason:
          "Provider-reported service degradation. This does not prove that every customer's dependent workload failed.",
      };
      directlyObserved.add(asset.id);
      continue;
    }

    if (latestProvider && latestProvider.status === "HEALTHY") {
      base.providerRestoredAt = latestProvider.observedAt.toISOString();
      base.evidence = [...base.evidence, ...providerReports.slice().reverse().map(toRef)];
      base.reason =
        "Provider reported restoration. Customer-side health has not been observed, so the state remains unknown.";
    }
    impacts[asset.id] = base;
  }

  // 2. BFS over reverse edges. Each traversal keeps a visited set so cycles
  //    terminate; an index-based queue keeps it O(V + E) per origin.
  const reverse = buildReverseGraph(edges, ids);
  const origins = assets
    .map((a) => a.id)
    .filter((id) => impacts[id].state === "CONFIRMED_AFFECTED")
    .sort();

  // 2a. Which origins reach each asset (multi-source impacts).
  const reachedBy = new Map<string, Set<string>>();
  for (const origin of origins) {
    const visited = new Set<string>([origin]);
    const queue: string[] = [origin];
    for (let head = 0; head < queue.length; head++) {
      for (const consumer of reverse.get(queue[head]) ?? []) {
        if (visited.has(consumer)) continue;
        visited.add(consumer);
        const set = reachedBy.get(consumer) ?? new Set<string>();
        set.add(origin);
        reachedBy.set(consumer, set);
        queue.push(consumer);
      }
    }
  }

  // 2b. Shortest explanatory path from the nearest origin (multi-source BFS with parent pointers).
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const origin of origins) {
    parent.set(origin, null);
    queue.push(origin);
  }
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const consumer of reverse.get(node) ?? []) {
      if (parent.has(consumer)) continue;
      parent.set(consumer, node);
      queue.push(consumer);
    }
  }
  const pathTo = (assetId: string): string[] => {
    const path: string[] = [];
    let cursor: string | null | undefined = assetId;
    while (cursor !== null && cursor !== undefined && path.length <= ids.size) {
      path.push(cursor);
      cursor = parent.get(cursor);
    }
    return path.reverse();
  };

  for (const [assetId, originSet] of reachedBy) {
    const impact = impacts[assetId];
    impact.origins = [...originSet].sort();
    if (directlyObserved.has(assetId)) continue; // direct evidence takes precedence
    const path = pathTo(assetId);
    impact.state = "POTENTIALLY_AFFECTED";
    impact.path = path;
    const viaProvider = impacts[path[0]].providerReported;
    const upstream = path.slice(0, -1).reverse().map(nameOf);
    const shown = upstream.length > 8 ? [...upstream.slice(0, 7), `… ${upstream.length - 7} more`] : upstream;
    impact.reason =
      `At risk, not confirmed down: depends on ${shown.join(" → ")}` +
      (viaProvider ? " (provider-reported degradation)" : "") +
      (impact.origins.length > 1 ? `; reachable from ${impact.origins.length} affected origins` : "") +
      ". No direct failure evidence for this asset.";
  }

  const counts = { CONFIRMED_AFFECTED: 0, POTENTIALLY_AFFECTED: 0, CONFIRMED_HEALTHY: 0, UNKNOWN: 0, providerReported: 0 };
  for (const impact of Object.values(impacts)) {
    counts[impact.state]++;
    if (impact.providerReported) counts.providerReported++;
  }

  const impactedAssetIds = Object.values(impacts)
    .filter((i) => i.state === "CONFIRMED_AFFECTED" || i.state === "POTENTIALLY_AFFECTED" || i.conflict)
    .map((i) => i.assetId)
    .sort();

  return {
    assessedAt: asOf ? asOf.toISOString() : null,
    referenceTime: referenceTime ? referenceTime.toISOString() : null,
    impacts,
    counts,
    cycles: findCycles(assets, edges),
    impactedAssetIds,
  };
}

/** Time of the latest failure observation: the default "incident impact" assessment point. */
export function peakImpactTime(observations: Observation[]): Date | null {
  let peak: Date | null = null;
  for (const o of observations) {
    if (FAILURE.has(o.status) && (!peak || o.observedAt > peak)) peak = o.observedAt;
  }
  return peak;
}
