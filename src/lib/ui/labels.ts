// Text labels and badge tones for every enumerated value. Statuses always carry
// text; colour is never the only signal.

import type {
  AnalysisMode,
  AssetProvider,
  Classification,
  ConfidenceLevel,
  ConnectionStatus,
  Criticality,
  EvidenceCategory,
  HypothesisConfidence,
  HypothesisStatus,
  ImpactState,
  IncidentStatus,
  IncidentType,
  ObservedStatus,
  Provenance,
  Role,
  Severity,
  TaskPriority,
  TaskStatus,
} from "@/lib/domain/enums";

export type Tone = "neutral" | "info" | "warning" | "danger" | "success";

export interface Label {
  label: string;
  tone: Tone;
}

export const SEVERITY_LABELS: Record<Severity, Label> = {
  CRITICAL: { label: "SEV 1 · Critical", tone: "danger" },
  HIGH: { label: "SEV 2 · High", tone: "warning" },
  MEDIUM: { label: "SEV 3 · Medium", tone: "info" },
  LOW: { label: "SEV 4 · Low", tone: "neutral" },
};

export const STATUS_LABELS: Record<IncidentStatus, Label> = {
  OPEN: { label: "Open", tone: "info" },
  INVESTIGATING: { label: "Investigating", tone: "info" },
  MONITORING: { label: "Monitoring", tone: "warning" },
  RESOLVED: { label: "Resolved", tone: "success" },
};

export const TYPE_LABELS: Record<IncidentType, string> = {
  PROVIDER_OUTAGE: "Provider outage",
  SECURITY_SUSPICION: "Security suspicion",
  CONFIGURATION_FAILURE: "Configuration failure",
  OTHER: "Other",
};

export const TYPE_EYEBROW: Record<IncidentType, string> = {
  PROVIDER_OUTAGE: "Incident / provider outage",
  SECURITY_SUSPICION: "Incident / security suspicion",
  CONFIGURATION_FAILURE: "Incident / configuration failure",
  OTHER: "Incident",
};

export const CLASSIFICATION_LABELS: Record<Classification, Label> = {
  PROVIDER_TECHNICAL: { label: "Provider technical disruption", tone: "info" },
  SECURITY_SUSPECTED: { label: "Security suspected — not confirmed", tone: "warning" },
  CONFIRMED_SECURITY: { label: "Confirmed security incident", tone: "danger" },
  CONFIGURATION: { label: "Configuration / change related", tone: "info" },
  UNDETERMINED: { label: "Undetermined", tone: "neutral" },
};

export const PROVENANCE_LABELS: Record<Provenance, Label & { description: string }> = {
  PUBLIC_REPORTED: {
    label: "PUBLIC REPORT",
    tone: "info",
    description: "Publicly reported by the provider. Not independently verified from internal provider telemetry.",
  },
  CUSTOMER_OBSERVED: {
    label: "CUSTOMER OBSERVED",
    tone: "success",
    description: "Observed in the organisation's own authorised systems.",
  },
  SYNTHETIC: {
    label: "SIMULATED",
    tone: "warning",
    description: "Simulated company events. Not observed Microsoft tenant activity.",
  },
  ANALYST_NOTE: {
    label: "ANALYST NOTE",
    tone: "neutral",
    description: "Authored by an analyst; not direct provider or system evidence.",
  },
};

export const CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  PROVIDER_NOTICE: "Provider notice",
  HEALTH_EVENT: "Health event",
  AUTH_EVENT: "Authentication event",
  CHANGE_EVENT: "Change event",
  APP_LOG: "Application log",
  ANALYST_NOTE: "Analyst note",
  OTHER: "Other",
};

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, Label> = {
  CONFIRMED_BY_SOURCE: { label: "Confirmed by source", tone: "info" },
  CORROBORATED: { label: "Corroborated", tone: "success" },
  UNVERIFIED: { label: "Unverified", tone: "neutral" },
  DISPUTED: { label: "Disputed", tone: "warning" },
};

