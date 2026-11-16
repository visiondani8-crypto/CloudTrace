# CLOUDTRACE — COMPLETE CLAUDE CODE MVP BUILD SPECIFICATION

**Version:** 1.0  
**Prepared:** 16 November 2026  
**Product:** CloudTrace — Cloud Incident Intelligence & Forensics  
**Audience:** Claude Code / implementation agent  
**Deliverable:** A working, locally runnable, persistent, tested web application — not a landing page or static prototype.

---

## 0. MASTER INSTRUCTION TO CLAUDE CODE

You are the lead engineer, security architect, technical product manager, and test engineer for **CloudTrace**. Implement the application specified below in the current repository. Do not merely describe, sketch, or generate screenshots of the app. Write the source code, database schema, migrations/initialisation, seed data, server-side APIs, application UI, tests, documentation, and runnable scripts.

**Execution rules**

1. Work autonomously through the sections of this specification. Make sensible engineering decisions when minor details are unspecified; document them in `IMPLEMENTATION_NOTES.md`.
2. Build a genuine vertical slice first (authentication → persisted incident → evidence → investigation → dependency map → report), then complete the remaining modules. Do not spend all effort on visual design while leaving buttons and workflows inert.
3. The system must run **locally without Azure, Microsoft credentials, paid AI keys, Supabase, or third-party hosted services**. An optional Microsoft Graph read-only connector and optional Claude-powered analysis can be enabled separately.
4. Never display simulated telemetry as actual Microsoft or customer telemetry. Preserve provenance in the database and UI.
5. There is **no proof of a cyberattack** in the November 2026 Microsoft 365 incident used as the case study. Classify it as a technical/provider outage according to the cited incident communication; do not label it a hack.
6. Implement role permissions and organisation scoping on the **server** (not only by hiding buttons).
7. All analytical claims must have evidence IDs, supporting references, or an explicit "unverified / hypothesis" label. Prevent the AI from presenting assumptions as confirmed root causes.
8. After implementing, run type-checking, unit tests, and a production build. Fix any issues you can reproduce. Produce a concise final summary including real passing/failing checks and commands to start the app.
9. Do not claim live cloud monitoring, active Microsoft integration, or real AI access if credentials are not configured. Display clear connection states.
10. If dependencies or services are inaccessible, implement the fully functioning local path instead of blocking the project.

### Definition of done

A user can sign into a seeded demo organisation, open a seeded incident, inspect traceable evidence, upload additional event data, generate a time-ordered investigation, inspect a real algorithmic dependency/blast-radius view, save an analyst hypothesis and response task, generate an evidence-referenced investigation report, export it, and return later to find all saved changes. A second incident demonstrates a **synthetic** suspicious-sign-in case. No mandatory API keys.

---

## 1. PRODUCT VISION AND POSITIONING

**Tagline:** Understand the failure. Trace the evidence. Protect the business.

**Problem:** When Microsoft 365, AWS, Azure, or another shared provider has a major disruption, customers can struggle to determine if their own systems are affected, distinguish a cloud-provider outage from an attack, identify downstream dependencies, preserve evidence, and produce an actionable incident review.

**Solution:** CloudTrace correlates incident reports and authorised organisation telemetry with a manually maintained service-dependency graph. It offers evidence-based investigation workflows, blast-radius assessment, human-approved response tracking, AI-assisted analysis when configured, and defensible incident reports.

**Primary users:** Cloud Operations Engineers, SOC Analysts, Security Analysts, Incident Responders, SREs, and small-company IT Administrators.

**Use cases:**
- Provider outage with cascading business impact.
- Suspicious authentication or security events.
- Misconfiguration or change-related degradation.
- Retrospective incident reconstruction for a portfolio demo.

**Differentiator:** CloudTrace is **investigation-first**. A beautiful monitoring dashboard by itself is not sufficient. The evidence, dependency logic, and investigation workflow are the core product.

### MVP vs. later roadmap

**MVP IN SCOPE:** persistent multi-organisation-aware data model; working demo authentication; incident CRUD/workflow; service inventory; dependency graph; evidence upload; timeline; rule-based investigation; hypothesis board; analyst notes; task tracking; printable report and JSON/CSV export; optional Claude analysis; optional read-only Microsoft 365 service-health connector; audit log; seeded Microsoft case and synthetic security case; responsive UI; automated tests.

**OUT OF SCOPE:** autonomous containment, destructive cloud actions, endpoint agents, full SIEM ingestion, unrestricted public internet crawling, production-scale event streaming, forensic disk imaging, attack attribution, real-time global provider visibility, fully implemented Sentinel integration, enterprise SSO, compliance certification, alert paging, and automatic billing.

---

## 2. FACTUAL CASE STUDY AND SOURCE INTEGRITY

### Microsoft 365 incident (historical reference)

Use the **12–13 November 2026 Microsoft 365 / Exchange Online service disruption** as a case study, with Microsoft incident IDs `EX1550543` and `MO1550821`.

The preliminary incident communication describes a **technical issue**, not a cyberattack. The provider reported a start of **2026-11-12 16:20 UTC** and restoration of **2026-11-13 16:10 UTC** for the affected service-impact interval; early incident tracking entries may have different initial detection timestamps. A later final incident report may amend preliminary findings.

Canonical external sources for the app's "Sources" panel (display the source title, URL, retrieval/excerpt date and preliminary status; link out rather than copying long external reports):

- University of Pennsylvania mirror of Microsoft service health updates: `https://mailservices.isc.upenn.edu/computing/email/penno365/alerts/ms-incidents.html`
- Public Microsoft incident post-incident report summary and preliminary PDF reference: `https://www.365fanatic.com/m365-outage-12-november-2026/`
- Microsoft Graph service health documentation: `https://learn.microsoft.com/en-us/graph/api/servicehealth-get?view=graph-rest-1.0`
- Microsoft Graph sign-in log documentation: `https://learn.microsoft.com/en-us/graph/api/signin-list?view=graph-rest-1.0`
- Azure Sentinel incidents REST API documentation (roadmap reference only): `https://learn.microsoft.com/en-us/rest/api/securityinsights/incidents?view=rest-securityinsights-2025-09-01`

