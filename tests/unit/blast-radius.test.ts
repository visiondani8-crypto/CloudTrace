import { describe, expect, it } from "vitest";
import { computeBlastRadius, findCycles, peakImpactTime, wouldCreateCycle, type Observation } from "@/lib/blast-radius";

const t = (iso: string) => new Date(iso);
const asset = (id: string) => ({ id, name: id.toUpperCase() });
const dep = (consumer: string, provider: string) => ({ consumerAssetId: consumer, providerAssetId: provider });
const obs = (assetId: string, status: Observation["status"], at: string, provenance: Observation["provenance"] = "CUSTOMER_OBSERVED", evidenceId = `ev-${assetId}-${at}`): Observation => ({
  assetId,
  status,
  observedAt: t(at),
  evidenceId,
  provenance,
});

describe("blast radius — core semantics", () => {
  it("A depends on B: B failing makes A at risk, not confirmed down", () => {
    const r = computeBlastRadius([asset("a"), asset("b")], [dep("a", "b")], [obs("b", "DOWN", "2026-11-12T16:20:00Z")]);
    expect(r.impacts.b.state).toBe("CONFIRMED_AFFECTED");
    expect(r.impacts.a.state).toBe("POTENTIALLY_AFFECTED");
    expect(r.impacts.a.path).toEqual(["b", "a"]);
    expect(r.impacts.a.reason).toMatch(/At risk, not confirmed down/);
  });

  it("separate direct evidence for A makes A confirmed affected", () => {
    const r = computeBlastRadius(
      [asset("a"), asset("b")],
      [dep("a", "b")],
      [obs("b", "DOWN", "2026-11-12T16:20:00Z"), obs("a", "DEGRADED", "2026-11-12T16:30:00Z", "SYNTHETIC")],
    );
    expect(r.impacts.a.state).toBe("CONFIRMED_AFFECTED");
    expect(r.impacts.a.basis).toBe("SYNTHETIC");
    expect(r.impacts.a.origins).toEqual(["b"]);
  });

  it("linear chain propagates transitively with the shortest explanatory path", () => {
    const r = computeBlastRadius(
      [asset("a"), asset("b"), asset("c"), asset("d")],
      [dep("b", "a"), dep("c", "b"), dep("d", "c")],
      [obs("a", "DOWN", "2026-11-12T16:20:00Z")],
    );
    expect(r.impacts.d.state).toBe("POTENTIALLY_AFFECTED");
    expect(r.impacts.d.path).toEqual(["a", "b", "c", "d"]);
    expect(r.counts.POTENTIALLY_AFFECTED).toBe(3);
  });

  it("branches: every consumer of a degraded provider is at risk", () => {
    const r = computeBlastRadius(
      [asset("p"), asset("x"), asset("y"), asset("z")],
      [dep("x", "p"), dep("y", "p"), dep("z", "x")],
      [obs("p", "DEGRADED", "2026-11-12T16:20:00Z")],
    );
    expect(["x", "y", "z"].map((id) => r.impacts[id].state)).toEqual([
      "POTENTIALLY_AFFECTED",
      "POTENTIALLY_AFFECTED",
      "POTENTIALLY_AFFECTED",
    ]);
  });

  it("an independent service with no dependency path stays unknown", () => {
    const r = computeBlastRadius(
      [asset("exchange"), asset("crm"), asset("portal")],
      [dep("crm", "exchange")],
      [obs("exchange", "DEGRADED", "2026-11-12T16:20:00Z", "PUBLIC_REPORTED")],
    );
    expect(r.impacts.portal.state).toBe("UNKNOWN");
    expect(r.impacts.crm.state).toBe("POTENTIALLY_AFFECTED");
  });

  it("cycles terminate and are reported", () => {
    const assets = [asset("a"), asset("b"), asset("c")];
    const edges = [dep("a", "b"), dep("b", "c"), dep("c", "a")];
    const r = computeBlastRadius(assets, edges, [obs("a", "DOWN", "2026-11-12T16:20:00Z")]);
    expect(r.impacts.b.state).toBe("POTENTIALLY_AFFECTED");
    expect(r.impacts.c.state).toBe("POTENTIALLY_AFFECTED");
    expect(r.impacts.a.state).toBe("CONFIRMED_AFFECTED");
    expect(r.cycles).toEqual([["a", "b", "c"]]);
    expect(findCycles(assets, edges)).toHaveLength(1);
  });

  it("handles a large cyclic graph quickly (no infinite traversal)", () => {
    const n = 2000;
    const assets = Array.from({ length: n }, (_, i) => asset(`n${i}`));
    const edges = assets.map((a, i) => dep(a.id, `n${(i + 1) % n}`));
    edges.push(dep("n5", "n100"), dep("n100", "n5"));
    const started = Date.now();
    const r = computeBlastRadius(assets, edges, [obs("n0", "DOWN", "2026-11-12T16:20:00Z")]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.counts.POTENTIALLY_AFFECTED).toBe(n - 1);
  });

  it("multiple edges between the same pair and multi-source impacts are handled", () => {
    const r = computeBlastRadius(
      [asset("p1"), asset("p2"), asset("c")],
      [dep("c", "p1"), dep("c", "p1"), dep("c", "p2")],
      [obs("p1", "DOWN", "2026-11-12T16:20:00Z"), obs("p2", "DEGRADED", "2026-11-12T16:25:00Z")],
    );
    expect(r.impacts.c.state).toBe("POTENTIALLY_AFFECTED");
    expect(r.impacts.c.origins).toEqual(["p1", "p2"]);
    expect(r.impacts.c.reason).toMatch(/2 affected origins/);
  });

  it("conflicting evidence: newest observation wins, both are preserved and flagged", () => {
    const failureFirst = computeBlastRadius(
      [asset("crm")],
      [],
      [obs("crm", "DEGRADED", "2026-11-12T17:04:00Z", "SYNTHETIC", "e1"), obs("crm", "HEALTHY", "2026-11-12T19:00:00Z", "SYNTHETIC", "e2")],
    );
    expect(failureFirst.impacts.crm.state).toBe("CONFIRMED_HEALTHY");
    expect(failureFirst.impacts.crm.conflict).toBe(true);
    expect(failureFirst.impacts.crm.evidence.map((e) => e.evidenceId)).toEqual(["e2", "e1"]);

    const failureLast = computeBlastRadius(
      [asset("crm")],
      [],
      [obs("crm", "HEALTHY", "2026-11-12T16:00:00Z", "SYNTHETIC", "e1"), obs("crm", "DOWN", "2026-11-12T17:00:00Z", "SYNTHETIC", "e2")],
    );
    expect(failureLast.impacts.crm.state).toBe("CONFIRMED_AFFECTED");
    expect(failureLast.impacts.crm.conflict).toBe(true);
  });

  it("healthy is never inferred from absence of alerts, and stale health is not trusted", () => {
    const r = computeBlastRadius(
      [asset("a"), asset("b")],
      [],
      [obs("a", "HEALTHY", "2026-11-01T00:00:00Z"), obs("b", "DOWN", "2026-11-12T16:00:00Z")],
    );
    expect(r.impacts.a.state).toBe("UNKNOWN");
    expect(r.impacts.a.reason).toMatch(/freshness window/);
  });

  it("provider-reported degradation is flagged; provider restoration does not prove customer health", () => {
    const assets = [asset("exchange"), asset("outlook")];
    const edges = [dep("outlook", "exchange")];
    const observations = [
      obs("exchange", "DEGRADED", "2026-11-12T16:20:00Z", "PUBLIC_REPORTED", "start"),
      obs("exchange", "HEALTHY", "2026-11-13T16:10:00Z", "PUBLIC_REPORTED", "restored"),
    ];
    const peak = computeBlastRadius(assets, edges, observations, { asOf: peakImpactTime(observations) });
    expect(peak.impacts.exchange.providerReported).toBe(true);
    expect(peak.impacts.outlook.state).toBe("POTENTIALLY_AFFECTED");

    const latest = computeBlastRadius(assets, edges, observations);
    expect(latest.impacts.exchange.state).toBe("UNKNOWN");
    expect(latest.impacts.exchange.providerRestoredAt).toBe("2026-11-13T16:10:00.000Z");
    expect(latest.impacts.outlook.state).toBe("UNKNOWN");
  });

  it("asOf excludes later observations", () => {
    const observations = [obs("a", "DOWN", "2026-11-12T16:00:00Z"), obs("a", "HEALTHY", "2026-11-12T18:00:00Z")];
    expect(computeBlastRadius([asset("a")], [], observations, { asOf: t("2026-11-12T17:00:00Z") }).impacts.a.state).toBe(
      "CONFIRMED_AFFECTED",
    );
    expect(computeBlastRadius([asset("a")], [], observations).impacts.a.state).toBe("CONFIRMED_HEALTHY");
  });

  it("ignores self-edges and edges to unknown assets", () => {
    const r = computeBlastRadius([asset("a")], [dep("a", "a"), dep("a", "ghost")], [obs("a", "DOWN", "2026-11-12T16:00:00Z")]);
    expect(r.impacts.a.state).toBe("CONFIRMED_AFFECTED");
    expect(r.cycles).toEqual([]);
  });

  it("wouldCreateCycle detects loops before an edge is saved", () => {
    const edges = [dep("a", "b"), dep("b", "c")];
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "c")).toBe(false);
    expect(wouldCreateCycle(edges, "a", "a")).toBe(true);
  });
});
