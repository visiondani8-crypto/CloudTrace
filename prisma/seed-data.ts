/**
 * Demonstration scenarios. Public items cite their sources and are labelled
 * PUBLIC_REPORTED; everything else is SYNTHETIC (fictional company, fictional
 * accounts, documentation-only IP ranges 192.0.2.0/24 and 198.51.100.0/24).
 * No internal Microsoft logs and no affected-company counts are fabricated.
 */

export const UPENN_MIRROR = "https://mailservices.isc.upenn.edu/computing/email/penno365/alerts/ms-incidents.html";
export const PIR_SUMMARY = "https://www.365fanatic.com/m365-outage-12-november-2026/";

export const ORG = { name: "Northstar Demo Operations", slug: "northstar-demo" };
export const ISOLATION_ORG = { name: "Harbor Isolation Test Org", slug: "harbor-isolation-test" };

export const USERS = [
  { email: "owner@cloudtrace.local", name: "Avery Lindqvist", role: "OWNER" },
  { email: "analyst@cloudtrace.local", name: "Jordan Okafor", role: "ANALYST" },
  { email: "viewer@cloudtrace.local", name: "Riley Moreau", role: "VIEWER" },
] as const;

export const ISOLATION_USER = { email: "isolation.owner@cloudtrace.local", name: "Harbor Test Owner", role: "OWNER" } as const;

export interface SeedAsset {
  key: string;
  name: string;
  provider: string;
  assetType: string;
  owner: string;
  criticality: string;
  description: string;
  isSynthetic: boolean;
}

export const ASSETS: SeedAsset[] = [
  {
    key: "exchange",
    name: "Exchange Online",
    provider: "MICROSOFT_365",
    assetType: "SaaS mail service",
    owner: "Microsoft (provider-operated)",
    criticality: "CRITICAL",
    description: "Provider-operated mail platform used by Northstar (fictional tenant). Health is known only through provider reports or tenant observations.",
    isSynthetic: false,
  },
  {
    key: "outlook",
    name: "Outlook Mail Access",
    provider: "MICROSOFT_365",
    assetType: "Client access",
    owner: "IT Operations",
    criticality: "CRITICAL",
    description: "Staff mailbox access through Outlook clients and the web.",
    isSynthetic: true,
  },
  {
    key: "crm",
    name: "CRM Email Sync",
    provider: "INTERNAL",
    assetType: "Integration service",
    owner: "Sales Engineering",
    criticality: "HIGH",
    description: "Fictional service that synchronises CRM activity with Exchange mailboxes.",
    isSynthetic: true,
  },
  {
    key: "support",
    name: "Customer Support Inbox",
    provider: "INTERNAL",
    assetType: "Shared mailbox workflow",
    owner: "Customer Support",
    criticality: "HIGH",
    description: "Fictional helpdesk workflow reading a Microsoft-hosted shared mailbox.",
    isSynthetic: true,
  },
  {
    key: "teams-cal",
    name: "Teams Calendar Sync",
    provider: "MICROSOFT_365",
    assetType: "Collaboration integration",
    owner: "Workplace Technology",
    criticality: "MEDIUM",
    description: "Calendar availability shared between Exchange and Teams.",
    isSynthetic: true,
  },
  {
    key: "finance",
    name: "Finance Approval Workflow",
    provider: "INTERNAL",
    assetType: "Business workflow",
    owner: "Finance Operations",
    criticality: "MEDIUM",
    description: "Fictional approval workflow that relies on staff receiving mail in Outlook.",
    isSynthetic: true,
  },
  {
    key: "portal",
    name: "Azure-hosted Customer Portal",
    provider: "AZURE",
    assetType: "Web application",
    owner: "Digital Platform",
    criticality: "HIGH",
    description: "Fictional customer portal on Azure. Intentionally modelled with no dependency on Exchange Online.",
    isSynthetic: true,
  },
  {
    key: "gateway",
    name: "Portal API Gateway",
    provider: "AZURE",
    assetType: "API management",
    owner: "Digital Platform",
    criticality: "HIGH",
    description: "Fictional API gateway in front of portal services.",
    isSynthetic: true,
  },
  {
    key: "portal-db",
    name: "Customer Portal Database",
    provider: "AZURE",
    assetType: "Managed SQL database",
    owner: "Data Platform",
    criticality: "CRITICAL",
    description: "Fictional managed database backing the customer portal.",
    isSynthetic: true,
  },
  {
    key: "idp",
    name: "Demo Identity Provider",
    provider: "OTHER",
    assetType: "Identity provider",
    owner: "Identity & Access",
    criticality: "HIGH",
    description: "Fictional identity service used by the simulated security exercise.",
    isSynthetic: true,
  },
];

