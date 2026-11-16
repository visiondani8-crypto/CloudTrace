import type {
  AnalysisMode,
  Classification,
  EvidenceCategory,
  HypothesisConfidence,
  HypothesisStatus,
  IncidentStatus,
  IncidentType,
  Provenance,
  Severity,
  SuggestibleClassification,
} from "@/lib/domain/enums";
import type { BlastRadiusResult } from "@/lib/blast-radius";

export interface AnalysisEvidence {
  id: string;
  ref: string;
  title: string;
  category: EvidenceCategory;
  provenance: Provenance;
  sourceName: string;
  observedAt: Date;
  assetId: string | null;
  assetName: string | null;
  assetStatus: string | null;
  contentText: string;
  confidenceLevel: string;
}

export interface AnalysisInput {
  incident: {
    caseNumber: string;
    title: string;
    type: IncidentType;
    classification: Classification;
    status: IncidentStatus;
    severity: Severity;
  };
  evidence: AnalysisEvidence[];
  assets: { id: string; name: string }[];
  impact: BlastRadiusResult;
  hypotheses: {
    title: string;
    status: HypothesisStatus;
    confidence: HypothesisConfidence;
    supportingEvidenceIds: string[];
    contradictingEvidenceIds: string[];
  }[];
  openTasks: { title: string; status: string }[];
}

export interface AnalysisFact {
  statement: string;
  evidenceIds: string[];
}

export interface AnalysisHypothesis {
  statement: string;
  confidence: HypothesisConfidence;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
}

export interface AnalysisAction {
  description: string;
  reasonEvidenceIds: string[];
}

export interface AnalysisOutput {
  summary: string;
  classificationSuggestion: SuggestibleClassification;
  facts: AnalysisFact[];
  hypotheses: AnalysisHypothesis[];
  unknowns: string[];
  recommendedActions: AnalysisAction[];
  limitations: string[];
}

export interface AnalysisRun extends AnalysisOutput {
  mode: AnalysisMode;
  modelId: string | null;
  /** Populated when Claude was attempted but rule-based output was used. */
  errorStatus: string | null;
  usedEvidenceIds: string[];
}