**Seed-data factuality:**
- `PUBLIC_REPORTED`: service impact, preliminary technical-cause narrative, reported restoration, quoted incident IDs. Link every item to its source URL and note the report's preliminary status.
- `SYNTHETIC`: fictional company CRM failures, fictional tenant 503 errors, estimated financial impact, private account activity, customer asset inventory, and all local telemetry. Display "SIMULATED DATA" prominently on these items.
- Do not seed fictitious internal Microsoft logs or fabricate affected-company counts.
- Do not treat a copied status communication as direct proof of underlying private infrastructure conditions. Use "provider-reported cause" rather than "independently verified root cause".

For the synthetic security incident, create a fictional employee and fictional, private-IP test range addresses (e.g. `192.0.2.0/24`, `198.51.100.0/24`) rather than real personal information. Every event must be marked `SYNTHETIC`.

---

## 3. REQUIRED STACK AND RUNNABILITY

### Preferred implementation (make compatible dependency selections)

- **Frontend/full-stack:** Next.js (App Router), React, TypeScript with `strict: true`.
- **Styling:** Tailwind CSS, shadcn/ui or equivalent accessible primitives, Lucide icons.
- **DB / ORM:** Prisma with **SQLite by default** (`file:./dev.db`) for a frictionless offline demo. Organise schema and data access to permit PostgreSQL migration later; do not pretend switching DB providers is automatic.
- **Authentication:** Auth.js / NextAuth credentials-based local demo user accounts with password hashing (bcrypt or argon2) and server-side session verification. Follow the currently installed major version's documented APIs; no homegrown insecure bearer token.
- **Charts:** Recharts or equivalent.
- **Dependency graph:** `@xyflow/react` (React Flow) or Cytoscape; real nodes and edges loaded from the database, with pan/zoom and node-inspection details.
- **Validation:** Zod for all mutating inputs and imported records.
- **Testing:** Vitest (core units), Testing Library where appropriate, Playwright (critical end-to-end happy path if environment supports a browser).
- **Optional AI:** Anthropic SDK invoked **only server-side**, gated by `ANTHROPIC_API_KEY` and optional `CLAUDE_MODEL` environment configuration. If no valid key/model exists, use deterministic evidence-based summaries clearly labelled "Rule-based analysis"; no paid services are essential.
- **Optional Microsoft integration:** Entra app-only OAuth client credentials **server-side** to retrieve authorised tenant Microsoft Graph service-health data with `ServiceHealth.Read.All` permission, manually triggered sync (no unauthorised API access). Keep integration disabled until configured and consented.