/** consumer DEPENDS_ON provider */
export const DEPENDENCIES: { consumer: string; provider: string; description: string }[] = [
  { consumer: "outlook", provider: "exchange", description: "Mailbox access is served by Exchange Online." },
  { consumer: "crm", provider: "exchange", description: "CRM mailbox synchronisation calls Exchange Online APIs." },
  { consumer: "support", provider: "exchange", description: "Helpdesk reads the shared mailbox hosted in Exchange Online." },
  { consumer: "teams-cal", provider: "exchange", description: "Calendar data is stored in Exchange Online." },
  { consumer: "finance", provider: "outlook", description: "Approvers act on approval emails in Outlook." },
  { consumer: "portal", provider: "gateway", description: "Portal front end calls services through the gateway." },
  { consumer: "gateway", provider: "portal-db", description: "Gateway-backed services read customer records." },
  { consumer: "portal", provider: "idp", description: "Customer sign-in uses the identity provider." },
];

export interface SeedEvidence {
  key: string;
  observedAt: string;
  title: string;
  category: string;
  provenance: "PUBLIC_REPORTED" | "SYNTHETIC" | "CUSTOMER_OBSERVED" | "ANALYST_NOTE";
  sourceName: string;
  sourceEventId: string;
  sourceUri: string | null;
  asset: string | null;
  assetStatus: "HEALTHY" | "DEGRADED" | "DOWN" | null;
  confidenceLevel: string;
  contentText: string;
}

export interface SeedIncident {
  caseNumber: string;
  title: string;
  description: string;
  type: string;
  severity: string;
  status: string;
  classification: string;
  startedAt: string | null;
  resolvedAt: string | null;
  owner: string;
  dataLabel: string;
  scope: string[];
  evidence: SeedEvidence[];
  analystEvents: { occurredAt: string; title: string; description: string; asset: string | null }[];
  hypotheses: {
    title: string;
    description: string;
    confidence: string;
    status: string;
    note: string | null;
    supporting: string[];
    contradicting: string[];
    author: string;
  }[];
  tasks: {
    title: string;
    description: string;
    priority: string;
    status: string;
    assignee: string | null;
    dueAt: string | null;
    completedAt: string | null;
    evidence: string[];
  }[];
  notes: { author: string; text: string }[];
  sources: { title: string; url: string; publisher: string; status: string; note: string }[];
}

const SOURCES_M365 = [
  {
    title: "Microsoft 365 service incidents (University of Pennsylvania mirror of Microsoft service health updates)",
    url: UPENN_MIRROR,
    publisher: "University of Pennsylvania ISC",
    status: "PRELIMINARY",
    note: "Mirror of provider status communications for EX1550543 / MO1550821. Provider statements are preliminary and may be amended.",
  },
  {
    title: "Microsoft 365 outage 12 November 2026 — public summary of the preliminary post-incident report",
    url: PIR_SUMMARY,
    publisher: "365Fanatic",
    status: "PRELIMINARY",
    note: "Third-party summary referencing the provider's preliminary PIR. Linked, not copied; a final report may supersede it.",
  },
  {
    title: "Microsoft Graph: get serviceHealth",
    url: "https://learn.microsoft.com/en-us/graph/api/servicehealth-get?view=graph-rest-1.0",
    publisher: "Microsoft Learn",
    status: "DOCUMENTATION",
    note: "Reference for the optional read-only tenant connector (ServiceHealth.Read.All).",
  },
  {
    title: "Microsoft Graph: list signIns",
    url: "https://learn.microsoft.com/en-us/graph/api/signin-list?view=graph-rest-1.0",
    publisher: "Microsoft Learn",
    status: "DOCUMENTATION",
    note: "Future integration reference only; sign-in logs are not connected in this MVP.",
  },
  {
    title: "Microsoft Sentinel incidents REST API",
    url: "https://learn.microsoft.com/en-us/rest/api/securityinsights/incidents?view=rest-securityinsights-2025-09-01",
    publisher: "Microsoft Learn",
    status: "ROADMAP_REFERENCE",
    note: "Roadmap reference only; no Sentinel integration is implemented.",
  },
];

