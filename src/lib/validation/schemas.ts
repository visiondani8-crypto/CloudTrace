import { z } from "zod";
import {
  ASSET_ASSERTION_STATUSES,
  ASSET_PROVIDERS,
  CLASSIFICATIONS,
  CONFIDENCE_LEVELS,
  CRITICALITIES,
  EVIDENCE_CATEGORIES,
  HYPOTHESIS_CONFIDENCES,
  HYPOTHESIS_STATUSES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  OBSERVED_STATUSES,
  PROVENANCES,
  ROLES,
  SEVERITIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/lib/domain/enums";
import { ISO_WITH_ZONE } from "@/lib/domain/time";
import { sanitiseText } from "@/lib/evidence/normalise";

export const text = (min: number, max: number, label: string) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` })
    .transform(sanitiseText)
    .pipe(
      z
        .string()
        .min(min, min === 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
        .max(max, `${label} must be at most ${max} characters`),
    );

export const optionalText = (max: number, label: string) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" ? sanitiseText(v) : v))
    .pipe(z.union([z.string().max(max, `${label} must be at most ${max} characters`), z.null()]).optional())
    .transform((v) => (v === "" ? null : v));

export const isoDateTime = (label: string) =>
  z
    .string({ invalid_type_error: `${label} must be an ISO-8601 timestamp` })
    .trim()
    .refine((v) => ISO_WITH_ZONE.test(v) && !Number.isNaN(new Date(v).getTime()), {
      message: `${label} must be ISO-8601 with a time zone (e.g. 2026-11-12T16:20:00Z)`,
    })
    .transform((v) => new Date(v));

export const optionalIsoDateTime = (label: string) => z.union([isoDateTime(label), z.null()]).optional();

export const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid identifier");
const idList = z.array(id).max(100).default([]);

export const createIncidentSchema = z.object({
  title: text(3, 200, "Title"),
  description: text(1, 5000, "Description"),
  type: z.enum(INCIDENT_TYPES),
  severity: z.enum(SEVERITIES),
  startedAt: optionalIsoDateTime("Start time"),
  ownerId: z.union([id, z.null()]).optional(),
  assetIds: idList,
});

export const updateIncidentSchema = z
  .object({
    title: text(3, 200, "Title").optional(),
    description: text(1, 5000, "Description").optional(),
    type: z.enum(INCIDENT_TYPES).optional(),
    severity: z.enum(SEVERITIES).optional(),
    status: z.enum(INCIDENT_STATUSES).optional(),
    classification: z.enum(CLASSIFICATIONS).optional(),
    /** Required when setting CONFIRMED_SECURITY: the analyst's evidence review justification. */
    classificationJustification: optionalText(1000, "Justification"),
    ownerId: z.union([id, z.null()]).optional(),
    startedAt: optionalIsoDateTime("Start time"),
    resolvedAt: optionalIsoDateTime("Resolved time"),
  })
  .refine((v) => Object.keys(v).length > 0, "No changes supplied");

export const incidentListSchema = z.object({
  q: z.string().trim().max(120).optional(),
  severity: z.union([z.enum(SEVERITIES), z.array(z.enum(SEVERITIES))]).optional(),
  status: z.union([z.enum(INCIDENT_STATUSES), z.array(z.enum(INCIDENT_STATUSES))]).optional(),
  type: z.enum(INCIDENT_TYPES).optional(),
  ownerId: id.optional(),
  sort: z.enum(["updated_desc", "updated_asc", "severity", "case"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().refine((n) => [10, 20, 50, 100].includes(n), "pageSize must be 10, 20, 50 or 100").optional(),
});

export const assetSchema = z.object({
  name: text(2, 120, "Name"),
  provider: z.enum(ASSET_PROVIDERS),
  assetType: text(2, 80, "Type"),
  owner: optionalText(120, "Owner"),
  criticality: z.enum(CRITICALITIES),
  description: optionalText(1000, "Description"),
  externalResourceId: optionalText(300, "External resource ID"),
});

export const dependencySchema = z.object({
  consumerAssetId: id,
  providerAssetId: id,
  description: optionalText(500, "Reason"),
});

export const incidentAssetStatusSchema = z.object({
  assetId: id,
  observedStatus: z.enum(OBSERVED_STATUSES),
  statusEvidenceId: z.union([id, z.null()]).optional(),
});

export const manualEvidenceSchema = z.object({
  title: z.string(),
  category: z.enum(EVIDENCE_CATEGORIES),
  provenance: z.enum(PROVENANCES),
  sourceName: z.string(),
  sourceEventId: z.string().optional().nullable(),
  sourceUri: z.string().optional().nullable(),
  observedAt: z.string(),
  contentText: z.string(),
  assetId: z.union([id, z.null()]).optional(),
  assetStatus: z.union([z.enum(ASSET_ASSERTION_STATUSES), z.null()]).optional(),
  confidenceLevel: z.enum(CONFIDENCE_LEVELS).optional(),
});

export const annotationSchema = z.object({ text: text(1, 4000, "Annotation") });

export const timelineEntrySchema = z.object({
  title: text(3, 300, "Title"),
  description: optionalText(2000, "Description"),
  occurredAt: isoDateTime("Occurred at"),
  assetId: z.union([id, z.null()]).optional(),
});

export const hypothesisSchema = z.object({
  title: text(3, 300, "Statement"),
  description: z.union([text(0, 4000, "Description"), z.undefined()]).transform((v) => v ?? ""),
  confidence: z.enum(HYPOTHESIS_CONFIDENCES),
  status: z.enum(HYPOTHESIS_STATUSES).default("OPEN"),
  note: optionalText(1000, "Note"),
  supportingEvidenceIds: idList,
  contradictingEvidenceIds: idList,
});

export const hypothesisUpdateSchema = z
  .object({
    id,
    title: text(3, 300, "Statement").optional(),
    description: text(0, 4000, "Description").optional(),
    confidence: z.enum(HYPOTHESIS_CONFIDENCES).optional(),
    status: z.enum(HYPOTHESIS_STATUSES).optional(),
    note: optionalText(1000, "Note"),
    supportingEvidenceIds: z.array(id).max(100).optional(),
    contradictingEvidenceIds: z.array(id).max(100).optional(),
  });

export const taskSchema = z.object({
  title: text(3, 200, "Task"),
  description: optionalText(2000, "Description"),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES).default("OPEN"),
  assigneeId: z.union([id, z.null()]).optional(),
  dueAt: optionalIsoDateTime("Due date"),
  evidenceIds: idList,
});

export const taskUpdateSchema = z.object({
  id,
  title: text(3, 200, "Task").optional(),
  description: optionalText(2000, "Description"),
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.union([id, z.null()]).optional(),
  dueAt: optionalIsoDateTime("Due date"),
  evidenceIds: z.array(id).max(100).optional(),
});

export const noteSchema = z.object({ text: text(1, 5000, "Note") });

export const analyzeSchema = z.object({ preferClaude: z.boolean().optional().default(true) });

export const orgUpdateSchema = z.object({ name: text(2, 120, "Workspace name") });

export const profileUpdateSchema = z.object({ name: text(2, 120, "Display name") });

export const roleUpdateSchema = z.object({ membershipId: id, role: z.enum(ROLES) });

export const demoUserSchema = z.object({
  name: text(2, 120, "Name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  role: z.enum(ROLES),
  password: z.string().min(12, "Password must be at least 12 characters").max(200),
});

export const switchOrgSchema = z.object({ organizationId: id });

export const attachIssueSchema = z.object({ issueId: id, incidentId: id });

export const auditListSchema = z.object({
  q: z.string().trim().max(120).optional(),
  actorId: id.optional(),
  action: z.string().trim().max(60).regex(/^[a-z_.]*$/).optional(),
  entity: z.string().trim().max(64).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(10).max(100).optional(),
});

export const evidenceListSchema = z.object({
  q: z.string().trim().max(160).optional(),
  incidentId: id.optional(),
  provenance: z.enum(PROVENANCES).optional(),
  assetId: id.optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().refine((n) => [20, 50, 100].includes(n), "pageSize must be 20, 50 or 100").optional(),
});