**Required scripts:** `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `db:push`, `db:seed`, `db:reset` (the destructive command must explicitly warn it is dev-only), `test:e2e` (if Playwright is installed). Ensure `npm install`, `cp .env.example .env`, `npm run db:push`, `npm run db:seed`, `npm run dev` work in that order.

**Environment variables:** `DATABASE_URL`, `AUTH_SECRET`/version-appropriate equivalent, `DEMO_SEED_PASSWORD`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `NEXT_PUBLIC_APP_NAME`. Read them via server-only configuration. The default app must not crash if optional variables are unset. Secret/config errors should be descriptive but redact secret values.

**Production note:** SQLite and local credentials are for a development/portfolio MVP. Before internet-facing multi-tenant deployment, move to a production database, harden account onboarding and recovery, add strong tenancy tests and key management, production rate limiting, backup/restore, incident retention policies, and security review. Do not imply that the MVP is certified for sensitive enterprise data.

---

## 4. VISUAL DESIGN — APPROVED OBSIDIAN DESIGN SYSTEM (AUTHORITATIVE OVERRIDE)

**Required:** Read `CLOUDTRACE_OBSIDIAN_DESIGN_SPEC.md` in full before creating any app UI. It is the canonical design spec and **supersedes all previous visual tokens, typography, corner radius, layout proportions and stylistic suggestions** in this MVP document. Use `cloudtrace-obsidian.css` and `obsidian.tokens.json`. The specification covers all screens, modals, error/empty states, copy, responsive interaction, accessibility and design QA. **Keep every functional requirement listed in the following App shell/screens subsections and elsewhere in this document.** Do not treat the four-screen preview as the full app scope.

### App shell

Left persistent nav (collapsible on tablets, drawer on phones):
1. **Command Overview** — high-level incident summary.
2. **Incidents** — searchable list and create incident.
3. **Investigation Lab** — current incident investigation workspace; empty state if none selected.
4. **Asset Graph** — all services and business dependencies.
5. **Evidence Vault** — evidence index and imports.
6. **Reports** — generated incident reports.
7. **Integrations** — connection states and manual sync.
8. **Activity & Audit** — activity history.
9. **Settings** — organisation, users/roles where authorised.

Topbar: environment label `DEMO` or `CONNECTED TENANT`, organisation switcher only for orgs user belongs to, global incident search, UTC time display, avatar/profile, optional theme toggle. Provide a `Demo / Live-source` status indicator; never mislead.

### Screens and detailed behaviours

**A. Command Overview**
- 4 functional KPI tiles: Open Incidents, Investigations in Progress, Confirmed Affected Assets, At-Risk Dependencies. Derive from persisted organisation records, not constants.
- Incidents trend (actual seeded or entered incidents) with labelled timeframe.
- Critical incidents table with severity, classification, last updated, evidence count, and Open action.
- Evidence quality/completeness panel (simple deterministic rules).
- Recent activity audit list.
- Demo banner: "Historical public reports + simulated company telemetry. Not a live Microsoft investigation." when showing seeded data.

**B. Incidents**
- Search, filter by severity/status/type, sort by latest, pagination or reasonable page-size controls.
- Create incident with title, description, type (`PROVIDER_OUTAGE`, `SECURITY_SUSPICION`, `CONFIGURATION_FAILURE`, `OTHER`), severity (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), start time, services, owner.
- Status workflow `OPEN → INVESTIGATING → MONITORING → RESOLVED` with allow re-open to `INVESTIGATING`; save transitions to audit log.
- Incident detail header showing case ID, factuality badge, service names, owner, classification, latest update.
- Editable owner and severity for analysts/owners; viewers read-only.

**C. Investigation Lab (central feature)**
Seven functional tabs:
1. Overview: executive summary; confirmed facts; unknowns; incident classification; last analysis time; analysis mode (`RULE_BASED` / `CLAUDE`).
2. Timeline: events in UTC, sortable and filterable by provenance, category and confidence; link each event to evidence.
3. Evidence: evidence cards and inspector with SHA-256, source, observed vs ingested timestamp, original normalized content, linked incident, and analyst annotations.
4. Dependency Impact: interactive dependency map, reasoning for at-risk assets, click node for upstream/downstream details.
5. Hypotheses: analyst-created root-cause hypotheses with confidence (`LOW`, `MEDIUM`, `HIGH`), supporting evidence IDs, contradicting evidence IDs, status (`OPEN`, `SUPPORTED`, `REJECTED`, `UNRESOLVED`); reject empty-evidence promotion to 'SUPPORTED'.
6. Response Tasks: manual tasks with assignee, priority, due date, status, and links to evidence/incident. Nothing executes against external systems.
7. Report: generate snapshot and view printable/exportable post-incident report.

**D. Asset Graph**
- Inventory table and graph; add/edit an asset with name, provider (`MICROSOFT_365`, `AZURE`, `AWS`, `GCP`, `INTERNAL`, `OTHER`), type, owner, criticality, optional description.
- Add/remove directed dependency edges; edge semantic is **consumer DEPENDS_ON provider**. Prevent self-dependencies. Accept cycles in data but traversal must not loop forever; warn user of cycles.
- Per-incident overlay: measured service health vs derived at-risk; show legend.
- Click a node for incoming/outgoing dependencies, relevant incident events, and evidence used to determine status.

**E. Evidence Vault**
- Add evidence manually and import CSV/JSON files with preview, schema validation, row-level errors, file-size limit (5 MiB), dedupe strategy, success/failure result.
- An import with 1 invalid row must not silently drop it. Show accepted/rejected counts and errors; provide an all-or-nothing option (default atomic).
- Search evidence by incident/source/hash/asset/time.
- Display `PUBLIC_REPORTED`, `CUSTOMER_OBSERVED`, `SYNTHETIC`, `ANALYST_NOTE` badges.
- Store content SHA-256. Preserve raw import metadata and source file name where practical. **Never allow arbitrary server-side URL fetching** from an uploaded row; external URLs are only references opened by explicit user action.

**F. Reports**
- Generate a report snapshot with summary, scope, verified/provider-reported facts, unknowns, event timeline, affected vs at-risk assets, hypotheses and conclusions, tasks, recommendations, citations/evidence refs, analyst, generation timestamp, and caveats.
- Export **HTML print/PDF through browser print**, structured JSON, and timeline CSV. Label print-to-PDF clearly; no unimplemented download buttons.
- Persist each generated report with immutable snapshot content and version number. Subsequent incident changes should not silently rewrite earlier reports.
- Include appendices that show provenance and "data limitations". Reports may say "cause undetermined".

**G. Integrations**
- Local mode always available, clearly active.
- Microsoft 365 service health card: `NOT_CONFIGURED`, `READY`, `SYNCING`, `CONNECTED`, `ERROR`; display last sync and permission scope.
- When configured, a server-side `Sync now` call uses a pre-consented Microsoft Entra app to read tenant service-health data (Graph). Only fetch relevant issue/health overview data; no privileged user content or tenant access without authorisation. Avoid inserting duplicate issues/events across repeated syncs by using provider IDs and update timestamps.
- Show clean setup checklist for tenant ID, client ID, secret and `ServiceHealth.Read.All`. Never ask users to paste the client secret into the browser. No fake connected badges.
- AI card: `UNCONFIGURED` or `CONNECTED`; list the mode and status. If model ID unavailable or API call fails, gracefully fall back to rule-based analysis.
- `Coming later` cards may be shown for Sentinel, Azure Monitor, AWS CloudWatch, but **not** represented as operational.

**H. Activity & Audit**
- Append-only audit entries for significant mutations: incident status changes, evidence import, evidence annotations, hypotheses, tasks, exports, integration sync, role changes. Display actor, action, entity, timestamp and safe metadata.
- Never record secrets or full raw authentication tokens in audit entries.

**I. Settings**
- Organisation name/edit (owner only), current user's profile, membership list and role badges.
- Organisation owner can invite/create local demo users via dev-only path if practical. No public self-service signup required for MVP. Viewers can read permitted organisation data but cannot mutate or run imports/analysis.

### Responsive and accessible

Desktop 1440px target; functional at 1024px and phone 390px. Keyboard navigation, visible focus, accessible dialogs and buttons, reduced-motion support, labelled statuses (not colour-only), contrast-compliant text, empty/loading/error states, error retry where safe.

---

## 5. DATA MODEL — CREATE REAL PERSISTENT TABLES

All organisation-bound entities include a **non-null `organizationId`** and all queries must filter by the authenticated user's organisation membership. Use UUID/CUID primary keys and UTC timestamps (Prisma `DateTime`). The following fields are a minimum; add normal engineering fields as necessary.

**Organization**
`id`, `name`, `slug`, `createdAt`, `updatedAt`.

**User**
`id`, `email` (unique), `name`, `passwordHash`, `createdAt`, `updatedAt`; compatible with your Auth.js strategy.

**Membership**
`id`, `organizationId`, `userId`, `role` (`OWNER`, `ANALYST`, `VIEWER`), `createdAt`; unique `(organizationId, userId)`.

**Incident**
`id`, `organizationId`, `caseNumber` (unique within organisation), `title`, `description`, `type`, `severity`, `status`, `classification` (`PROVIDER_TECHNICAL`, `SECURITY_SUSPECTED`, `CONFIRMED_SECURITY`, `CONFIGURATION`, `UNDETERMINED`), `startedAt?`, `resolvedAt?`, `ownerId?`, `isDemo`, `createdAt`, `updatedAt`.

**Asset**
`id`, `organizationId`, `name`, `provider`, `assetType`, `description?`, `owner?`, `criticality`, `externalResourceId?`, `createdAt`, `updatedAt`.

**Dependency**
`id`, `organizationId`, `consumerAssetId`, `providerAssetId`, `relationshipType` (`DEPENDS_ON`), `description?`; unique `(organizationId, consumerAssetId, providerAssetId)`; reject self-edge. A consumer depends on a provider.

**IncidentAsset**
`id`, `organizationId`, `incidentId`, `assetId`, `observedStatus` (`UNKNOWN`, `HEALTHY`, `DEGRADED`, `DOWN`), `observedAt?`, `statusEvidenceId?`; unique `(incidentId, assetId)`.

**Evidence**
`id`, `organizationId`, `incidentId`, `assetId?`, `title`, `category` (`PROVIDER_NOTICE`, `HEALTH_EVENT`, `AUTH_EVENT`, `CHANGE_EVENT`, `APP_LOG`, `ANALYST_NOTE`, `OTHER`), `provenance`, `sourceName`, `sourceUri?`, `sourceEventId?`, `contentText` (sanitised for display), `sha256`, `observedAt`, `ingestedAt`, `isSynthetic`, `confidenceLevel`, `createdById?`, `importJobId?`; add composite index `(organizationId, incidentId, observedAt)` and unique dedupe where safe (e.g. same `(organizationId, sourceName, sourceEventId)` when `sourceEventId` is present). Do not deduplicate unrelated records merely because messages are equal.

**TimelineEvent**
`id`, `organizationId`, `incidentId`, `evidenceId?`, `assetId?`, `occurredAt`, `eventType`, `title`, `description?`, `sourceClass`, `createdAt`. An item without evidence must display "Analyst-entered / unverified".

**Hypothesis**
`id`, `organizationId`, `incidentId`, `title`, `description`, `confidence`, `status`, `supportingEvidenceIds` and `contradictingEvidenceIds` (ideally separate relational join tables), `createdById`, `createdAt`, `updatedAt`.

**ResponseTask**
`id`, `organizationId`, `incidentId`, `title`, `description?`, `priority`, `status`, `assigneeId?`, `dueAt?`, `completedAt?`, `createdById`, `createdAt`, `updatedAt`.

**InvestigationNote**
`id`, `organizationId`, `incidentId`, `authorId`, `text`, `createdAt`, `updatedAt`.

**InvestigationAnalysis**
`id`, `organizationId`, `incidentId`, `mode`, `generatedAt`, `summary`, `factsJson`, `hypothesesJson`, `unknownsJson`, `recommendationsJson`, `usedEvidenceIdsJson`, `modelId?`, `errorStatus?`.

**ReportSnapshot**
`id`, `organizationId`, `incidentId`, `version`, `createdById`, `generatedAt`, `contentJson`, `contentHtml?`; unique `(incidentId, version)`.

**ImportJob**
`id`, `organizationId`, `incidentId`, `filename`, `fileSha256`, `format`, `acceptedCount`, `rejectedCount`, `errorsJson`, `createdById`, `createdAt`.

**ProviderConnection**
`id`, `organizationId`, `provider` (`MICROSOFT_GRAPH_SERVICE_HEALTH`), `status`, `lastSyncAt?`, `lastErrorCode?`, `metadataJson`; secrets are server env vars or secure secret provider, **not** plaintext database columns.

**AuditEntry**
`id`, `organizationId`, `actorId?`, `action`, `entityType`, `entityId?`, `metadataJson` (redacted), `createdAt`.

Consider separate `SourceReference` table for external report provenance (URL + retrievedAt + version + title). If added, include organisation scoping or treat public references as explicitly global immutable records.

### Non-negotiable DB behaviour

- Use transactions for evidence imports, incident status changes with audit logging, and report version creation.
- Cascade deletes carefully; keep audit trail and reports. Prefer soft-deletion for incidents or disable deletion in MVP.
- Do not allow one organisation to reference another organisation's `assetId`, `incidentId`, `evidenceId`, or `userId` merely by knowing the ID.
- Seed idempotently: rerunning `db:seed` does not duplicate incidents/evidence/edges.

---

## 6. CORE INVESTIGATION ENGINE — DETERMINISTIC FIRST

### 6.1 Evidence normalization

Create a `normaliseEvidence` function that validates incoming rows and returns a canonical model with UTC date, source, category, title, text, provenance, and SHA-256. Maintain the distinction between `observedAt` (event occurred) and `ingestedAt` (system imported). Hash the exact canonical evidence payload or raw file content with a documented choice; do not claim cryptographic chain-of-custody beyond what is actually implemented.

CSV import headers (exact minimum):

`incidentCaseNumber,observedAt,title,category,sourceName,sourceEventId,assetName,provenance,contentText,sourceUri`

JSON import: an array of objects with the same keys; optional `confidenceLevel`. Allow empty `assetName` if unknown. CSV times must be ISO-8601 including time zone; reject ambiguous local timestamps. Reject unknown provenance enums. Validate and give row-specific error messages. Prefer no unbounded file parsing.

### 6.2 Event correlation

- Sort by `occurredAt`, with tie-break by ID. Do not order by ingestion time unless explicitly selected.
- Evidence links should be traceable back to source and hash.
- Basic deterministic correlation groupings: same asset within a configurable time window (default ±15 min), same sourceEventId, and explicit incident link; surface as "related events", not causation.
- An investigator can add an explicit analysis note to describe why events might be connected.
- Store every auto-generated analysis with analysis mode and timestamp for auditability.

### 6.3 Blast radius algorithm (important)

Dependency relationship: **consumer asset C `DEPENDS_ON` provider asset P**. To find assets potentially affected when P is degraded/down, traverse **reverse dependency edges** (`P -> consumers`) breadth-first with a visited set. Include all transitive consumers; avoid infinite cycles; return shortest path explaining each relationship.

For a particular incident, assign exactly one display state per asset:

- `CONFIRMED_AFFECTED`: direct incident evidence / `IncidentAsset.observedStatus` is `DOWN` or `DEGRADED`, linked to an evidence reference. This is a customer-observed impact if the evidence belongs to the customer; a provider notice can mark the **provider service** degraded but not prove every customer's instance failed.
- `POTENTIALLY_AFFECTED`: dependency path leads to a confirmed degraded provider/asset, but no direct failure evidence for this consumer. Show the path and "at risk, not confirmed down".
- `CONFIRMED_HEALTHY`: fresh positive customer observation from an attached evidence record within a defined observation window, and no newer confirmed failure. If newer confirmed failure exists, failure takes precedence. Do not infer healthy solely because there is no alert.
- `UNKNOWN`: no evidence and no upstream degradation path.

If both healthy and failure evidence conflict, show a conflict flag and prioritize the most recent timestamp while preserving both records. Differentiate **public provider-reported** from **customer-observed** in all views.

**Algorithm pseudocode:**

```text
for each incident-linked asset with supporting evidence of DOWN or DEGRADED:
    state[asset] = CONFIRMED_AFFECTED
    queue.push((asset, [asset]))
