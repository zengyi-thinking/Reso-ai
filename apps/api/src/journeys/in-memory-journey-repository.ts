import { randomUUID } from "node:crypto";
import type {
  ClaimAgentResponse,
  JourneyAnswer,
  PersonalManualSnapshot,
  PersonaContent,
} from "@reso/contracts";
import { ProductError } from "../product/product-error.js";
import type { AuditLogRecord, OutboxEventRecord } from "../product/entities.js";
import type {
  ClaimAgentInput,
  ClaimJourneyOwnershipInput,
  CompleteJourneyInput,
  CompleteJourneyResult,
  CreateJourneyAttemptInput,
  EditManualInput,
  FailManualInput,
  JourneyAttemptRecord,
  JourneyRepository,
  RetryManualInput,
  SaveJourneyAnswerResult,
  SaveManualCandidateInput,
} from "./journey-repository.js";

export class InMemoryJourneyRepository implements JourneyRepository {
  private readonly attempts = new Map<string, JourneyAttemptRecord>();
  private readonly attemptsByClient = new Map<string, string>();
  private readonly answers = new Map<string, JourneyAnswer>();
  private readonly answersByClient = new Map<string, string>();
  private readonly answersByQuestion = new Map<string, string>();
  private readonly evidence = new Map<string, CompleteJourneyResult["evidenceSnapshot"]>();
  private readonly manuals = new Map<string, PersonalManualSnapshot>();
  private readonly editsByClient = new Map<string, number>();
  private readonly claims = new Map<string, ClaimAgentResponse>();
  private readonly outbox = new Map<string, OutboxEventRecord>();
  private readonly auditLog: AuditLogRecord[] = [];

  async createJourneyAttempt(input: CreateJourneyAttemptInput): Promise<JourneyAttemptRecord> {
    const key = clientAttemptKey(
      input.attempt.userId,
      input.attempt.anonymousTokenHash,
      input.attempt.clientAttemptId,
    );
    const existingId = this.attemptsByClient.get(key);
    if (existingId !== undefined) return this.requiredAttempt(existingId);
    const official =
      input.attempt.official && input.attempt.replayOfJourneyId === null
        ? this.findOfficialJourneySync(
            input.attempt.userId,
            input.attempt.anonymousTokenHash,
            input.attempt.journeyVersion,
          )
        : null;
    const attempt =
      official === null
        ? input.attempt
        : { ...input.attempt, official: false, replayOfJourneyId: official.id };
    this.attempts.set(attempt.id, structuredClone(attempt));
    this.attemptsByClient.set(key, input.attempt.id);
    return structuredClone(attempt);
  }

  async findJourneyAttemptByClient(
    userId: string | null,
    anonymousTokenHash: string | null,
    clientAttemptId: string,
  ): Promise<JourneyAttemptRecord | null> {
    const id = this.attemptsByClient.get(
      clientAttemptKey(userId, anonymousTokenHash, clientAttemptId),
    );
    return id === undefined ? null : this.requiredAttempt(id);
  }

  async findOfficialJourney(
    userId: string | null,
    anonymousTokenHash: string | null,
    journeyVersion: JourneyAttemptRecord["journeyVersion"],
  ): Promise<JourneyAttemptRecord | null> {
    return this.findOfficialJourneySync(userId, anonymousTokenHash, journeyVersion);
  }

  private findOfficialJourneySync(
    userId: string | null,
    anonymousTokenHash: string | null,
    journeyVersion: JourneyAttemptRecord["journeyVersion"],
  ): JourneyAttemptRecord | null {
    const attempt = [...this.attempts.values()].find(
      (candidate) =>
        candidate.official &&
        candidate.journeyVersion === journeyVersion &&
        (userId === null
          ? candidate.userId === null && candidate.anonymousTokenHash === anonymousTokenHash
          : candidate.userId === userId),
    );
    return attempt === undefined ? null : structuredClone(attempt);
  }

  async getJourneyAttempt(id: string): Promise<JourneyAttemptRecord | null> {
    const attempt = this.attempts.get(id);
    return attempt === undefined ? null : structuredClone(attempt);
  }

  async listJourneyAnswers(journeyId: string): Promise<JourneyAnswer[]> {
    return [...this.answers.values()]
      .filter((answer) => answer.journeyId === journeyId)
      .sort((left, right) => left.answerOrder - right.answerOrder)
      .map((answer) => structuredClone(answer));
  }

