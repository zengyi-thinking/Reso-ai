import { randomUUID } from "node:crypto";
import {
  AnalyzeAssistResponseSchema,
  PolishAssistResponseSchema,
  type AnalyzeAssistResponse,
  type PolishAssistResponse,
} from "@reso/contracts";
import { AgentClientError, type IAgentClient } from "../agent-client/agent-client.js";
import { agentForUser, assertConnectionParticipant } from "./authorization.js";
import type { AssistRequestRecord } from "./entities.js";
import { ProductError } from "./product-error.js";
import type { RateLimiter } from "./rate-limiter.js";
import type { ProductRepository } from "./repository.js";
import { assertAssistTransition } from "./state-machine.js";

export class AssistService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly agentClient: IAgentClient,
    private readonly rateLimiter: RateLimiter,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async analyze(input: {
    connectionId: string;
    requesterUserId: string;
    messageId: string;
    clientRequestId: string;
    traceId: string;
  }): Promise<AnalyzeAssistResponse> {
    const existing = await this.repository.findAssistRequest(
      input.requesterUserId,
      input.clientRequestId,
    );
    if (existing !== null) return AnalyzeAssistResponseSchema.parse(this.toResponse(existing));
    await this.rateLimiter.consume(`assist:${input.requesterUserId}`);
    const connection = await this.requireEstablishedConnection(
      input.connectionId,
      input.requesterUserId,
    );
    const message = await this.repository.getHumanMessage(input.messageId);
    if (
      message === null ||
      message.connectionId !== input.connectionId ||
      message.senderUserId === input.requesterUserId
    ) {
      throw new ProductError(
        "MESSAGE_NOT_FOUND",
        "The message is not an incoming message in this connection",
        false,
      );
    }
    const claim = await this.createRunningRecord({
      ...input,
      requestType: "analyze",
      sourceMessageId: message.id,
    });
    if (!claim.claimed) return AnalyzeAssistResponseSchema.parse(this.toResponse(claim.record));
    const record = claim.record;
    try {
      const result = await this.agentClient.analyzeIncoming({
        requestId: record.id,
        idempotencyKey: `${input.requesterUserId}:${input.clientRequestId}`,
        requesterUserId: input.requesterUserId,
        connectionId: input.connectionId,
        sourceMessageId: message.id,
        sourceText: message.content,
        senderUserId: message.senderUserId,
        agentId: agentForUser(connection, input.requesterUserId),
        traceId: input.traceId,
      });
      this.assertAgentTrace(result.traceId, record.traceId);
      assertAssistTransition(record.status, "completed");
      const completed: AssistRequestRecord = {
        ...record,
        status: "completed",
        result: { interpretation: result.interpretation, replyRoutes: result.replyRoutes },
        completedAt: this.now(),
      };
      const response = AnalyzeAssistResponseSchema.parse(this.toResponse(completed));
      await this.commitResult(completed, "agent_assist.completed", "completed");
      return response;
    } catch (error) {
      await this.failRequest(record, error);
      throw this.mapAgentError(error);
    }
  }

  async polish(input: {
    connectionId: string;
    requesterUserId: string;
    draft: string;
    replyToMessageId: string | null;
    clientRequestId: string;
    traceId: string;
  }): Promise<PolishAssistResponse> {
    const existing = await this.repository.findAssistRequest(
      input.requesterUserId,
      input.clientRequestId,
    );
    if (existing !== null) return PolishAssistResponseSchema.parse(this.toResponse(existing));
    await this.rateLimiter.consume(`assist:${input.requesterUserId}`);
    const connection = await this.requireEstablishedConnection(
      input.connectionId,
      input.requesterUserId,
    );
    if (input.replyToMessageId !== null) {
      const replyTo = await this.repository.getHumanMessage(input.replyToMessageId);
      if (replyTo === null || replyTo.connectionId !== input.connectionId) {
        throw new ProductError(
          "MESSAGE_NOT_FOUND",
          "Reply target does not belong to this connection",
          false,
        );
      }
    }
    const claim = await this.createRunningRecord({
      ...input,
      requestType: "polish",
      sourceMessageId: null,
    });
    if (!claim.claimed) return PolishAssistResponseSchema.parse(this.toResponse(claim.record));
    const record = claim.record;
    try {
      const result = await this.agentClient.polishDraft({
        requestId: record.id,
        idempotencyKey: `${input.requesterUserId}:${input.clientRequestId}`,
        requesterUserId: input.requesterUserId,
        connectionId: input.connectionId,
        draft: input.draft,
        replyToMessageId: input.replyToMessageId,
        agentId: agentForUser(connection, input.requesterUserId),
        traceId: input.traceId,
      });
      this.assertAgentTrace(result.traceId, record.traceId);
      assertAssistTransition(record.status, "completed");
      const completed: AssistRequestRecord = {
        ...record,
        status: "completed",
        result: { candidates: result.candidates },
        completedAt: this.now(),
      };
      const response = PolishAssistResponseSchema.parse(this.toResponse(completed));
      await this.commitResult(completed, "agent_assist.completed", "completed");
      return response;
    } catch (error) {
      await this.failRequest(record, error);
      throw this.mapAgentError(error);
    }
  }

  async getPrivateResult(requestId: string, requesterUserId: string): Promise<AssistRequestRecord> {
    const result = await this.repository.getAssistRequest(requestId);
    if (result === null || result.requesterUserId !== requesterUserId) {
      throw new ProductError(
        "CONNECTION_FORBIDDEN",
        "Assist result is private to its requester",
        false,
      );
    }
    return result;
  }

  private async requireEstablishedConnection(connectionId: string, userId: string) {
    const connection = await this.repository.getConnection(connectionId);
    if (connection === null) {
      throw new ProductError("CONNECTION_FORBIDDEN", "Connection not found", false);
    }
    assertConnectionParticipant(connection, userId);
    if (connection.status !== "established") {
      throw new ProductError(
        "CONNECTION_FORBIDDEN",
        "Connection is not open for human chat",
        false,
      );
    }
    return connection;
  }

  private async createRunningRecord(input: {
    connectionId: string;
    requesterUserId: string;
    clientRequestId: string;
    traceId: string;
    requestType: "analyze" | "polish";
    sourceMessageId: string | null;
  }): Promise<{ record: AssistRequestRecord; claimed: boolean }> {
    const queued: AssistRequestRecord = {
      id: randomUUID(),
      connectionId: input.connectionId,
      requesterUserId: input.requesterUserId,
      requestType: input.requestType,
      sourceMessageId: input.sourceMessageId,
      clientRequestId: input.clientRequestId,
      status: "queued",
      result: null,
      traceId: input.traceId,
      errorCode: null,
      createdAt: this.now(),
      completedAt: null,
    };
    const saved = await this.repository.saveAssistRequest(queued);
    if (saved.id !== queued.id) return { record: saved, claimed: false };
    assertAssistTransition("queued", "running");
    return {
      record: await this.repository.saveAssistRequest({ ...queued, status: "running" }),
      claimed: true,
    };
  }

  private async failRequest(record: AssistRequestRecord, error: unknown): Promise<void> {
    assertAssistTransition(record.status, "failed");
    const mapped = this.mapAgentError(error);
    const failed = {
      ...record,
      status: "failed",
      errorCode: mapped.code,
      completedAt: this.now(),
    } satisfies AssistRequestRecord;
    await this.commitResult(failed, "agent_assist.failed", "failed");
  }

  private mapAgentError(error: unknown): ProductError {
    if (error instanceof ProductError) return error;
    if (error instanceof AgentClientError)
      return new ProductError(error.code, error.message, error.retryable);
    return new ProductError("AGENT_UNAVAILABLE", "Agent is temporarily unavailable", true);
  }

  private assertAgentTrace(actualTraceId: string, expectedTraceId: string): void {
    if (actualTraceId !== expectedTraceId) {
      throw new ProductError("AGENT_INVALID_RESPONSE", "Agent response trace did not match", false);
    }
  }

  private toResponse(record: AssistRequestRecord): unknown {
    return {
      requestId: record.id,
      status: record.status,
      result: record.result,
      traceId: record.traceId,
    };
  }

  private async commitResult(
    record: AssistRequestRecord,
    eventType: string,
    outcome: "completed" | "failed",
  ): Promise<void> {
    await this.repository.saveAssistRequestWithEventAndAudit(
      record,
      {
        id: randomUUID(),
        eventType,
        subjectId: record.id,
        traceId: record.traceId,
        idempotencyKey: `${eventType}:${record.id}`,
        payload: { connectionId: record.connectionId, requesterUserId: record.requesterUserId },
        occurredAt: this.now(),
      },
      {
        id: randomUUID(),
        actorUserId: record.requesterUserId,
        action: `agent_assist.${record.requestType}`,
        subjectId: record.id,
        traceId: record.traceId,
        outcome,
        metadata: {
          connectionId: record.connectionId,
          errorCode: record.errorCode,
        },
        createdAt: this.now(),
      },
    );
  }
}
