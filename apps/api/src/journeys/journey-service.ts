import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  ClaimAgentRequest,
  ClaimAgentResponse,
  ClaimJourneyOwnershipRequest,
  CreateJourneyRequest,
  JourneyAnswer,
  JourneyAnswerInput,
  JourneyAttempt,
  JourneyProgress,
  JourneyEvidenceSnapshot,
  PersonalManualEditRequest,
  PersonalManualSnapshot,
  RetryPersonalManualRequest,
} from "@reso/contracts";
import { ProductError } from "../product/product-error.js";
import type { AuditLogRecord, OutboxEventRecord } from "../product/entities.js";
import {
  getJourneyDefinition,
  JourneyDefinitionError,
  nextQuestionId,
  resolveJourneyEvidence,
} from "./evidence-registry.js";
import type { JourneyAttemptRecord, JourneyRepository } from "./journey-repository.js";
import { validatePersonalManualContent } from "./manual-validation.js";

export interface JourneyActor {
  userId: string | null;
  anonymousAccessToken: string | null;
}

export class JourneyService {
  constructor(
    private readonly repository: JourneyRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  async create(request: CreateJourneyRequest, actor: JourneyActor): Promise<JourneyAttempt> {
    const anonymousTokenHash =
      actor.userId === null
        ? this.requireAnonymousToken(request.anonymousAccessToken ?? actor.anonymousAccessToken)
        : null;
    const existing = await this.repository.findJourneyAttemptByClient(
      actor.userId,
      anonymousTokenHash,
      request.clientAttemptId,
    );
    if (existing !== null) return publicAttempt(existing);

    let replayOfJourneyId: string | null = null;
    if (request.replayOfJourneyId !== undefined) {
      const previous = await this.requiredAttempt(request.replayOfJourneyId);
      this.assertAccess(previous, actor);
      if (previous.status !== "completed") {
        throw new ProductError(
          "JOURNEY_INCOMPLETE",
          "Only a completed Journey can be replayed",
          false,
        );
      }
      replayOfJourneyId = previous.id;
    } else {
      replayOfJourneyId =
        (
          await this.repository.findOfficialJourney(
            actor.userId,
            anonymousTokenHash,
            request.journeyVersion,
          )
        )?.id ?? null;
    }

    const timestamp = this.now().toISOString();
    const definition = getJourneyDefinition(request.journeyVersion);
    const attempt: JourneyAttemptRecord = {
      id: this.newId(),
      userId: actor.userId,
      anonymousTokenHash,
      journeyVersion: request.journeyVersion,
      status: "started",
      clientAttemptId: request.clientAttemptId,
      replayOfJourneyId,
      official: replayOfJourneyId === null,
      answerCount: 0,
      requiredAnswerCount: definition.questions.length,
      startedAt: timestamp,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return publicAttempt(await this.repository.createJourneyAttempt({ attempt }));
  }

  async getProgress(journeyId: string, actor: JourneyActor): Promise<JourneyProgress> {
    const attempt = await this.requiredAttempt(journeyId);
    this.assertAccess(attempt, actor);
    const answers = await this.repository.listJourneyAnswers(journeyId);
    return {
      attempt: publicAttempt({ ...attempt, answerCount: answers.length }),
      answers,
      nextQuestionId: nextQuestionId(
        attempt.journeyVersion,
        answers.map(({ questionId }) => questionId),
      ),
    };
  }

  async answer(
    journeyId: string,
    input: JourneyAnswerInput,
    actor: JourneyActor,
  ): Promise<JourneyAnswer> {
    const attempt = await this.requiredAttempt(journeyId);
    this.assertAccess(attempt, actor);
    if (attempt.status === "completed") {
      throw new ProductError("JOURNEY_ALREADY_COMPLETED", "Journey is already completed", false);
    }
    const answeredAt = this.now().toISOString();
    const answerId = this.newId();
    let evidence;
    try {
      evidence = resolveJourneyEvidence(attempt.journeyVersion, input, { answerId, answeredAt });
    } catch (error) {
      if (error instanceof JourneyDefinitionError) {
        throw new ProductError("JOURNEY_INVALID_DEFINITION", error.message, false);
      }
      throw error;
    }
    const answers = await this.repository.listJourneyAnswers(journeyId);
    const answer: JourneyAnswer = {
      id: answerId,
      journeyId,
      stageId: input.stageId,
      questionId: input.questionId,
      choiceId: input.choiceId,
      responseText: input.responseText ?? null,
      elapsedMs: input.elapsedMs ?? null,
      clientAnswerId: input.clientAnswerId,
      answerOrder: answers.length + 1,
      answeredAt,
      evidence,
    };
    const saved = await this.repository.saveJourneyAnswer(answer);
    if (!sameAnswer(saved.answer, input)) {
      throw new ProductError(
        "JOURNEY_ANSWER_CONFLICT",
        "This client answer or question was already saved with different content",
        false,
      );
    }
    return saved.answer;
  }

  async complete(
    journeyId: string,
    actor: JourneyActor,
    traceId: string,
  ): Promise<{ attempt: JourneyAttempt; personalManual: PersonalManualSnapshot }> {
    const attempt = await this.requiredAttempt(journeyId);
    this.assertAccess(attempt, actor);
    if (attempt.status === "completed") {
      const manual = await this.repository.getPersonalManual(journeyId);
      if (manual === null) throw new Error("Completed Journey has no Personal Manual snapshot");
      return { attempt: publicAttempt(attempt), personalManual: manual };
    }
    const answers = await this.repository.listJourneyAnswers(journeyId);
    const definition = getJourneyDefinition(attempt.journeyVersion);
    const expectedQuestionIds = definition.questions.map(({ questionId }) => questionId);
    const answeredIds = new Set(answers.map(({ questionId }) => questionId));
    if (
      answers.length !== expectedQuestionIds.length ||
      expectedQuestionIds.some((questionId) => !answeredIds.has(questionId))
    ) {
      throw new ProductError("JOURNEY_INCOMPLETE", "Journey questions are incomplete", false);
    }
    const evidenceItems = answers.map((answer) =>
      resolveJourneyEvidence(attempt.journeyVersion, answerInputFromRecord(answer), {
        answerId: answer.id,
        answeredAt: answer.answeredAt,
      }),
    );
    const completedAt = this.now().toISOString();
    const evidenceSignature = createHash("sha256")
      .update(JSON.stringify(evidenceItems))
      .digest("hex");
    const evidenceSnapshotId = this.newId();
    const manualSnapshotId = this.newId();
    const evidenceSnapshot: JourneyEvidenceSnapshot = {
      id: evidenceSnapshotId,
      journeyId,
      journeyVersion: attempt.journeyVersion,
      evidenceVersion: 1,
      official: attempt.official,
      evidenceSignature,
      items: evidenceItems,
      createdAt: completedAt,
    };
    const manualSnapshot: PersonalManualSnapshot = {
      id: manualSnapshotId,
      journeyId,
      status: "generating",
      evidenceSignature,
      originalContent: null,
      currentContent: null,
      revision: 1,
      currentSource: "agent_generated",
      retryable: false,
      errorCode: null,
      agentTraceId: null,
      agentVersionId: null,
      modelVersion: null,
      personaVersionId: null,
      agentId: null,
      createdAt: completedAt,
      updatedAt: completedAt,
      generatedAt: null,
      claimedAt: null,
    };
    const event: OutboxEventRecord = {
      id: this.newId(),
      eventType: "journey.completed",
      subjectId: journeyId,
      traceId,
      idempotencyKey: `journey.completed:${journeyId}`,
      payload: { journeyId, evidenceSnapshotId, personalManualSnapshotId: manualSnapshotId },
      occurredAt: completedAt,
    };
    const result = await this.repository.completeJourney({
      journeyId,
      expectedQuestionIds,
      evidenceSnapshot,
      manualSnapshot,
      event,
      audit: auditRecord(
        this.newId(),
        actor.userId,
        "journey.complete",
        journeyId,
        traceId,
        "completed",
        completedAt,
      ),
    });
    return { attempt: publicAttempt(result.attempt), personalManual: result.manualSnapshot };
  }

  async getPersonalManualStatus(
    journeyId: string,
    actor: JourneyActor,
  ): Promise<PersonalManualSnapshot> {
    const attempt = await this.requiredAttempt(journeyId);
    this.assertAccess(attempt, actor);
    return this.requiredManual(journeyId);
  }

  async getReadyPersonalManual(
    journeyId: string,
    actor: JourneyActor,
  ): Promise<PersonalManualSnapshot> {
    const manual = await this.getPersonalManualStatus(journeyId, actor);
    if (
      (manual.status !== "ready" && manual.status !== "claimed") ||
      manual.currentContent === null
    ) {
      throw new ProductError("PERSONAL_MANUAL_NOT_READY", "Personal Manual is not ready", true);
    }
    return manual;
  }

  async retryPersonalManual(
    journeyId: string,
    request: RetryPersonalManualRequest,
    actor: JourneyActor,
    traceId: string,
  ): Promise<PersonalManualSnapshot> {
    const attempt = await this.requiredAttempt(journeyId);
    this.assertAccess(attempt, actor);
    const retriedAt = this.now().toISOString();
    return this.repository.retryPersonalManual({
      journeyId,
      event: {
        id: this.newId(),
        eventType: "journey.completed",
        subjectId: journeyId,
        traceId,
        idempotencyKey: `personal-manual.retry:${journeyId}:${request.clientRetryId}`,
        payload: {
          journeyId,
          evidenceSnapshotId: (await this.requiredEvidence(journeyId)).id,
          personalManualSnapshotId: (await this.requiredManual(journeyId)).id,
        },
        occurredAt: retriedAt,
      },
      audit: auditRecord(
        this.newId(),
        actor.userId,
        "personal_manual.retry",
        journeyId,
        traceId,
        "queued",
        retriedAt,
      ),
    });
  }

  async editPersonalManual(
    journeyId: string,
    request: PersonalManualEditRequest,
    actor: JourneyActor,
    traceId: string,
  ): Promise<PersonalManualSnapshot> {
    const attempt = await this.requiredAttempt(journeyId);
    this.assertAccess(attempt, actor);
    const evidence = await this.requiredEvidence(journeyId);
    const content = validatePersonalManualContent(request.content, evidence.items);
    const editedAt = this.now().toISOString();
    return this.repository.editPersonalManual({
      journeyId,
      clientEditId: request.clientEditId,
      expectedRevision: request.expectedRevision,
      content,
      editedAt,
      audit: auditRecord(
        this.newId(),
        actor.userId,
        "personal_manual.edit",
        journeyId,
        traceId,
        "updated",
        editedAt,
      ),
    });
  }

  async claimOwnership(
    journeyId: string,
    request: ClaimJourneyOwnershipRequest,
    actor: JourneyActor,
    traceId: string,
  ): Promise<JourneyAttempt> {
    if (actor.userId === null) {
      throw new ProductError(
        "AUTH_REQUIRED",
        "A server session is required to claim Journey",
        false,
      );
    }
    const attempt = await this.requiredAttempt(journeyId);
    if (attempt.userId === actor.userId) return publicAttempt(attempt);
    const tokenHash = this.requireAnonymousToken(actor.anonymousAccessToken);
    const claimedAt = this.now().toISOString();
    return publicAttempt(
      await this.repository.claimJourneyOwnership({
        journeyId,
        userId: actor.userId,
        anonymousTokenHash: tokenHash,
        clientClaimId: request.clientClaimId,
        claimedAt,
        audit: auditRecord(
          this.newId(),
          actor.userId,
          "journey.claim_ownership",
          journeyId,
          traceId,
          "claimed",
          claimedAt,
        ),
      }),
    );
  }

  async claimAgent(
    journeyId: string,
    request: ClaimAgentRequest,
    actor: JourneyActor,
    traceId: string,
  ): Promise<ClaimAgentResponse> {
    if (actor.userId === null) {
      throw new ProductError("AUTH_REQUIRED", "A server session is required to claim Agent", false);
    }
    const attempt = await this.requiredAttempt(journeyId);
    this.assertAccess(attempt, actor);
    const claimedAt = this.now().toISOString();
    return this.repository.claimAgent({
      journeyId,
      userId: actor.userId,
      clientClaimId: request.clientClaimId,
      claimedAt,
      audit: auditRecord(
        this.newId(),
        actor.userId,
        "agent.claim",
        journeyId,
        traceId,
        "claimed",
        claimedAt,
      ),
    });
  }

  private async requiredAttempt(journeyId: string): Promise<JourneyAttemptRecord> {
    const attempt = await this.repository.getJourneyAttempt(journeyId);
    if (attempt === null) throw new ProductError("JOURNEY_NOT_FOUND", "Journey not found", false);
    return attempt;
  }

  private async requiredManual(journeyId: string): Promise<PersonalManualSnapshot> {
    const manual = await this.repository.getPersonalManual(journeyId);
    if (manual === null) {
      throw new ProductError("PERSONAL_MANUAL_NOT_FOUND", "Personal Manual not found", false);
    }
    return manual;
  }

  private async requiredEvidence(journeyId: string) {
    const evidence = await this.repository.getJourneyEvidenceSnapshot(journeyId);
    if (evidence === null)
      throw new ProductError("JOURNEY_INCOMPLETE", "Journey has no evidence", false);
    return evidence;
  }

  private assertAccess(attempt: JourneyAttemptRecord, actor: JourneyActor): void {
    if (attempt.userId !== null) {
      if (actor.userId !== attempt.userId) {
        throw new ProductError("JOURNEY_FORBIDDEN", "Journey belongs to another user", false);
      }
      return;
    }
    const provided = actor.anonymousAccessToken;
    if (
      provided === null ||
      attempt.anonymousTokenHash === null ||
      !safeHashEqual(hashJourneyToken(provided), attempt.anonymousTokenHash)
    ) {
      throw new ProductError("JOURNEY_FORBIDDEN", "Invalid Journey credential", false);
    }
  }

  private requireAnonymousToken(token: string | null | undefined): string {
    if (token === null || token === undefined || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
      throw new ProductError(
        "VALIDATION_FAILED",
        "Anonymous Journey requires a Web Crypto generated access token",
        false,
      );
    }
    return hashJourneyToken(token);
  }
}

export function hashJourneyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function publicAttempt(record: JourneyAttemptRecord): JourneyAttempt {
  return {
    id: record.id,
    userId: record.userId,
    journeyVersion: record.journeyVersion,
    status: record.status,
    clientAttemptId: record.clientAttemptId,
    replayOfJourneyId: record.replayOfJourneyId,
    official: record.official,
    answerCount: record.answerCount,
    requiredAnswerCount: record.requiredAnswerCount,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function sameAnswer(answer: JourneyAnswer, input: JourneyAnswerInput): boolean {
  return (
    answer.stageId === input.stageId &&
    answer.questionId === input.questionId &&
    answer.choiceId === input.choiceId &&
    answer.responseText === (input.responseText ?? null) &&
    answer.elapsedMs === (input.elapsedMs ?? null)
  );
}

function answerInputFromRecord(answer: JourneyAnswer): JourneyAnswerInput {
  return {
    stageId: answer.stageId,
    questionId: answer.questionId,
    choiceId: answer.choiceId,
    ...(answer.responseText === null ? {} : { responseText: answer.responseText }),
    ...(answer.elapsedMs === null ? {} : { elapsedMs: answer.elapsedMs }),
    clientAnswerId: answer.clientAnswerId,
  };
}

function auditRecord(
  id: string,
  actorUserId: string | null,
  action: string,
  subjectId: string,
  traceId: string,
  outcome: string,
  createdAt: string,
): AuditLogRecord {
  return { id, actorUserId, action, subjectId, traceId, outcome, metadata: {}, createdAt };
}