  async saveJourneyAnswer(answer: JourneyAnswer): Promise<SaveJourneyAnswerResult> {
    const attempt = this.requiredAttempt(answer.journeyId);
    if (attempt.status === "completed") {
      throw new ProductError("JOURNEY_ALREADY_COMPLETED", "Journey is already completed", false);
    }
    const clientKey = `${answer.journeyId}:${answer.clientAnswerId}`;
    const questionKey = `${answer.journeyId}:${answer.questionId}`;
    const existingId =
      this.answersByClient.get(clientKey) ?? this.answersByQuestion.get(questionKey);
    if (existingId !== undefined) {
      const existing = this.answers.get(existingId);
      if (existing === undefined) throw new Error("Journey answer index is corrupted");
      return { answer: structuredClone(existing), created: false };
    }
    this.answers.set(answer.id, structuredClone(answer));
    this.answersByClient.set(clientKey, answer.id);
    this.answersByQuestion.set(questionKey, answer.id);
    this.attempts.set(answer.journeyId, {
      ...attempt,
      answerCount: attempt.answerCount + 1,
      updatedAt: answer.answeredAt,
    });
    return { answer: structuredClone(answer), created: true };
  }

  async completeJourney(input: CompleteJourneyInput): Promise<CompleteJourneyResult> {
    const attempt = this.requiredAttempt(input.journeyId);
    const existingEvidence = this.evidence.get(input.journeyId);
    const existingManual = this.manuals.get(input.journeyId);
    if (attempt.status === "completed") {
      if (existingEvidence === undefined || existingManual === undefined) {
        throw new Error("Completed Journey is missing snapshots");
      }
      return {
        attempt,
        evidenceSnapshot: structuredClone(existingEvidence),
        manualSnapshot: structuredClone(existingManual),
      };
    }
    const answers = await this.listJourneyAnswers(input.journeyId);
    const answered = new Set(answers.map(({ questionId }) => questionId));
    if (
      answers.length !== input.expectedQuestionIds.length ||
      input.expectedQuestionIds.some((questionId) => !answered.has(questionId))
    ) {
      throw new ProductError("JOURNEY_INCOMPLETE", "Journey questions are incomplete", false);
    }
    const completedAttempt: JourneyAttemptRecord = {
      ...attempt,
      status: "completed",
      completedAt: input.evidenceSnapshot.createdAt,
      updatedAt: input.evidenceSnapshot.createdAt,
    };
    this.attempts.set(input.journeyId, completedAttempt);
    this.evidence.set(input.journeyId, structuredClone(input.evidenceSnapshot));
    this.manuals.set(input.journeyId, structuredClone(input.manualSnapshot));
    this.outbox.set(input.event.idempotencyKey, structuredClone(input.event));
    this.auditLog.push(structuredClone(input.audit));
    return {
      attempt: structuredClone(completedAttempt),
      evidenceSnapshot: structuredClone(input.evidenceSnapshot),
      manualSnapshot: structuredClone(input.manualSnapshot),
    };
  }

  async getJourneyEvidenceSnapshot(journeyId: string) {
    const snapshot = this.evidence.get(journeyId);
    return snapshot === undefined ? null : structuredClone(snapshot);
  }

  async getPersonalManual(journeyId: string): Promise<PersonalManualSnapshot | null> {
    const manual = this.manuals.get(journeyId);
    return manual === undefined ? null : structuredClone(manual);
  }

  async getPersonalManualGenerationRequest(journeyId: string, traceId: string) {
    const attempt = this.attempts.get(journeyId);
    const evidence = this.evidence.get(journeyId);
    const manual = this.manuals.get(journeyId);
    if (attempt === undefined || evidence === undefined || manual === undefined) return null;
    return {
      requestId: manual.id,
      journeyId,
      journeyVersion: attempt.journeyVersion,
      evidenceSnapshotId: evidence.id,
      evidenceSignature: evidence.evidenceSignature,
      evidence: structuredClone(evidence.items),
      traceId,
    };
  }