while queue not empty:
    (provider, path) = queue.pop_front()
    for consumer in reverseDependencyGraph[provider]:
        if consumer already visited for this origin: continue
        if no confirmed impact/health evidence for consumer:
            state[consumer] = POTENTIALLY_AFFECTED
            reason[consumer] = shortest path provider → ... → consumer
        queue.push((consumer, path + [consumer]))
for other assets:
    state = CONFIRMED_HEALTHY only if positive evidence exists, else UNKNOWN
```

The implementation may differ but must preserve the semantics and support tests for a linear chain, branch, cycles, an independent Azure service, conflicting evidence, and multi-source impacts.

### 6.4 Evidence-based rule summary (works offline)

Create a rule-based report builder that pulls: latest incident metadata; chronological facts with evidence references; directly observed affected assets; potential blast radius; open contradictions/unknowns; unresolved response tasks. Write a compact summary with no unsupported causation. Example wording:

> "A provider-reported Exchange Online disruption overlaps with two simulated CRM synchronization errors. The CRM dependency on Exchange makes the workflow potentially affected; the recorded simulated errors support an actual CRM impact in this demo. Attribution to a cyberattack is not supported by the available evidence."

Use explicit labels in the UI if summary has simulated components.

### 6.5 Optional Claude investigator

If `ANTHROPIC_API_KEY` and a supported `CLAUDE_MODEL` are configured, the server endpoint may send the **minimum necessary** evidence abstracts for the selected incident. Do not send secrets, credentials, raw tokens, or private content by default. Treat logs and provider text as **untrusted data**, not instructions. Scope evidence strictly to the selected organisation and incident. Validate AI response with a typed JSON schema and require every factual claim to reference actual evidence IDs from the submitted set; reject or remove unsupported claims. Limit output size/tokens; report parse errors and fall back cleanly.

Required output schema (conceptually):

```json
{
  "summary": "string",
  "classificationSuggestion": "PROVIDER_TECHNICAL | SECURITY_SUSPECTED | CONFIGURATION | UNDETERMINED",
  "facts": [{ "statement": "string", "evidenceIds": ["existing-evidence-id"] }],
  "hypotheses": [{ "statement": "string", "confidence": "LOW | MEDIUM | HIGH", "supportingEvidenceIds": ["existing-evidence-id"], "contradictingEvidenceIds": [] }],
  "unknowns": ["string"],
  "recommendedActions": [{ "description": "string", "reasonEvidenceIds": [] }],
  "limitations": ["string"]
}
```

Do not mark classification `CONFIRMED_SECURITY` from a model output. A human analyst must explicitly review the evidence and choose that classification. Recommendations must never auto-execute external changes. Display mode, model ID and timestamp. If optional AI isn't configured, the **Analyze** button must still work via deterministic rule-based analysis with an explicit mode label.

---

## 7. SERVER API / SERVER ACTION CONTRACTS

Use Next.js route handlers or server actions consistently. Every operation must authenticate, verify organisation membership, check role, validate input and enforce organisation scoping. Below are expected REST endpoints; equivalent documented server actions are acceptable if the UI and tests verify the same behaviour.

| Operation | Method & path | Authorisation | Notes |
|---|---|---|---|
| List / filter incidents | `GET /api/incidents` | Viewer+ | Pagination and filters |
| Create incident | `POST /api/incidents` | Analyst+ | Persist + audit |
| Read incident | `GET /api/incidents/:id` | Viewer+ | Scoped by org |
| Update incident | `PATCH /api/incidents/:id` | Analyst+ | Status change audit |
| Assets | `GET/POST /api/assets` | GET Viewer+, POST Analyst+ | Tenant-scoped |
| Dependencies | `GET/POST /api/dependencies` | GET Viewer+, POST Analyst+ | Validate both assets |
| Delete dependency | `DELETE /api/dependencies/:id` | Analyst+ | Audit mutation |
| Evidence | `GET/POST /api/incidents/:id/evidence` | GET Viewer+, POST Analyst+ | Manual evidence |
| Import evidence | `POST /api/incidents/:id/import` | Analyst+ | CSV or JSON, row errors |
| Timeline | `GET /api/incidents/:id/timeline` | Viewer+ | Time-ordered |
| Blast radius | `GET /api/incidents/:id/blast-radius` | Viewer+ | Pure graph engine |
| Hypotheses | `GET/POST/PATCH /api/incidents/:id/hypotheses` | Viewer+/Analyst+ | Source validation |
| Tasks | `GET/POST/PATCH /api/incidents/:id/tasks` | Viewer+/Analyst+ | Manual only |
| Notes | `GET/POST /api/incidents/:id/notes` | Viewer+/Analyst+ | Persist |
| Analyze | `POST /api/incidents/:id/analyze` | Analyst+ | AI optional, safe fallback |
| Generate report | `POST /api/incidents/:id/reports` | Analyst+ | Immutable snapshot |
| Get reports | `GET /api/incidents/:id/reports` | Viewer+ | Version history |
| Export report | `GET /api/reports/:id/export?format=json` | Viewer+ | JSON with provenance |
| Integration status | `GET /api/integrations` | Viewer+ | Never leak secrets |
| Microsoft sync | `POST /api/integrations/microsoft/sync` | Owner only | Config required; read-only Graph |
| Audit log | `GET /api/audit` | Owner or Analyst | Filter/paginate |

Use predictable JSON error bodies: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }` with proper 400/401/403/404/409/429/500 statuses. Do not reveal another organisation's record existence: 404 when trying to access a foreign record. No unauthenticated endpoints exposing investigation data.