export const IMPACT_LABELS: Record<ImpactState, Label & { long: string }> = {
  CONFIRMED_AFFECTED: { label: "Confirmed affected", tone: "danger", long: "Confirmed affected — direct evidence" },
  POTENTIALLY_AFFECTED: { label: "At risk", tone: "warning", long: "At risk — dependency path" },
  CONFIRMED_HEALTHY: { label: "Confirmed healthy", tone: "success", long: "Confirmed healthy — positive observation" },
  UNKNOWN: { label: "Unknown", tone: "neutral", long: "Unknown — no sufficient observations" },
};

export const PROVIDER_REPORTED_LABEL: Label = { label: "Provider reported", tone: "info" };

export const OBSERVED_STATUS_LABELS: Record<ObservedStatus, Label> = {
  UNKNOWN: { label: "Unknown", tone: "neutral" },
  HEALTHY: { label: "Healthy", tone: "success" },
  DEGRADED: { label: "Degraded", tone: "warning" },
  DOWN: { label: "Down", tone: "danger" },
};

export const ASSET_PROVIDER_LABELS: Record<AssetProvider, string> = {
  MICROSOFT_365: "Microsoft 365",
  AZURE: "Azure",
  AWS: "AWS",
  GCP: "Google Cloud",
  INTERNAL: "Internal",
  OTHER: "Other",
};

export const CRITICALITY_LABELS: Record<Criticality, Label> = {
  CRITICAL: { label: "Critical", tone: "danger" },
  HIGH: { label: "High", tone: "warning" },
  MEDIUM: { label: "Medium", tone: "info" },
  LOW: { label: "Low", tone: "neutral" },
};

export const HYPOTHESIS_STATUS_LABELS: Record<HypothesisStatus, Label> = {
  OPEN: { label: "Open", tone: "info" },
  SUPPORTED: { label: "Supported", tone: "success" },
  REJECTED: { label: "Rejected", tone: "neutral" },
  UNRESOLVED: { label: "Unresolved", tone: "warning" },
};

export const HYPOTHESIS_CONFIDENCE_LABELS: Record<HypothesisConfidence, Label> = {
  LOW: { label: "Low confidence", tone: "neutral" },
  MEDIUM: { label: "Medium confidence", tone: "info" },
  HIGH: { label: "High confidence", tone: "info" },
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, Label> = {
  HIGH: { label: "High", tone: "warning" },
  MEDIUM: { label: "Medium", tone: "info" },
  LOW: { label: "Low", tone: "neutral" },
};

export const TASK_STATUS_LABELS: Record<TaskStatus, Label> = {
  OPEN: { label: "Open", tone: "info" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  DONE: { label: "Done", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const ANALYSIS_MODE_LABELS: Record<AnalysisMode, Label> = {
  RULE_BASED: { label: "RULE-BASED", tone: "neutral" },
  CLAUDE: { label: "AI ANALYSIS · CLAUDE", tone: "neutral" },
};

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, Label> = {
  NOT_CONFIGURED: { label: "Not configured", tone: "neutral" },
  READY: { label: "Ready · not synced", tone: "info" },
  SYNCING: { label: "Syncing", tone: "info" },
  CONNECTED: { label: "Connected", tone: "success" },
  ERROR: { label: "Error", tone: "danger" },
};

export const ROLE_LABELS: Record<Role, Label & { description: string }> = {
  OWNER: {
    label: "Owner",
    tone: "info",
    description: "Manages the workspace, members and integrations; full investigation rights.",
  },
  ANALYST: {
    label: "Analyst",
    tone: "info",
    description: "Creates and edits incidents, evidence, hypotheses, tasks, analyses and reports.",
  },
  VIEWER: { label: "Viewer", tone: "neutral", description: "Read-only access to investigations and reports." },
};

export function labelOf<K extends string>(map: Record<K, Label>, key: string): Label {
  return (map as Record<string, Label>)[key] ?? { label: key, tone: "neutral" };
}

export function textOf<K extends string>(map: Record<K, string>, key: string): string {
  return (map as Record<string, string>)[key] ?? key;
}
