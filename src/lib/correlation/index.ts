/**
 * Deterministic event correlation. Groupings are surfaced as "related events",
 * never as causation.
 */

export interface CorrelatableEvent {
  id: string;
  occurredAt: Date;
  assetId: string | null;
  sourceEventId: string | null;
}

export type RelationReason = "SAME_ASSET_WINDOW" | "SAME_SOURCE_EVENT_ID";

export interface Relation {
  eventId: string;
  reason: RelationReason;
}

export const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

/** Chronological order by occurrence time with a stable tie-break on id. */
export function sortChronologically<T extends { id: string; occurredAt: Date }>(events: T[], direction: "asc" | "desc" = "asc"): T[] {
  const sorted = [...events].sort((a, b) => {
    const t = a.occurredAt.getTime() - b.occurredAt.getTime();
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
  return direction === "asc" ? sorted : sorted.reverse();
}

export function correlateEvents(events: CorrelatableEvent[], windowMs = DEFAULT_WINDOW_MS): Map<string, Relation[]> {
  const related = new Map<string, Relation[]>();
  const add = (a: string, b: string, reason: RelationReason) => {
    const list = related.get(a) ?? [];
    if (!list.some((r) => r.eventId === b && r.reason === reason)) list.push({ eventId: b, reason });
    related.set(a, list);
  };

  const sorted = sortChronologically(events);
  // Same asset within ±window: sliding comparison over the sorted list.
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (!a.assetId) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.occurredAt.getTime() - a.occurredAt.getTime() > windowMs) break;
      if (b.assetId === a.assetId) {
        add(a.id, b.id, "SAME_ASSET_WINDOW");
        add(b.id, a.id, "SAME_ASSET_WINDOW");
      }
    }
  }
  // Same upstream source event id.
  const bySource = new Map<string, string[]>();
  for (const e of events) {
    if (!e.sourceEventId) continue;
    const list = bySource.get(e.sourceEventId) ?? [];
    list.push(e.id);
    bySource.set(e.sourceEventId, list);
  }
  for (const ids of bySource.values()) {
    for (const a of ids) for (const b of ids) if (a !== b) add(a, b, "SAME_SOURCE_EVENT_ID");
  }
  return related;
}

export const RELATION_LABELS: Record<RelationReason, string> = {
  SAME_ASSET_WINDOW: "Same asset within ±15 min",
  SAME_SOURCE_EVENT_ID: "Same source event ID",
};