### Additional operations

- Return CSV with correct `Content-Type`, safe download filename, and proper quote escaping.
- Report print view can be an authenticated route, with print CSS and no need for Puppeteer.
- Timestamp comparisons use UTC on the server. UI may show user's local time optionally, but label it and permit UTC.
- API pagination should have upper bounds to prevent giant responses.

---

## 8. OPTIONAL MICROSOFT GRAPH CONNECTOR (READ ONLY)

The MVP's default case study is public/reconstructed, **not** access to Microsoft's internal environment. For a company's own tenant, provide an optional authorised Microsoft Graph connector.

**Read-only scope:** Microsoft 365 Service Health. Microsoft documentation currently specifies `ServiceHealth.Read.All` for tenant service-health information. Follow official Entra app registration / admin consent and current API docs, and do not invent permissions.

**Minimal implementation approach:**

1. On server startup or manual sync, check `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`. If absent, show `NOT_CONFIGURED` and setup instructions.
2. Obtain application access token via the Entra tenant's OAuth 2 client-credentials endpoint. Keep tokens server-only; cache appropriately with expiry; never log token values.
3. Call Microsoft Graph v1.0 tenant service-health endpoints, e.g. `GET /admin/serviceAnnouncement/healthOverviews` and documented related service issue records (check API response and permissions). Use request timeouts, pagination where required, 429 backoff, error classification, and minimum necessary data.
4. Persist origin (`CUSTOMER_OBSERVED` where an authorised tenant service record is the source; alternatively add `PROVIDER_TENANT_NOTICE` category), provider event IDs, timestamps, and retrieved-at metadata. Do **not** conflate the fact that the tenant was notified with proof that all dependent customer assets were down.
5. On sync success, show retrieved issue count, last checked time, and link to source. On failure, preserve existing data and show an actionable error without exposing credentials.
6. Ensure `POST /api/integrations/microsoft/sync` can only be invoked by organisation owners. For MVP, an environment-configured connector can belong to **one explicitly selected local demo organisation**; do not imply shared process env secrets can safely serve arbitrary customer tenants.