export const INCIDENTS: SeedIncident[] = [
  {
    caseNumber: "CT-2026-001",
    title: "Microsoft 365 / Exchange Online — Historical Provider Outage",
    description:
      "Reconstruction of the 12–13 November 2026 Microsoft 365 / Exchange Online service disruption (provider incident IDs EX1550543 and MO1550821) using public provider communications, combined with simulated telemetry from the fictional Northstar organisation. The provider describes a technical issue; there is no evidence of a cyberattack. Provider-reported causes are not independently verified.",
    type: "PROVIDER_OUTAGE",
    severity: "HIGH",
    status: "RESOLVED",
    classification: "PROVIDER_TECHNICAL",
    startedAt: "2026-11-12T16:20:00Z",
    resolvedAt: "2026-11-13T16:10:00Z",
    owner: "analyst@cloudtrace.local",
    dataLabel: "PUBLIC REPORT + SIMULATED",
    scope: ["exchange", "outlook", "crm", "support", "teams-cal", "portal"],
    evidence: [
      {
        key: "m365-start",
        observedAt: "2026-11-12T16:20:00Z",
        title: "Provider-reported Microsoft 365 / Exchange Online service disruption",
        category: "PROVIDER_NOTICE",
        provenance: "PUBLIC_REPORTED",
        sourceName: "Microsoft service-health communication (mirrored by UPenn)",
        sourceEventId: "EX1550543-START-PUBLIC",
        sourceUri: UPENN_MIRROR,
        asset: "exchange",
        assetStatus: "DEGRADED",
        confidenceLevel: "CONFIRMED_BY_SOURCE",
        contentText:
          "Provider-reported incident start (EX1550543) affecting Exchange Online access. The provider describes a technical issue; this record is not evidence of a cyberattack. Exact wording and any later amendments are in the linked source; internal root-cause details remain provider-reported.",
      },
      {
        key: "m365-scope",
        observedAt: "2026-11-12T16:20:00Z",
        title: "Provider tracking entry MO1550821 for Microsoft 365-connected capabilities",
        category: "PROVIDER_NOTICE",
        provenance: "PUBLIC_REPORTED",
        sourceName: "Microsoft service-health communication (mirrored by UPenn)",
        sourceEventId: "MO1550821-SCOPE-PUBLIC",
        sourceUri: UPENN_MIRROR,
        asset: "exchange",
        assetStatus: "DEGRADED",
        confidenceLevel: "CONFIRMED_BY_SOURCE",
        contentText:
          "Second public incident identifier (MO1550821) covering Microsoft 365-connected capabilities that depend on Exchange Online. Timestamp recorded as the reported impact start; the source's own entry time may differ. A provider notice establishes provider-side impact, not that every customer workload failed.",
      },
      {
        key: "crm-503",
        observedAt: "2026-11-12T17:04:00Z",
        title: "Fictional CRM email synchronisation receives 503 responses",
        category: "APP_LOG",
        provenance: "SYNTHETIC",
        sourceName: "Northstar CRM synthetic log fixture",
        sourceEventId: "SYNTHETIC-CRM-001",
        sourceUri: null,
        asset: "crm",
        assetStatus: "DEGRADED",
        confidenceLevel: "UNVERIFIED",
        contentText:
          "Demo-only error: CRM mailbox synchronization retries after upstream HTTP 503. This event is fictional and does not describe a real Microsoft customer's telemetry.",
      },
      {
        key: "helpdesk-timeout",
        observedAt: "2026-11-12T17:11:00Z",
        title: "Fictional support mailbox access timeout",
        category: "APP_LOG",
        provenance: "SYNTHETIC",
        sourceName: "Northstar Helpdesk synthetic fixture",
        sourceEventId: "SYNTHETIC-HELPDESK-001",
        sourceUri: null,
        asset: "support",
        assetStatus: "DEGRADED",
        confidenceLevel: "UNVERIFIED",
        contentText:
          "Fictional company helpdesk agent unable to read Microsoft-hosted mailbox. This is simulation data, not a real affected organisation.",
      },
      {
        key: "crm-backlog",
        observedAt: "2026-11-12T17:26:00Z",
        title: "Fictional CRM sync retry backlog grows",
        category: "APP_LOG",
        provenance: "SYNTHETIC",
        sourceName: "Northstar CRM synthetic log fixture",
        sourceEventId: "SYNTHETIC-CRM-002",
        sourceUri: null,
        asset: "crm",
        assetStatus: "DEGRADED",
        confidenceLevel: "UNVERIFIED",
        contentText:
          "Demo-only: 312 queued CRM mailbox sync jobs awaiting retry after repeated upstream 503 responses. Fictional record for the exercise.",
      },
      {
        key: "m365-restored",
        observedAt: "2026-11-13T16:10:00Z",
        title: "Provider-reported service restoration",
        category: "PROVIDER_NOTICE",
        provenance: "PUBLIC_REPORTED",
        sourceName: "Microsoft service-health communication (mirrored by UPenn)",
        sourceEventId: "MO1550821-RESTORED-PUBLIC",
        sourceUri: UPENN_MIRROR,
        asset: "exchange",
        assetStatus: "HEALTHY",
        confidenceLevel: "CONFIRMED_BY_SOURCE",
        contentText:
          "Provider stated the service was restored at 16:10 UTC on 13 November 2026. The preliminary report may be superseded.",
      },
      {
        key: "crm-recovered",
        observedAt: "2026-11-13T16:40:00Z",
        title: "Fictional post-recovery CRM health check passes",
        category: "HEALTH_EVENT",
        provenance: "SYNTHETIC",
        sourceName: "Northstar CRM synthetic health probe",
        sourceEventId: "SYNTHETIC-CRM-HEALTH-001",
        sourceUri: null,
        asset: "crm",
        assetStatus: "HEALTHY",
        confidenceLevel: "UNVERIFIED",
        contentText:
          "Demo-only health probe: CRM mailbox synchronisation completed 3 consecutive cycles without errors after provider restoration. Fictional record.",
      },
    ],
    analystEvents: [
      {
        occurredAt: "2026-11-12T17:15:00Z",
        title: "Northstar incident bridge opened",
        description: "Analyst-entered: internal bridge opened after CRM and helpdesk alerts. No system record attached.",
        asset: null,
      },
    ],
    hypotheses: [
      {
        title: "Provider-side gateway/capacity issue led to access disruption",
        description:
          "Exchange Online access was disrupted by a provider-side technical issue, which caused the simulated CRM and helpdesk failures through their dependency on Exchange Online.",
        confidence: "MEDIUM",
        status: "SUPPORTED",
        note: "Provider-reported preliminary explanation; not independently verified from provider infrastructure. A final post-incident report may amend it.",
        supporting: ["m365-start", "m365-scope", "m365-restored"],
        contradicting: [],
        author: "analyst@cloudtrace.local",
      },
      {
        title: "Malicious intrusion caused the outage",
        description: "Considered and rejected: no evidence of intrusion was recorded, and the provider communication describes a technical issue.",
        confidence: "LOW",
        status: "REJECTED",
        note: "No supporting evidence. Re-open only if new evidence is recorded.",
        supporting: [],
        contradicting: ["m365-start", "m365-scope"],
        author: "analyst@cloudtrace.local",
      },
    ],
    tasks: [
      {
        title: "Confirm tenant-specific effect from authorised service-health records",
        description: "Connect the read-only Microsoft 365 service-health connector (or review the admin centre) to confirm whether the Northstar tenant received the EX1550543 / MO1550821 notices.",
        priority: "HIGH",
        status: "OPEN",
        assignee: "analyst@cloudtrace.local",
        dueAt: "2026-11-20T17:00:00Z",
        completedAt: null,
        evidence: ["m365-start"],
      },
      {
        title: "Validate CRM email sync resumption",
        description: "Check that the CRM sync backlog drained after provider restoration.",
        priority: "HIGH",
        status: "DONE",
        assignee: "analyst@cloudtrace.local",
        dueAt: "2026-11-13T18:00:00Z",
        completedAt: "2026-11-13T16:45:00Z",
        evidence: ["crm-backlog", "crm-recovered"],
      },
      {
        title: "Update business continuity runbook for mail-provider outages",
        description: "Add fallback communication channels for support and finance approvals during mail outages.",
        priority: "MEDIUM",
        status: "DONE",
        assignee: "owner@cloudtrace.local",
        dueAt: "2026-11-15T17:00:00Z",
        completedAt: "2026-11-14T15:30:00Z",
        evidence: [],
      },
    ],
    notes: [
      {
        author: "analyst@cloudtrace.local",
        text: "Treating this as a provider technical disruption per public communications. Simulated CRM and helpdesk errors overlap the provider window; Outlook, Teams calendar and finance approvals are at risk only — no direct observations recorded. The Azure-hosted customer portal has no modelled dependency on Exchange Online.",
      },
    ],
    sources: SOURCES_M365,
  },
  {
    caseNumber: "CT-2026-002",
    title: "Unusual Authentication Pattern — Fictional Tenant",
    description:
      "Simulated security exercise: repeated failed sign-ins from a documentation-range IP address against a fictional account, followed by a successful sign-in from a different documentation-range address. This does not by itself establish account compromise; analyst investigation is required. All records are synthetic.",
    type: "SECURITY_SUSPICION",
    severity: "MEDIUM",
    status: "INVESTIGATING",
    classification: "SECURITY_SUSPECTED",
    startedAt: "2026-11-14T08:58:00Z",
    resolvedAt: null,
    owner: "analyst@cloudtrace.local",
    dataLabel: "100% SIMULATED SECURITY EXERCISE",
    scope: ["idp"],
    evidence: [
      {
        key: "auth-0",
        observedAt: "2026-11-14T08:58:00Z",
        title: "Fictional failed sign-in 0",
        category: "AUTH_EVENT",
        provenance: "SYNTHETIC",
        sourceName: "Synthetic identity-monitoring fixture",
        sourceEventId: "SYN-AUTH-000",
        sourceUri: null,
        asset: "idp",
        assetStatus: null,
        confidenceLevel: "UNVERIFIED",
        contentText: "Failed login (invalid password) for fictional account test.user@example.invalid from 192.0.2.25. Synthetic record.",
      },
      {
        key: "auth-1",
        observedAt: "2026-11-14T09:01:00Z",
        title: "Fictional failed sign-in 1",
        category: "AUTH_EVENT",
        provenance: "SYNTHETIC",
        sourceName: "Synthetic identity-monitoring fixture",
        sourceEventId: "SYN-AUTH-001",
        sourceUri: null,
        asset: "idp",
        assetStatus: null,
        confidenceLevel: "UNVERIFIED",
        contentText: "Failed login for fictional account test.user@example.invalid from 192.0.2.25. Synthetic record.",
      },
      {
        key: "auth-2",
        observedAt: "2026-11-14T09:02:00Z",
        title: "Fictional failed sign-in 2",
        category: "AUTH_EVENT",
        provenance: "SYNTHETIC",
        sourceName: "Synthetic identity-monitoring fixture",
        sourceEventId: "SYN-AUTH-002",
        sourceUri: null,
        asset: "idp",
        assetStatus: null,
        confidenceLevel: "UNVERIFIED",
        contentText: "Repeated failed login from documentation IP 192.0.2.25. Synthetic record.",
      },
      {
        key: "auth-3",
        observedAt: "2026-11-14T09:05:00Z",
        title: "Fictional successful sign-in",
        category: "AUTH_EVENT",
        provenance: "SYNTHETIC",
        sourceName: "Synthetic identity-monitoring fixture",
        sourceEventId: "SYN-AUTH-003",
        sourceUri: null,
        asset: "idp",
        assetStatus: null,
        confidenceLevel: "UNVERIFIED",
        contentText: "Successful login from 198.51.100.17. Requires verification; does not prove account takeover. Synthetic record.",
      },
      {
        key: "idp-health",
        observedAt: "2026-11-14T09:20:00Z",
        title: "Fictional identity provider health check passes",
        category: "HEALTH_EVENT",
        provenance: "SYNTHETIC",
        sourceName: "Synthetic identity-monitoring fixture",
        sourceEventId: "SYN-IDP-HEALTH-001",
        sourceUri: null,
        asset: "idp",
        assetStatus: "HEALTHY",
        confidenceLevel: "UNVERIFIED",
        contentText: "Demo-only availability probe for the fictional identity provider succeeded. Service availability says nothing about whether the sign-in was legitimate. Synthetic record.",
      },
    ],
    analystEvents: [],
    hypotheses: [
      {
        title: "Credential guessing against the fictional account preceded a successful sign-in",
        description: "Failed attempts from 192.0.2.25 followed by a success from 198.51.100.17 could indicate password guessing and account misuse. Not verified.",
        confidence: "LOW",
        status: "OPEN",
        note: "Hypothesis — not verified. Needs owner confirmation and MFA review.",
        supporting: ["auth-0", "auth-1", "auth-2", "auth-3"],
        contradicting: [],
        author: "analyst@cloudtrace.local",
      },
      {
        title: "The legitimate owner signed in after mistyped passwords",
        description: "Benign explanation: the account owner mistyped a password, then signed in from another network (e.g. travelling).",
        confidence: "LOW",
        status: "OPEN",
        note: "Hypothesis — not verified.",
        supporting: ["auth-3"],
        contradicting: [],
        author: "analyst@cloudtrace.local",
      },
    ],
    tasks: [
      {
        title: "Review MFA enrolment for the fictional account",
        description: "Manual follow-up in the identity provider console. CloudTrace does not change identity systems.",
        priority: "HIGH",
        status: "OPEN",
        assignee: "analyst@cloudtrace.local",
        dueAt: "2026-11-17T12:00:00Z",
        completedAt: null,
        evidence: ["auth-3"],
      },
      {
        title: "Verify the successful sign-in with the legitimate account owner",
        description: "Contact the (fictional) account owner through a known channel to confirm the 09:05 UTC sign-in.",
        priority: "HIGH",
        status: "IN_PROGRESS",
        assignee: "analyst@cloudtrace.local",
        dueAt: "2026-11-16T12:00:00Z",
        completedAt: null,
        evidence: ["auth-3"],
      },
    ],
    notes: [
      {
        author: "analyst@cloudtrace.local",
        text: "Classification stays 'security suspected'. Waiting for owner confirmation before deciding between the two open hypotheses.",
      },
    ],
    sources: [],
  },
  {
    caseNumber: "CT-2026-003",
    title: "Portal API errors after gateway policy change — Fictional Azure workload",
    description:
      "Simulated configuration-change incident on a fictional Azure-hosted API gateway, included to show CloudTrace is not specific to the Microsoft 365 story. All records are synthetic.",
    type: "CONFIGURATION_FAILURE",
    severity: "MEDIUM",
    status: "MONITORING",
    classification: "CONFIGURATION",
    startedAt: "2026-11-15T10:12:00Z",
    resolvedAt: null,
    owner: "owner@cloudtrace.local",
    dataLabel: "SIMULATED",
    scope: ["gateway", "portal"],
    evidence: [
      {
        key: "chg-deploy",
        observedAt: "2026-11-15T10:05:00Z",
        title: "Fictional gateway rate-limit policy change deployed",
        category: "CHANGE_EVENT",
        provenance: "SYNTHETIC",
        sourceName: "Synthetic Azure change log fixture",
        sourceEventId: "SYN-CHG-001",
        sourceUri: null,
        asset: "gateway",
        assetStatus: null,
        confidenceLevel: "UNVERIFIED",
        contentText: "Demo-only change record: rate-limit policy version 14 deployed to the fictional Portal API Gateway.",
      },
      {
        key: "apim-errors",
        observedAt: "2026-11-15T10:12:00Z",
        title: "Fictional gateway 5xx rate exceeds threshold",
        category: "HEALTH_EVENT",
        provenance: "SYNTHETIC",
        sourceName: "Synthetic Azure monitor fixture",
        sourceEventId: "SYN-APIM-001",
        sourceUri: null,
        asset: "gateway",
        assetStatus: "DEGRADED",
        confidenceLevel: "UNVERIFIED",
        contentText: "Demo-only metric alert: 5xx responses at 7.4% for 5 minutes (threshold 2%). Synthetic record.",
      },
      {
        key: "chg-rollback",
        observedAt: "2026-11-15T10:40:00Z",
        title: "Fictional policy change rolled back",
        category: "CHANGE_EVENT",
        provenance: "SYNTHETIC",
        sourceName: "Synthetic Azure change log fixture",
        sourceEventId: "SYN-CHG-002",
        sourceUri: null,
        asset: "gateway",
        assetStatus: null,
        confidenceLevel: "UNVERIFIED",
        contentText: "Demo-only change record: rate-limit policy reverted to version 13 by the on-call engineer.",
      },
      {
        key: "apim-recovered",
        observedAt: "2026-11-15T10:55:00Z",
        title: "Fictional gateway error rate back to baseline",
        category: "HEALTH_EVENT",
        provenance: "SYNTHETIC",
        sourceName: "Synthetic Azure monitor fixture",
        sourceEventId: "SYN-APIM-002",
        sourceUri: null,
        asset: "gateway",
        assetStatus: "HEALTHY",
        confidenceLevel: "UNVERIFIED",
        contentText: "Demo-only metric: 5xx responses at 0.3% for 15 minutes. Synthetic record.",
      },
    ],
    analystEvents: [],
    hypotheses: [
      {
        title: "The rate-limit policy change caused the gateway errors",
        description: "Errors began 7 minutes after the change and cleared after rollback. Timing supports but does not prove causation.",
        confidence: "MEDIUM",
        status: "OPEN",
        note: null,
        supporting: ["chg-deploy", "apim-errors", "chg-rollback", "apim-recovered"],
        contradicting: [],
        author: "owner@cloudtrace.local",
      },
    ],
    tasks: [
      {
        title: "Add pre-deployment validation for gateway policies",
        description: "Manual engineering follow-up; nothing is executed by CloudTrace.",
        priority: "MEDIUM",
        status: "OPEN",
        assignee: "owner@cloudtrace.local",
        dueAt: "2026-11-22T17:00:00Z",
        completedAt: null,
        evidence: ["chg-deploy"],
      },
    ],
    notes: [],
    sources: [],
  },
];

export const ISOLATION_INCIDENT = {
  caseNumber: "CT-2026-001",
  title: "Harbor isolation fixture — payroll API latency",
  description: "Synthetic record owned by a second organisation. Used to verify that Northstar users cannot read or change it.",
  asset: { name: "Harbor Payroll API", provider: "INTERNAL", assetType: "Internal API", owner: "Harbor IT", criticality: "LOW" },
  evidence: {
    observedAt: "2026-11-10T09:00:00Z",
    title: "Synthetic Harbor latency alert",
    sourceName: "Harbor synthetic fixture",
    sourceEventId: "HARBOR-SYN-001",
    contentText: "Synthetic isolation-test record. Must never be visible to Northstar users.",
  },
};
