import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  AgentReflectionRequest,
  AgentReflectionResponse,
  EventEnvelope,
} from "@reso/contracts";
import type { VerticalSliceRepository } from "./repository.js";

/** Narrow structural client so Worker tests can stub just `reflect`. */
export interface ReflectionAgentClient {
  reflect(request: AgentReflectionRequest): Promise<AgentReflectionResponse>;
}

const MessageCreatedPayloadSchema = z.object({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["user", "agent"]).default("user"),
  occurredAt: z.string().min(1),
});

/**
 * Closes the growth loop: batch-reflect over accumulated messages and persist
 * reviewable candidates. Runs inside the Worker (never the request path).
 *
 * Trigger rule: reflect once per conversation when at least `threshold` user
 * messages exist after the last reflection watermark. Conversations without a
 * claimed persona produce no patch candidates (persona_versions FK) - memory
 * candidates for claimed users only, because getAgentContext gates on identity.
 */
export class ReflectionOrchestrationService {
  constructor(
    private readonly repository: VerticalSliceRepository,
    private readonly agentClient: ReflectionAgentClient,
    private readonly threshold = Number(process.env.WORKER_REFLECTION_THRESHOLD ?? "4"),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async handleUserMessageCreated(envelope: EventEnvelope): Promise<boolean> {
    if (envelope.type !== "message.created") return false;
    const parsed = MessageCreatedPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      throw new Error("INVALID_MESSAGE_CREATED_PAYLOAD");
    }
    const payload = parsed.data;
    if (payload.role !== "user") return true;

    const watermark = await this.repository.reflectionWatermarkAfter(payload.conversationId);
    const unreflectedCount = await this.repository.countUserMessagesAfter(
      payload.conversationId,
      watermark,
    );
    // Below threshold the event is consumed with no work - the next message
    // re-evaluates, so no scheduling state is needed beyond the watermark.
    if (unreflectedCount < this.threshold) return true;

    const context = await this.repository.getAgentContext(payload.userId, payload.conversationId);
    // Unclaimed guests have neither primary agent nor persona version yet;
    // their reflection starts after claim, keeping the patch FK honest.
    if (context === null || context.persona === null) return true;

    const response = await this.agentClient.reflect({
      userId: payload.userId,
      conversationId: payload.conversationId,
      messageIds: [payload.messageId],
      transcript: context.recentMessages.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
      })),
      persona: {
        versionId: context.persona.id,
        version: `v${context.persona.version}.0`,
        content: context.persona.content,
      },
      memories: context.memories,
    });

    const transcriptIds = new Set(context.recentMessages.map((row) => row.id));
    const memories = response.memoryCandidates
      .filter(
        (candidate) =>
          candidate.evidenceMessageIds.length > 0 &&
          candidate.evidenceMessageIds.every((id) => transcriptIds.has(id)),
      )
      .map((candidate) => ({
        sourceMessageId: candidate.evidenceMessageIds[0] ?? payload.messageId,
        type: candidate.type,
        summary: candidate.summary,
        evidenceMessageIds: [...candidate.evidenceMessageIds],
        confidence: candidate.confidence,
      }));
    const patches = response.personaPatchCandidates
      .filter(
        (candidate) =>
          candidate.confidence >= 0 && candidate.evidenceIds.every((id) => transcriptIds.has(id)),
      )
      .map((candidate) => ({
        fromVersionId: context.persona!.id,
        path: candidate.path,
        oldValue: candidate.oldValue ?? null,
        proposedValue: candidate.proposedValue ?? null,
        reason: candidate.reason,
        evidenceMessageIds: [...candidate.evidenceIds],
        confidence: candidate.confidence,
      }));

    await this.repository.saveReflectionResults({
      userId: payload.userId,
      memories,
      patches,
      now: this.now().toISOString(),
    });
    await this.repository.advanceReflectionRun({
      userId: payload.userId,
      conversationId: payload.conversationId,
      lastReflectedAt: payload.occurredAt,
      now: this.now().toISOString(),
    });
    return true;
  }

  /** Stable envelope factory for tests and replays. */
  static messageCreatedEnvelope(input: {
    messageId: string;
    conversationId: string;
    userId: string;
    role?: "user" | "agent";
    occurredAt: string;
    correlationId?: string | null;
  }): EventEnvelope {
    return {
      id: randomUUID(),
      type: "message.created",
      version: 1,
      occurredAt: input.occurredAt,
      producer: "reso-api",
      correlationId: input.correlationId ?? randomUUID(),
      causationId: null,
      subjectId: input.userId,
      payload: {
        messageId: input.messageId,
        conversationId: input.conversationId,
        userId: input.userId,
        role: input.role ?? "user",
        occurredAt: input.occurredAt,
      },
    };
  }
}