**Explicit future integrations (not silently faked):** Microsoft Entra sign-in logs via Graph (`AuditLog.Read.All` and appropriate tenant roles), Microsoft Sentinel incident API, Azure Monitor, AWS CloudWatch/CloudTrail. The data model should be extensible, but do not block the MVP on these.

---

## 9. SEED SCENARIOS — MUST BE PROVIDED AND WORK

Create organisation: **Northstar Demo Operations**. At least two local users:

- `owner@cloudtrace.local` — `OWNER`
- `analyst@cloudtrace.local` — `ANALYST`
- optional `viewer@cloudtrace.local` — `VIEWER`

Use `DEMO_SEED_PASSWORD` from `.env` to create hashed passwords. These are development-only demonstration accounts. Do not enable a fixed publicly known production credential or a login bypass. Seed command must refuse unsafe production defaults.

### Scenario A: Microsoft 365 technical outage reconstruction

Case Number: `CT-2026-001`  
Title: `Microsoft 365 / Exchange Online — Historical Provider Outage`  
Type: `PROVIDER_OUTAGE`  
Classification: `PROVIDER_TECHNICAL`  
Severity: `HIGH`  
Status: `RESOLVED`  
Reported interval: `2026-11-12T16:20:00Z` to `2026-11-13T16:10:00Z`  
Demonstration label: `PUBLIC REPORTS + SYNTHETIC CUSTOMER DATA`

Assets (examples):
- Exchange Online — `MICROSOFT_365`, critical.
- Outlook Mail Access — `MICROSOFT_365`, critical; depends on Exchange Online.
- CRM Email Sync — `INTERNAL`, high; depends on Exchange Online.
- Customer Support Inbox — `INTERNAL`, high; depends on Exchange Online.
- Azure-hosted Customer Portal — `AZURE`, high; **independent of Exchange Online**, unless a specific actual email flow dependency is explicitly modelled. It should **not** be auto-classified affected from the M365 outage.
- Teams Calendar Sync — `MICROSOFT_365`, medium; depends on Exchange Online.

