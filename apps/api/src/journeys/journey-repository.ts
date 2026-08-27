import type {
  ClaimAgentResponse,
  JourneyAnswer,
  JourneyAttempt,
  JourneyEvidenceSnapshot,
  PersonalManualCandidate,
  PersonalManualContent,
  PersonalManualGenerationRequest,
  PersonalManualSnapshot,
} from "@reso/contracts";
import type { AuditLogRecord, OutboxEventRecord } from "../product/entities.js";

export interface JourneyAttemptRecord extends JourneyAttempt {
  anonymousTokenHash: string | null;
}

export interface CreateJourneyAttemptInput {
  attempt: JourneyAttemptRecord;
}

export interface SaveJourneyAnswerResult {
  answer: JourneyAnswer;
  created: boolean;
}

export interface CompleteJourneyInput {
  journeyId: string;
  expectedQuestionIds: string[];
  evidenceSnapshot: JourneyEvidenceSnapshot;
  manualSnapshot: PersonalManualSnapshot;
  event: OutboxEventRecord;
  audit: AuditLogRecord;
}

export interface CompleteJourneyResult {
  attempt: JourneyAttemptRecord;
  evidenceSnapshot: JourneyEvidenceSnapshot;
  manualSnapshot: PersonalManualSnapshot;
}

export interface SaveManualCandidateInput {
  journeyId: string;
  candidate: PersonalManualCandidate;
  generatedAt: string;
}

export interface FailManualInput {
  journeyId: string;
  errorCode: string;
  retryable: boolean;
}

export interface RetryManualInput {
  journeyId: string;
  event: OutboxEventRecord;
  audit: AuditLogRecord;
}

export interface EditManualInput {
  journeyId: string;
  clientEditId: string;
  expectedRevision: number;
  content: PersonalManualContent;
  editedAt: string;
  audit: AuditLogRecord;
}

export interface ClaimJourneyOwnershipInput {
  journeyId: string;
  userId: string;
  anonymousTokenHash: string;
  clientClaimId: string;
  claimedAt: string;
  audit: AuditLogRecord;
}

export interface ClaimAgentInput {
  journeyId: string;
  userId: string;
  clientClaimId: string;
  claimedAt: string;
  audit: AuditLogRecord;
}

export interface JourneyRepository {
  createJourneyAttempt(input: CreateJourneyAttemptInput): Promise<JourneyAttemptRecord>;
  getJourneyAttempt(id: string): Promise<JourneyAttemptRecord | null>;
  findJourneyAttemptByClient(
    userId: string | null,
    anonymousTokenHash: string | null,
    clientAttemptId: string,
  ): Promise<JourneyAttemptRecord | null>;
  findOfficialJourney(
    userId: string | null,
    anonymousTokenHash: string | null,
    journeyVersion: JourneyAttempt["journeyVersion"],
  ): Promise<JourneyAttemptRecord | null>;
  listJourneyAnswers(journeyId: string): Promise<JourneyAnswer[]>;
  saveJourneyAnswer(answer: JourneyAnswer): Promise<SaveJourneyAnswerResult>;
  completeJourney(input: CompleteJourneyInput): Promise<CompleteJourneyResult>;
  getJourneyEvidenceSnapshot(journeyId: string): Promise<JourneyEvidenceSnapshot | null>;
  getPersonalManual(journeyId: string): Promise<PersonalManualSnapshot | null>;
  getPersonalManualGenerationRequest(
    journeyId: string,
    traceId: string,
  ): Promise<PersonalManualGenerationRequest | null>;
  markPersonalManualGenerating(journeyId: string): Promise<PersonalManualSnapshot | null>;
  savePersonalManualCandidate(input: SaveManualCandidateInput): Promise<PersonalManualSnapshot>;
  failPersonalManual(input: FailManualInput): Promise<PersonalManualSnapshot>;
  retryPersonalManual(input: RetryManualInput): Promise<PersonalManualSnapshot>;
  editPersonalManual(input: EditManualInput): Promise<PersonalManualSnapshot>;
  claimJourneyOwnership(input: ClaimJourneyOwnershipInput): Promise<JourneyAttemptRecord>;
  claimAgent(input: ClaimAgentInput): Promise<ClaimAgentResponse>;
}
