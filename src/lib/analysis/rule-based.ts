/**
 * Deterministic, offline analysis. Every fact cites evidence IDs, overlaps are
 * described as overlaps (never causation), and security classifications are
 * never escalated beyond "suspected".
 */

import { formatUtc } from "@/lib/domain/time";
import type { SuggestibleClassification } from "@/lib/domain/enums";
import type { AnalysisAction, AnalysisEvidence, AnalysisFact, AnalysisHypothesis, AnalysisInput, AnalysisOutput } from "./types";

const FAILURE_STATUSES = new Set(["DEGRADED", "DOWN"]);
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function isAuthFailure(e: AnalysisEvidence) {
  return e.category === "AUTH_EVENT" && /fail|denied|invalid password|locked/i.test(`${e.title} ${e.contentText}`);
}
function isAuthSuccess(e: AnalysisEvidence) {
  return e.category === "AUTH_EVENT" && /success/i.test(`${e.title} ${e.contentText}`) && !isAuthFailure(e);
}

const PROVENANCE_PREFIX: Record<string, string> = {
  PUBLIC_REPORTED: "Provider reported (public source)",
  SYNTHETIC: "Simulated observation",
  CUSTOMER_OBSERVED: "Observed in organisation systems",
};

export function runRuleBasedAnalysis(input: AnalysisInput): AnalysisOutput {
  const evidence = [...input.evidence].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime() || a.id.localeCompare(b.id));
  const nameOf = new Map(input.assets.map((a) => [a.id, a.name]));
  const limitations: string[] = [
    "Rule-based analysis: deterministic rules over recorded evidence. It identifies overlaps and dependency paths, not causation.",
  ];

  if (evidence.length === 0) {
    return {
      summary: "No evidence is linked to this incident, so no evidence-based assessment can be made.",
      classificationSuggestion: "UNDETERMINED",
      facts: [],
      hypotheses: [],
      unknowns: ["All aspects of the incident — no evidence recorded."],
      recommendedActions: [{ description: "Add or import evidence for this incident.", reasonEvidenceIds: [] }],
      limitations,
    };
  }

  const synthetic = evidence.filter((e) => e.provenance === "SYNTHETIC");
  const publicReports = evidence.filter((e) => e.provenance === "PUBLIC_REPORTED");
  const providerFailures = publicReports.filter(
    (e) => (e.assetStatus && FAILURE_STATUSES.has(e.assetStatus)) || (e.category === "PROVIDER_NOTICE" && e.assetStatus !== "HEALTHY"),
  );
  const providerRestorations = publicReports.filter((e) => e.assetStatus === "HEALTHY");
  const authFailures = evidence.filter(isAuthFailure);
  const authSuccesses = evidence.filter(isAuthSuccess);
  const changes = evidence.filter((e) => e.category === "CHANGE_EVENT");
  const customerFailures = evidence.filter(
    (e) => e.provenance !== "PUBLIC_REPORTED" && e.assetStatus && FAILURE_STATUSES.has(e.assetStatus),
  );

  const impacts = Object.values(input.impact.impacts);
  const confirmedCustomer = impacts.filter((i) => i.state === "CONFIRMED_AFFECTED" && !i.providerReported);
  const providerReportedAssets = impacts.filter((i) => i.providerReported);
  const atRisk = impacts.filter((i) => i.state === "POTENTIALLY_AFFECTED");
  const conflicts = impacts.filter((i) => i.conflict);
  const allSimulatedCustomer = confirmedCustomer.length > 0 && confirmedCustomer.every((i) => i.basis === "SYNTHETIC");

  // ---- Facts (chronological, each with evidence) --------------------------------
  const facts: AnalysisFact[] = evidence
    .filter((e) => e.provenance !== "ANALYST_NOTE")
    .slice(0, 14)
    .map((e) => ({
      statement: `${PROVENANCE_PREFIX[e.provenance] ?? "Recorded"}: ${e.title} — ${formatUtc(e.observedAt)}${
        e.assetName ? ` (asset: ${e.assetName})` : ""
      }.`,
      evidenceIds: [e.id],
    }));

  // ---- Summary ----------------------------------------------------------------
  const sentences: string[] = [];
  if (providerFailures.length > 0) {
    const names = [...new Set(providerReportedAssets.map((i) => nameOf.get(i.assetId)!).filter(Boolean))];
    sentences.push(
      `A provider-reported ${names.length ? `${list(names)} ` : ""}disruption is recorded (${providerFailures
        .map((e) => e.ref)
        .join(", ")}).`,
    );
  }
  if (confirmedCustomer.length > 0) {
    const names = confirmedCustomer.map((i) => nameOf.get(i.assetId)!);
    sentences.push(
      `${allSimulatedCustomer ? "Simulated customer" : "Customer"} observations record failures on ${list(names)}; ` +
        `these support ${allSimulatedCustomer ? "a simulated" : "an"} impact on ${names.length === 1 ? "that asset" : "those assets"}${
          providerFailures.length > 0 ? " overlapping the provider-reported interval" : ""
        }.`,
    );
  }
  if (atRisk.length > 0) {
    sentences.push(
      `Dependency analysis marks ${list(atRisk.map((i) => nameOf.get(i.assetId)!))} as at risk — dependency path only, with no direct failure evidence.`,
    );
  }
  if (authFailures.length > 0) {
    sentences.push(
      `${plural(authFailures.length, "failed sign-in event")} ${authSuccesses.length ? `followed by ${plural(authSuccesses.length, "successful sign-in")} ` : ""}${
        authFailures.every((e) => e.provenance === "SYNTHETIC") ? "were recorded in simulated data" : "were recorded"
      }. This pattern warrants verification with the account owner; it does not by itself establish account compromise.`,
    );
  }
  if (changes.length > 0) {
    const firstFailure = customerFailures[0];
    const change = changes[0];
    if (firstFailure && change.observedAt <= firstFailure.observedAt) {
      const minutes = Math.round((firstFailure.observedAt.getTime() - change.observedAt.getTime()) / 60000);
      sentences.push(
        `A recorded change (${change.ref}) occurred ${plural(minutes, "minute")} before the first failure observation (${firstFailure.ref}); timing overlap is not proof of causation.`,
      );
    } else {
      sentences.push(`${plural(changes.length, "change event")} recorded (${changes.map((c) => c.ref).join(", ")}).`);
    }
  }
  if (providerRestorations.length > 0) {
    sentences.push(`The provider reported restoration (${providerRestorations.map((e) => e.ref).join(", ")}).`);
  }
  if (authFailures.length === 0) {
    sentences.push("Attribution to a cyberattack is not supported by the available evidence.");
  } else {
    sentences.push("Classification should remain 'suspected' until an analyst reviews the evidence.");
  }
  if (synthetic.length > 0) {
    sentences.push("Simulated data is present; conclusions apply to the demonstration scenario only.");
  }

  // ---- Classification suggestion (never CONFIRMED_SECURITY) -------------------
  let classificationSuggestion: SuggestibleClassification = "UNDETERMINED";
  if (authFailures.length > 0) classificationSuggestion = "SECURITY_SUSPECTED";
  else if (providerFailures.length > 0) classificationSuggestion = "PROVIDER_TECHNICAL";
  else if (changes.length > 0) classificationSuggestion = "CONFIGURATION";

  // ---- Suggested hypotheses -------------------------------------------------------
  const hypotheses: AnalysisHypothesis[] = [];
  if (providerFailures.length > 0) {
    hypotheses.push({
      statement:
        "The provider-side service disruption (provider-reported explanation) caused the downstream failures observed on dependent assets.",
      confidence: confirmedCustomer.length > 0 ? "MEDIUM" : "LOW",
      supportingEvidenceIds: [...providerFailures, ...customerFailures].map((e) => e.id),
      contradictingEvidenceIds: [],
    });
  }
  if (authFailures.length > 0) {
    hypotheses.push({
      statement:
        "Password guessing against the account was followed by a successful sign-in from a different address (possible account misuse — not verified).",
      confidence: authSuccesses.length > 0 ? "MEDIUM" : "LOW",
      supportingEvidenceIds: [...authFailures, ...authSuccesses].map((e) => e.id),
      contradictingEvidenceIds: [],
    });
    if (authSuccesses.length > 0) {
      hypotheses.push({
        statement: "The legitimate account owner signed in after mistyped passwords (benign explanation — not verified).",
        confidence: "LOW",
        supportingEvidenceIds: authSuccesses.map((e) => e.id),
        contradictingEvidenceIds: [],
      });
    }
  }
  if (changes.length > 0 && customerFailures.length > 0) {
    hypotheses.push({
      statement: `The recorded change (${changes[0].ref}) degraded ${
        customerFailures[0].assetName ?? "the affected service"
      }.`,
      confidence: "MEDIUM",
      supportingEvidenceIds: [changes[0].id, ...customerFailures.map((e) => e.id)],
      contradictingEvidenceIds: [],
    });
  }

  // ---- Unknowns -------------------------------------------------------------------
  const unknowns: string[] = [];
  for (const i of atRisk) {
    unknowns.push(`Whether ${nameOf.get(i.assetId)} was actually affected — no direct observation recorded.`);
  }
  if (publicReports.length > 0) {
    unknowns.push("The provider's internal root cause is provider-reported and not independently verified.");
  }
  if (authSuccesses.length > 0) {
    const ips = [...new Set(authSuccesses.flatMap((e) => e.contentText.match(IPV4) ?? []))];
    unknowns.push(
      `Whether the successful sign-in${ips.length ? ` from ${ips.join(", ")}` : ""} was performed by the legitimate account owner.`,
    );
    unknowns.push("MFA enrolment and challenge outcome for the account.");
  }
  for (const c of conflicts) {
    unknowns.push(`Conflicting observations exist for ${nameOf.get(c.assetId)}; the newest is used and both are retained.`);
  }
  if (!evidence.some((e) => e.provenance === "CUSTOMER_OBSERVED")) {
    unknowns.push("No observations from the organisation's own authorised systems are recorded.");
  }

  // ---- Recommended actions (advisory only; nothing executes) ----------------------
  const actions: AnalysisAction[] = [];
  if (atRisk.length > 0) {
    actions.push({
      description: `Confirm the status of ${list(atRisk.map((i) => nameOf.get(i.assetId)!))} from authorised monitoring before closing the impact assessment.`,
      reasonEvidenceIds: [...new Set(atRisk.flatMap((i) => input.impact.impacts[i.path?.[0] ?? ""]?.evidence.map((r) => r.evidenceId) ?? []))],
    });
  }
  if (authSuccesses.length > 0) {
    actions.push({
      description: "Verify the successful sign-in with the account owner and review MFA enrolment (manual follow-up).",
      reasonEvidenceIds: authSuccesses.map((e) => e.id),
    });
  }
  if (providerFailures.length > 0) {
    actions.push({
      description: "Review business-continuity runbooks for loss of the provider service (e.g. mail fallback channels).",
      reasonEvidenceIds: providerFailures.map((e) => e.id),
    });
  }
  if (synthetic.length > 0) {
    actions.push({
      description: "Replace simulated telemetry with authorised tenant observations before drawing operational conclusions.",
      reasonEvidenceIds: synthetic.slice(0, 5).map((e) => e.id),
    });
  }
  const open = input.openTasks.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS");
  if (open.length > 0) {
    actions.push({ description: `Complete ${plural(open.length, "open response task")}.`, reasonEvidenceIds: [] });
  }

  if (synthetic.length > 0) limitations.push("Includes simulated (synthetic) records — demonstration data only.");
  if (publicReports.length > 0) limitations.push("Public provider reports may be preliminary and superseded by a final report.");

  return {
    summary: sentences.join(" "),
    classificationSuggestion,
    facts,
    hypotheses,
    unknowns,
    recommendedActions: actions,
    limitations,
  };
}

export function evidenceRefs(ids: string[], refOf: Map<string, string>): string {
  return ids.map((id) => refOf.get(id) ?? id).join(", ");
}