Events and evidence:
1. Provider reported Exchange Online connectivity disruption (public reference, `PUBLIC_REPORTED`, citation URL).
2. Provider notice of affected Microsoft 365-connected capabilities (`PUBLIC_REPORTED`).
3. Fictional company's CRM sync errors `503` and retries (`SYNTHETIC`); link to CRM asset.
4. Fictional support mailbox API timeout (`SYNTHETIC`); link to support inbox asset.
5. Provider restoration reported at interval end (`PUBLIC_REPORTED`).
6. Synthetic positive post-recovery health check for CRM (`SYNTHETIC`).

Important: ensure the map visually distinguishes **reported provider impact**, **fictional customer impact**, **only at-risk dependency**, and **unrelated/unknown assets**.

Hypotheses:
- "Provider-side gateway/capacity issue led to access disruption" as `SUPPORTED` by public source with caveat "provider-reported preliminary explanation".
- "Malicious intrusion caused the outage" as `UNRESOLVED` or `REJECTED` due to lack of supporting evidence / contrary service communication. Do not claim malicious attack without evidence.

Seed 3 actionable tasks: confirm tenant-specific effect; validate CRM resumption; update business continuity runbook. Two completed, one open is acceptable as long as coherent.

### Scenario B: synthetic suspicious sign-in activity

Case Number: `CT-2026-002`  
Title: `Unusual Authentication Pattern — Fictional Tenant`  
Type: `SECURITY_SUSPICION`  
Classification: `SECURITY_SUSPECTED`  
Severity: `MEDIUM`  
Status: `INVESTIGATING`  
Demonstration label: `100% SYNTHETIC SECURITY EXERCISE`

Seed events such as multiple failed sign-ins from documentation-only IP addresses, followed by a successful sign-in in the *fictional* account. **Do not** automatically label this "account compromised"; require analyst investigation and hypothesis confidence. Add a related fictional identity service dependency and follow-up tasks (review MFA enrolment, verify legitimate owner activity). No real personal identities or secrets.

### Scenario C (optional)

A small synthetic Azure configuration-change degradation incident to prove platform independence from the Microsoft story.

---

## 10. REPORT TEMPLATE

Report headings, in order:

1. Incident identification (case number, period, severity, author, generated UTC).
2. Scope and affected systems.
3. Executive summary and classification (distinguish analyst conclusion vs provider statement).
4. What is known / what remains unverified.
5. Chronological evidence timeline (event ID → evidence ID → source/provenance).
6. Dependency and blast-radius assessment (confirmed vs potentially affected).
7. Hypotheses, supporting evidence, contradicting evidence, confidence and analyst status.
8. Response actions taken / pending (the app must not claim to have executed anything).
9. Lessons learned and resilience recommendations.
10. Data gaps, limitations and simulation disclaimer.
11. References / evidence registry with source URLs and SHA-256s.

Generate snapshot versions `v1`, `v2`, etc.; a report's number is sequential per incident. Provide a print-optimised HTML page with no left sidebar and readable black-on-white PDF printing. Include a `Copy summary` action that works. Require at least one evidence item to produce a report; otherwise show a specific prompt to add evidence.

---

## 11. SECURITY AND PRIVACY REQUIREMENTS

Treat this as a cybersecurity product. The security controls are not optional just because it's an MVP.

- Server-validated authentication and org-scoped authorisation at every route/action.
- Password hashes only; no plaintext credentials in DB or version control.
- Use CSRF/session protections as supported by the selected auth library and secure cookies in production.
- Verify write-role permissions on server (OWNER/ANALYST; VIEWER read-only).
- Guard all record lookups and foreign-key references by `organizationId`.
- Validate JSON/CSV schema, file size, filename, date values and row count; protect against CSV formula injection on export (`=`, `+`, `-`, `@` leading values); escape HTML.
- Implement simple rate limiting for sign-in and high-cost `analyze`/`sync` operations suitable for development; document production-grade distributed limits as future work.
- Never execute shell commands from evidence content or fetch network URLs embedded in evidence automatically.
- Protect optional provider secrets and AI keys in server-only env; redact all errors/logs.
- Implement analysis prompt-injection safeguards: input logs and evidence are data; they cannot override AI system instructions, change permissions or cause external calls.
- Use a content security policy where feasible, secure headers, sanitised Markdown rendering or plain-text content for imported logs.
- Immutable audit append operations for material changes; show origin and time.
- No evidence erasure from a report snapshot after generation. If a referenced evidence row is archived, the report retains its preserved source information.
- Privacy minimisation: in demo use synthetic identifiers only; do not upload live sensitive customer data by default.
- **No automated containment.** Response tasks remain advisory until a human explicitly takes an action outside the product.
- Document limitations: local SQLite and environment-based integration secrets are **not** enterprise-certified production infrastructure.

---

## 12. IMPLEMENTATION ORDER — DO NOT STOP AT WIREFRAMES

**Stage 1: Project scaffold and DB**
- Initialise Next.js TypeScript + Tailwind + UI primitives.
- Prisma schema, local SQLite, authentication, org membership / RBAC helpers.
- `.env.example`, idempotent seed script, working dev scripts.
- Create seeded users, incidents, assets, dependencies, evidence, events, tasks and initial reports as specified.

**Stage 2: End-to-end investigation workflow**
- Incident list and detail tabs.
- Evidence model, timeline, manual-add/import.
- Dependency traversal unit with real algorithm, visual graph, impact statuses.
- Hypotheses, tasks, notes, audit log.

**Stage 3: Analysis, reports and polish**
- Rule-based analysis and deterministic summary.
- Optional Anthropic call with schema validation / fallback.
- Report generation and print / JSON / CSV export.
- Command Overview widgets from DB + comprehensive UI responsiveness.