  async markPersonalManualGenerating(journeyId: string): Promise<PersonalManualSnapshot | null> {
    const manual = this.manuals.get(journeyId);
    if (manual === undefined) return null;
    if (manual.status === "ready" || manual.status === "claimed") return structuredClone(manual);
    const generating: PersonalManualSnapshot = {
      ...manual,
      status: "generating",
      retryable: false,
      errorCode: null,
      updatedAt: new Date().toISOString(),
    };
    this.manuals.set(journeyId, generating);
    return structuredClone(generating);
  }

  async savePersonalManualCandidate(
    input: SaveManualCandidateInput,
  ): Promise<PersonalManualSnapshot> {
    const manual = this.requiredManual(input.journeyId);
    if (manual.status === "ready" || manual.status === "claimed") return manual;
    const content = {
      variables: input.candidate.variables,
      sections: input.candidate.sections,
      updateSummary: input.candidate.updateSummary,
    };
    const ready: PersonalManualSnapshot = {
      ...manual,
      status: "ready",
      originalContent: structuredClone(content),
      currentContent: structuredClone(content),
      currentSource: "agent_generated",
      retryable: false,
      errorCode: null,
      agentTraceId: input.candidate.traceId,
      agentVersionId: input.candidate.agentVersionId,
      modelVersion: input.candidate.modelVersion,
      generatedAt: input.generatedAt,
      updatedAt: input.generatedAt,
    };
    this.manuals.set(input.journeyId, ready);
    return structuredClone(ready);
  }

  async failPersonalManual(input: FailManualInput): Promise<PersonalManualSnapshot> {
    const manual = this.requiredManual(input.journeyId);
    if (manual.status === "ready" || manual.status === "claimed") return manual;
    const failed: PersonalManualSnapshot = {
      ...manual,
      status: "failed",
      retryable: input.retryable,
      errorCode: input.errorCode,
      updatedAt: new Date().toISOString(),
    };
    this.manuals.set(input.journeyId, failed);
    return structuredClone(failed);
  }

  async retryPersonalManual(input: RetryManualInput): Promise<PersonalManualSnapshot> {
    const manual = this.requiredManual(input.journeyId);
    if (this.outbox.has(input.event.idempotencyKey)) return manual;
    if (manual.status === "generating") return manual;
    if (manual.status !== "failed" || !manual.retryable) {
      throw new ProductError("RETRY_NOT_ALLOWED", "Personal Manual cannot be retried", false);
    }
    const generating: PersonalManualSnapshot = {
      ...manual,
      status: "generating",
      retryable: false,
      errorCode: null,
      updatedAt: input.event.occurredAt,
    };
    this.manuals.set(input.journeyId, generating);
    this.outbox.set(input.event.idempotencyKey, structuredClone(input.event));
    this.auditLog.push(structuredClone(input.audit));
    return structuredClone(generating);
  }

  async editPersonalManual(input: EditManualInput): Promise<PersonalManualSnapshot> {
    const manual = this.requiredManual(input.journeyId);
    if (manual.status !== "ready") {
      throw new ProductError("PERSONAL_MANUAL_NOT_READY", "Personal Manual is not editable", false);
    }
    const editKey = `${manual.id}:${input.clientEditId}`;
    if (this.editsByClient.has(editKey)) return manual;
    if (manual.revision !== input.expectedRevision) {
      throw new ProductError(
        "PERSONAL_MANUAL_EDIT_CONFLICT",
        "Personal Manual revision changed",
        false,
      );
    }
    const edited: PersonalManualSnapshot = {
      ...manual,
      currentContent: structuredClone(input.content),
      currentSource: "user_edit",
      revision: manual.revision + 1,
      updatedAt: input.editedAt,
    };
    this.manuals.set(input.journeyId, edited);
    this.editsByClient.set(editKey, edited.revision);
    this.auditLog.push(structuredClone(input.audit));
    return structuredClone(edited);
  }

