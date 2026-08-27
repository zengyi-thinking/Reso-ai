import { randomUUID } from "node:crypto";
import type {
  AgentPublicEvent,
  AgentStatusEvent,
  ProductConversation,
  ProductMessage,
  PublicProcessMode,
} from "@reso/contracts";
import type { IAgentClient } from "../agent-client/agent-client.js";
import { ProductError } from "../product/product-error.js";
import type { VerticalSliceRepository } from "./repository.js";

export class ProductConversationService {
  constructor(
    private readonly repository: VerticalSliceRepository,
    private readonly agentClient: IAgentClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(userId: string): Promise<ProductConversation> {
    const identity = await this.repository.getIdentity(userId);
    if (identity?.agent === null || identity?.agent === undefined || identity.persona === null) {
      throw new ProductError("ONBOARDING_INCOMPLETE", "请先领取你的 Reso Agent。", false);
    }
    return this.repository.createConversation(userId, identity.agent.id, this.now().toISOString());
  }

  async get(userId: string, conversationId: string) {
    const detail = await this.repository.getConversation(userId, conversationId);
    if (detail === null)
      throw new ProductError("CONVERSATION_NOT_FOUND", "没有找到这段对话。", false);
    return detail;
  }

  async list(userId: string) {
    return this.repository.listConversations(userId);
  }
  async identity(userId: string) {
    return this.repository.getIdentity(userId);
  }

  async turn(
    input: {
      userId: string;
      conversationId: string;
      message: string;
      clientMessageId: string;
      publicProcessMode: PublicProcessMode;
    },
    onProgress?: (event: AgentStatusEvent) => void,
  ) {
    const context = await this.repository.getAgentContext(input.userId, input.conversationId);
    if (context === null)
      throw new ProductError("CONVERSATION_NOT_FOUND", "没有找到这段对话。", false);
    let userMessage = await this.repository.findMessageByClientId(
      input.userId,
      input.clientMessageId,
    );
    if (userMessage === null) {
      userMessage = await this.repository.saveMessage(
        {
          id: randomUUID(),
          conversationId: input.conversationId,
          role: "user",
          content: input.message,
          publicEvents: [],
          createdAt: this.now().toISOString(),
        },
        input.clientMessageId,
      );
    }
    // Growth-loop trigger: every persisted user message announces itself so the
    // Worker can batch reflections; idempotency key keeps retries silent.
    await this.repository.appendOutboxEvent({
      id: randomUUID(),
      eventType: "message.created",
      subjectId: input.userId,
      correlationId: null,
      idempotencyKey: `message.created:${userMessage.id}`,
      payload: {
        messageId: userMessage.id,
        conversationId: input.conversationId,
        userId: input.userId,
        role: userMessage.role,
        occurredAt: userMessage.createdAt,
      },
      occurredAt: userMessage.createdAt,
    });
    const requestId = randomUUID();
    const progressEvents: AgentStatusEvent[] = [];
    const response = await this.agentClient.turn(
      {
        requestId,
        userId: input.userId,
        agentId: context.identity.agent!.id,
        conversationId: input.conversationId,
        message: input.message,
        personaVersionId: context.persona.id,
        publicProcessMode: input.publicProcessMode,
        context: {
          persona: {
            versionId: context.persona.id,
            version: `v${context.persona.version}.0`,
            content: context.persona.content,
          },
          memories: context.memories,
          relationship: null,
          recentMessages: context.recentMessages,
          activeProxyConsent: false,
        },
      },
      (event) => {
        progressEvents.push(event);
        onProgress?.(event);
      },
    );
    const streamEvents: AgentPublicEvent[] =
      response.publicEvents.length > 0
        ? response.publicEvents
        : [{ type: "message", position: "final", text: response.message }];
    const serializedProgress = new Set(progressEvents.map((event) => JSON.stringify(event)));
    const remainingEvents = streamEvents.filter(
      (event) => !serializedProgress.has(JSON.stringify(event)),
    );
    const events: AgentPublicEvent[] = [...progressEvents, ...remainingEvents];
    const agentMessage: ProductMessage = await this.repository.saveMessage({
      id: randomUUID(),
      conversationId: input.conversationId,
      role: "agent",
      content: response.message,
      publicEvents: events,
      createdAt: this.now().toISOString(),
    });
    await this.repository.saveMemoryCandidates(
      input.userId,
      userMessage.id,
      response.memoryCandidates,
      this.now().toISOString(),
    );
    return { userMessage, agentMessage, events, remainingEvents, traceId: response.traceId };
  }
}