**Stage 4: Integrations and testing**
- Optional read-only Microsoft Graph sync if credentials exist, safe Not Configured state otherwise.
- Unit tests, role isolation tests, E2E critical path, handling empty states, error states.
- Run `npm run typecheck`, `npm run test`, `npm run build` and report outcomes.

**Suggested project code layout (adapt intelligently):**

```text
cloudtrace/
  app/
    (auth)/login/page.tsx
    (dashboard)/overview/page.tsx
    (dashboard)/incidents/page.tsx
    (dashboard)/incidents/[id]/page.tsx
    (dashboard)/assets/page.tsx
    (dashboard)/evidence/page.tsx
    (dashboard)/reports/page.tsx
    (dashboard)/integrations/page.tsx
    (dashboard)/activity/page.tsx
    (dashboard)/settings/page.tsx
    api/...
  components/
    app-shell/ incident/ evidence/ dependency-graph/ investigation/ reports/ ui/
  lib/
    auth/ db/ permissions/ evidence/ correlation/ blast-radius/
    analysis/ reports/ integrations/microsoft/ audit/ validation/
  prisma/
    schema.prisma
    seed.ts
  tests/
    unit/ integration/ e2e/
  public/
  .env.example
  README.md
  IMPLEMENTATION_NOTES.md
  package.json
```

---

## 13. ACCEPTANCE TESTS — MUST PASS

1. **First boot:** Following documented setup, seed and dev scripts produce a working app without Azure, Anthropic, Microsoft or paid credentials.
2. **Login:** Demo owner/analyst can sign in; wrong passwords fail; viewer has read-only permissions.
3. **Persistence:** Create an incident and refresh browser; the incident remains in the database.
4. **Search/filter:** Search seeded case number and filter by incident type/status/severity; correct matching results are shown.
5. **Incident workflow:** Change status and create notes; audit log records actor and timestamp.
6. **Evidence import:** Import valid CSV/JSON; evidence appears on timeline with provenance, observed timestamp, and SHA-256.
7. **Malformed import:** Missing timestamp/invalid enum/oversized file yields actionable error without partial unreported writes.
8. **Timeline:** Sorting is by event time, not file upload time; evidence inspector links to original record.
9. **Dependency algorithm:** For `A depends_on B`, B failing makes A **at risk** but not automatically confirmed down. With separate direct evidence for A, A becomes confirmed affected.
10. **Independence:** The Azure-hosted customer portal from Scenario A is not automatically affected by Exchange Online unless a directed dependency exists.
11. **Cycle handling:** Circular asset dependencies do not freeze the graph or cause infinite traversal.
12. **Hypotheses:** Create, update and link evidence; setting supported with no supporting evidence is blocked.
13. **Analysis without API key:** Clicking Analyze produces a useful **rule-based** output labelled as such, not an invented Claude response.
14. **AI fallback:** Wrong/missing Anthropic config returns a clear error/mode indicator and retains working deterministic analysis.
15. **Report:** Generate a numbered, persisted report; print view works; JSON and CSV download real data; later case changes do not alter old snapshot.
16. **Cross-organisation access:** A user in Org A cannot read or mutate Org B's incidents/evidence/assets, even with a known direct URL or ID. Viewer POST/PUT/PATCH/DELETE must return 403.
17. **Integration status:** With no Microsoft config, UI says Not Configured. It must never display a fabricated "Connected" status or live data.
18. **Security:** Imported HTML/script is rendered safely; no `dangerouslySetInnerHTML` for arbitrary evidence; no keys exposed in client JS.
19. **Accessibility:** Forms, dialogs, graph controls, sorting and tabs work via keyboard or appropriate accessible alternatives.
20. **Build:** TypeScript typecheck, test suite and production build succeed; if environment prevents E2E browser run, state that truthfully and provide the command.

### Developer test fixtures

Use the supplied `fixtures/public_plus_simulated_case.json` and `fixtures/synthetic_signins.csv` as reference imports where helpful. All fixture records must be clearly labelled `SYNTHETIC` except a properly cited public status item. The case number from an import must resolve to an incident **within the current authenticated organisation**.

---

## 14. IMPLEMENTATION QUALITY BAR

- Avoid dead buttons, placeholder charts, decorative fake "AI reasoning" text, unbacked telemetry counts and nonfunctional settings.
- Use stable, consistent event naming and enum handling across API, DB and UI.
- Every list supports empty/error/loading states and meaningful content.
- Debounce client search if queries are server-backed; never load all incidents unbounded.
- Keep dependencies reasonable and avoid loading giant vendor SDKs into the client bundle.
- Ensure the app renders consistent synthetic/public labels on **every** relevant screen, graph tooltip and export.
- Keep source code readable and modular; document any shortcuts in `IMPLEMENTATION_NOTES.md`.
- Seed fictional data as a deliberately labelled exercise with meaningful dates and cross-links — never generated "live" event streams.

---

## 15. DELIVERY CHECKLIST FOR CLAUDE CODE

At the end, supply:

- [ ] Working source code and local database schema.
- [ ] A populated idempotent seed process and demo sign-in instructions.
- [ ] Fully functional incidents/investigations/evidence/graph/hypotheses/tasks/reports screens.
- [ ] Working JSON/CSV import, deterministic analysis, and immutable report snapshots.
- [ ] Optional external integrations with honest disconnected states.
- [ ] Security and cross-tenant isolation checks.
- [ ] Automated tests and final typecheck/build/test output.
- [ ] README with exact install, run, seed, test, and troubleshooting commands.
- [ ] `IMPLEMENTATION_NOTES.md` with what is complete and what remains a future integration.

### Final direction

**Build CloudTrace now. Start with a functional application. Keep the design premium, but let evidence integrity and working investigation workflows take priority. Don't claim production-grade forensics or cloud integration where the implementation does not support them.**