  async claimJourneyOwnership(input: ClaimJourneyOwnershipInput): Promise<JourneyAttemptRecord> {
    const attempt = this.requiredAttempt(input.journeyId);
    if (attempt.userId !== null) {
      if (attempt.userId !== input.userId) {
        throw new ProductError("JOURNEY_FORBIDDEN", "Journey belongs to another user", false);
      }
      return attempt;
    }
    if (attempt.anonymousTokenHash !== input.anonymousTokenHash) {
      throw new ProductError("JOURNEY_FORBIDDEN", "Invalid Journey credential", false);
    }
    const existingOfficial = await this.findOfficialJourney(
      input.userId,
      null,
      attempt.journeyVersion,
    );
    const claimed = {
      ...attempt,
      userId: input.userId,
      anonymousTokenHash: null,
      official: attempt.official && existingOfficial !== null ? false : attempt.official,
      replayOfJourneyId:
        attempt.official && existingOfficial !== null
          ? existingOfficial.id
          : attempt.replayOfJourneyId,
      updatedAt: input.claimedAt,
    };
    if (attempt.official && existingOfficial !== null) {
      const evidence = this.evidence.get(input.journeyId);
      if (evidence !== undefined) {
        this.evidence.set(input.journeyId, { ...evidence, official: false });
      }
    }
    this.attempts.set(input.journeyId, claimed);
    this.auditLog.push(structuredClone(input.audit));
    return structuredClone(claimed);
  }

  async claimAgent(input: ClaimAgentInput): Promise<ClaimAgentResponse> {
    const existing = this.claims.get(input.journeyId);
    if (existing !== undefined) return structuredClone(existing);
    const attempt = this.requiredAttempt(input.journeyId);
    if (attempt.userId !== input.userId) {
      throw new ProductError("JOURNEY_FORBIDDEN", "Journey belongs to another user", false);
    }
    const manual = this.requiredManual(input.journeyId);
    if (manual.status !== "ready" || manual.currentContent === null) {
      throw new ProductError("PERSONAL_MANUAL_NOT_READY", "Personal Manual is not ready", false);
    }
    const profileId = randomUUID();
    const personaVersionId = randomUUID();
    const agentId = randomUUID();
    const personaContent: PersonaContent = {
      identity: {
        personalManualSnapshotId: manual.id,
        personalManual: structuredClone(manual.currentContent),
      },
      values: [],
      socialStyle: {},
      communicationStyle: {},
      relationshipNeeds: [],
      boundaries: [],
      interests: [],
      currentGoals: [],
      confirmedPatterns: [],
      uncertainHypotheses: [],
    };
    const claimedManual: PersonalManualSnapshot = {
      ...manual,
      status: "claimed",
      personaVersionId,
      agentId,
      claimedAt: input.claimedAt,
      updatedAt: input.claimedAt,
    };
    const response: ClaimAgentResponse = {
      personalManual: claimedManual,
      personaVersion: {
        id: personaVersionId,
        profileId,
        version: 1,
        content: personaContent,
        changeSummary: "Claimed from the current Personal Manual",
        confirmedByUser: true,
        createdAt: input.claimedAt,
      },
      agent: {
        id: agentId,
        userId: input.userId,
        name: "Reso Agent",
        status: "active",
        createdAt: input.claimedAt,
      },
      nextPath: "/agent",
    };
    this.manuals.set(input.journeyId, claimedManual);
    this.claims.set(input.journeyId, response);
    this.outbox.set(`persona.created:${manual.id}`, {
      id: randomUUID(),
      eventType: "persona.created",
      subjectId: personaVersionId,
      traceId: input.audit.traceId,
      idempotencyKey: `persona.created:${manual.id}`,
      payload: {
        userId: input.userId,
        profileId,
        personaVersionId,
        agentId,
        personalManualSnapshotId: manual.id,
      },
      occurredAt: input.claimedAt,
    });
    this.auditLog.push(structuredClone(input.audit));
    return structuredClone(response);
  }

  listOutboxEvents(): OutboxEventRecord[] {
    return [...this.outbox.values()].map((event) => structuredClone(event));
  }

  private requiredAttempt(id: string): JourneyAttemptRecord {
    const attempt = this.attempts.get(id);
    if (attempt === undefined)
      throw new ProductError("JOURNEY_NOT_FOUND", "Journey not found", false);
    return structuredClone(attempt);
  }

  private requiredManual(journeyId: string): PersonalManualSnapshot {
    const manual = this.manuals.get(journeyId);
    if (manual === undefined) {
      throw new ProductError("PERSONAL_MANUAL_NOT_FOUND", "Personal Manual not found", false);
    }
    return structuredClone(manual);
  }
}

function clientAttemptKey(
  userId: string | null,
  anonymousTokenHash: string | null,
  clientAttemptId: string,
): string {
  return `${userId ?? anonymousTokenHash ?? "missing-owner"}:${clientAttemptId}`;
}
