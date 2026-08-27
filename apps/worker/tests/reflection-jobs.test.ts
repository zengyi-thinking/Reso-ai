import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@reso/contracts";
import type { AgentReflectionRequest, AgentReflectionResponse } from "@reso/contracts";
import { InMemoryVerticalSliceRepository } from "@reso/api/vertical-slice/in-memory-repository";
import {
  ReflectionOrchestrationService,
  type ReflectionAgentClient,
} from "@reso/api/vertical-slice/reflection-service";

const EPOCH = "1970-01-01T00:00:00Z";

interface Harness {
  repository: InMemoryVerticalSliceRepository;
  service: ReflectionOrchestrationService;
  reflect: ReturnType<typeof vi.fn>;
  userId: string;
  conversationId: string;
}

function correctionResponse(): AgentReflectionResponse {
  return {
    memoryCandidates: [
      {
        type: "correction",
        summary: "用户明确纠正了此前的解释，应以本次表达为准。",
        evidenceMessageIds: [],
        confidence: 0.9,
        requiresReview: true,
      },
    ],
    personaPatchCandidates: [],
  };
}

async function seedClaimedConversation(
  repository: InMemoryVerticalSliceRepository,
): Promise<{ userId: string; conversationId: string }> {
  const { user } = await repository.findOrCreateUser(
    "grower@example.com",
    new Date().toISOString(),
  );
  const guestId = randomUUID();
  await repository.createGuest({
    id: guestId,
    tokenHash: "g".repeat(64),
    status: "confirmed",
    answers: null,
    personaDraft: {
      identity: {},
      values: ["真诚"],
      socialStyle: {},
      communicationStyle: {},
      relationshipNeeds: ["稳定的陪伴"],
      boundaries: [],
      interests: [],
      currentGoals: [],
      confirmedPatterns: ["慢热"],
      uncertainHypotheses: [],
    },
    corrections: [],
    userId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const identity = await repository.claimGuest(guestId, user.id, "团子", new Date().toISOString());
  if (identity.agent === null || identity.persona === null) throw new Error("seed failed");
  const conversation = await repository.createConversation(
    user.id,
    identity.agent.id,
    new Date().toISOString(),
  );
  return { userId: user.id, conversationId: conversation.id };
}

async function sendUserMessage(
  repository: InMemoryVerticalSliceRepository,
  conversationId: string,
  content: string,
  offsetSeconds: number,
): Promise<{ messageId: string; occurredAt: string }> {
  const occurredAt = new Date(Date.parse(EPOCH) + offsetSeconds * 1_000).toISOString();
  const message = await repository.saveMessage({
    id: randomUUID(),
    conversationId,
    role: "user",
    content,
    publicEvents: [],
    createdAt: occurredAt,
  });
  await repository.saveMessage({
    id: randomUUID(),
    conversationId,
    role: "agent",
    content: "我在听。",
    publicEvents: [],
    createdAt: new Date(Date.parse(occurredAt) + 500).toISOString(),
  });
  return { messageId: message.id, occurredAt };
}

function envelopeFor(input: {
  messageId: string;
  conversationId: string;
  userId: string;
  occurredAt: string;
}): EventEnvelope {
  return ReflectionOrchestrationService.messageCreatedEnvelope(input);
}

describe("Reflection growth loop", () => {
  async function harness(threshold = 4): Promise<Harness> {
    const repository = new InMemoryVerticalSliceRepository();
    const seeded = await seedClaimedConversation(repository);
    // Fill the transcript evidence with the newest user-message id so persisted
    // candidates reference a real message.
    const reflect = vi.fn(async (request: AgentReflectionRequest) => {
      const base = correctionResponse();
      const lastUser = [...request.transcript].reverse().find((row) => row.role === "user");
      return {
        ...base,
        memoryCandidates: base.memoryCandidates.map((candidate) => ({
          ...candidate,
          evidenceMessageIds: lastUser === undefined ? [] : [lastUser.id],
        })),
      };
    });
    const agentClient: ReflectionAgentClient = { reflect };
    return {
      repository,
      service: new ReflectionOrchestrationService(repository, agentClient, threshold),
      reflect,
      ...seeded,
    };
  }

  it("consumes sub-threshold messages without producing candidates", async () => {
    const h = await harness(4);
    const { messageId, occurredAt } = await sendUserMessage(
      h.repository,
      h.conversationId,
      "今天一般般。",
      10,
    );
    expect(
      await h.service.handleUserMessageCreated(
        envelopeFor({ messageId, conversationId: h.conversationId, userId: h.userId, occurredAt }),
      ),
    ).toBe(true);
    expect(h.reflect).not.toHaveBeenCalled();
    expect(await h.repository.listPendingMemoryCandidates(h.userId)).toHaveLength(0);
    expect(await h.repository.reflectionWatermarkAfter(h.conversationId)).toBe(EPOCH);
  });

  it("reflects at the threshold, persists a correction candidate and advances the watermark", async () => {
    const h = await harness(4);
    let last = { messageId: "", occurredAt: EPOCH };
    for (let index = 1; index <= 4; index += 1) {
      const content =
        index === 4 ? "上次你说我慢热，其实我只是不喜欢无意义的社交。" : `日常记录 ${index}`;
      last = await sendUserMessage(h.repository, h.conversationId, content, index * 10);
      await h.service.handleUserMessageCreated(
        envelopeFor({ ...last, conversationId: h.conversationId, userId: h.userId }),
      );
    }
    expect(h.reflect).toHaveBeenCalledTimes(1);
    const pending = await h.repository.listPendingMemoryCandidates(h.userId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      type: "correction",
      status: "pending",
      requiresReview: true,
    });
    expect(pending[0]?.evidenceMessageIds).toContain(last.messageId);
    expect(await h.repository.reflectionWatermarkAfter(h.conversationId)).toBe(last.occurredAt);
  });

  it("does not re-reflect before the next threshold window", async () => {
    const h = await harness(4);
    let last = { messageId: "", occurredAt: EPOCH };
    for (let index = 1; index <= 4; index += 1) {
      last = await sendUserMessage(h.repository, h.conversationId, `填充 ${index}`, index * 10);
      await h.service.handleUserMessageCreated(
        envelopeFor({ ...last, conversationId: h.conversationId, userId: h.userId }),
      );
    }
    await h.service.handleUserMessageCreated(
      envelopeFor({ ...last, conversationId: h.conversationId, userId: h.userId }),
    );
    // Replay must not run a second reflection nor duplicate candidates.
    expect(h.reflect).toHaveBeenCalledTimes(1);
    expect(await h.repository.listPendingMemoryCandidates(h.userId)).toHaveLength(1);
  });

  it("skips reflections for conversations without a claimed persona", async () => {
    const repository = new InMemoryVerticalSliceRepository();
    await repository.findOrCreateUser("ghost@example.com", new Date().toISOString());
    const conversation = await repository.createConversation(
      randomUUID(),
      randomUUID(),
      new Date().toISOString(),
    );
    const reflect = vi.fn(async (_request: AgentReflectionRequest) => correctionResponse());
    const service = new ReflectionOrchestrationService(repository, { reflect }, 1);
    const { messageId, occurredAt } = await sendUserMessage(
      repository,
      conversation.id,
      "有人吗？",
      10,
    );
    expect(
      await service.handleUserMessageCreated(
        envelopeFor({
          messageId,
          conversationId: conversation.id,
          userId: randomUUID(),
          occurredAt,
        }),
      ),
    ).toBe(true);
    expect(reflect).not.toHaveBeenCalled();
  });
});
