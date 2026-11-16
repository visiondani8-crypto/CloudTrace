// Canonical enumerations shared by the database layer, API validation and UI.
// Stored as strings in SQLite; validated with Zod at every write boundary.

export const ROLES = ["OWNER", "ANALYST", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const INCIDENT_TYPES = ["PROVIDER_OUTAGE", "SECURITY_SUSPICION", "CONFIGURATION_FAILURE", "OTHER"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATUSES = ["OPEN", "INVESTIGATING", "MONITORING", "RESOLVED"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const CLASSIFICATIONS = [
  "PROVIDER_TECHNICAL",
  "SECURITY_SUSPECTED",
  "CONFIRMED_SECURITY",
  "CONFIGURATION",
  "UNDETERMINED",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** Classifications an automated analysis may suggest. CONFIRMED_SECURITY is human-only. */
export const SUGGESTIBLE_CLASSIFICATIONS = [
  "PROVIDER_TECHNICAL",
  "SECURITY_SUSPECTED",
  "CONFIGURATION",
  "UNDETERMINED",
] as const;
export type SuggestibleClassification = (typeof SUGGESTIBLE_CLASSIFICATIONS)[number];

export const ASSET_PROVIDERS = ["MICROSOFT_365", "AZURE", "AWS", "GCP", "INTERNAL", "OTHER"] as const;
export type AssetProvider = (typeof ASSET_PROVIDERS)[number];

export const CRITICALITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Criticality = (typeof CRITICALITIES)[number];

export const OBSERVED_STATUSES = ["UNKNOWN", "HEALTHY", "DEGRADED", "DOWN"] as const;
export type ObservedStatus = (typeof OBSERVED_STATUSES)[number];

export const ASSET_ASSERTION_STATUSES = ["HEALTHY", "DEGRADED", "DOWN"] as const;
export type AssetAssertionStatus = (typeof ASSET_ASSERTION_STATUSES)[number];

export const EVIDENCE_CATEGORIES = [
  "PROVIDER_NOTICE",
  "HEALTH_EVENT",
  "AUTH_EVENT",
  "CHANGE_EVENT",
  "APP_LOG",
  "ANALYST_NOTE",
  "OTHER",
] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export const PROVENANCES = ["PUBLIC_REPORTED", "CUSTOMER_OBSERVED", "SYNTHETIC", "ANALYST_NOTE"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const CONFIDENCE_LEVELS = ["CONFIRMED_BY_SOURCE", "CORROBORATED", "UNVERIFIED", "DISPUTED"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const HYPOTHESIS_CONFIDENCES = ["LOW", "MEDIUM", "HIGH"] as const;
export type HypothesisConfidence = (typeof HYPOTHESIS_CONFIDENCES)[number];

export const HYPOTHESIS_STATUSES = ["OPEN", "SUPPORTED", "REJECTED", "UNRESOLVED"] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

export const EVIDENCE_RELATIONS = ["SUPPORTING", "CONTRADICTING"] as const;
export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ANALYSIS_MODES = ["RULE_BASED", "CLAUDE"] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

export const CONNECTION_STATUSES = ["NOT_CONFIGURED", "READY", "SYNCING", "CONNECTED", "ERROR"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const IMPACT_STATES = ["CONFIRMED_AFFECTED", "POTENTIALLY_AFFECTED", "CONFIRMED_HEALTHY", "UNKNOWN"] as const;
export type ImpactState = (typeof IMPACT_STATES)[number];

export const MICROSOFT_PROVIDER = "MICROSOFT_GRAPH_SERVICE_HEALTH" as const;

/**
 * Case status workflow: OPEN → INVESTIGATING → MONITORING → RESOLVED, with
 * re-open to INVESTIGATING. INVESTIGATING may close directly once evidence is
 * reviewed, and MONITORING may fall back to INVESTIGATING.
 */
export const STATUS_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  OPEN: ["INVESTIGATING"],
  INVESTIGATING: ["MONITORING", "RESOLVED"],
  MONITORING: ["INVESTIGATING", "RESOLVED"],
  RESOLVED: ["INVESTIGATING"],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return from === to || STATUS_TRANSITIONS[from].includes(to);
}

export const ROLE_RANK: Record<Role, number> = { VIEWER: 1, ANALYST: 2, OWNER: 3 };

export function hasRole(actual: Role, minimum: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[minimum];
}

export function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function formatEvidenceRef(refNumber: number): string {
  return `EV-${String(refNumber).padStart(4, "0")}`;
}
