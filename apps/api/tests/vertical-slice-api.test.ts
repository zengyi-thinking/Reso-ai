import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { EmailCodeMailer } from "../src/auth/email-mailer.js";
import { buildApp } from "../src/app.js";
import { InMemoryProductRepository } from "../src/product/in-memory-repository.js";
import { InMemoryVerticalSliceRepository } from "../src/vertical-slice/in-memory-repository.js";
import { TestAgentClient } from "./test-agent-client.js";
import type { AgentStatusEvent, AgentTurnRequest } from "@reso/contracts";

class CapturingMailer implements EmailCodeMailer {
  code = "";
  async sendCode(_email: string, code: string): Promise<void> {
    this.code = code;
  }
}

class ContextCapturingAgentClient extends TestAgentClient {
  lastTurn: AgentTurnRequest | null = null;
  override async turn(request: AgentTurnRequest, onProgress?: (event: AgentStatusEvent) => void) {
    this.lastTurn = request;
    return super.turn(request, onProgress);
  }
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

interface OnboardedSession {
  sessionToken: string;
  conversationId: string;
  guestToken: string;
}

async function onboardAndClaim(
  fastify: FastifyInstance,
  mailer: CapturingMailer,
): Promise<OnboardedSession> {
  const guestResponse = await fastify.inject({ method: "POST", url: "/api/onboarding/guest" });
  expect(guestResponse.statusCode).toBe(201);
  const guestToken = guestResponse.json().guestToken as string;

  const quickStart = await fastify.inject({
    method: "PUT",
    url: "/api/onboarding/quick-start",
    headers: { "x-guest-token": guestToken },
    payload: {
      answers: {
        mbti: "INFJ",
        zodiac: null,
        relationshipGoal: "真诚的长期关系",
        communicationPreference: "有内容、直接但温和",
        socialPreference: "少量但深入",
      },
    },
  });
  expect(quickStart.statusCode).toBe(200);
  const draft = quickStart.json().personaDraft;
  draft.boundaries = ["需要独处时，希望对方先给我一点空间"];
  const confirmation = await fastify.inject({
    method: "PUT",
    url: "/api/onboarding/persona-draft",
    headers: { "x-guest-token": guestToken },
    payload: { content: draft },
  });
  expect(confirmation.statusCode).toBe(200);

  await fastify.inject({
    method: "POST",
    url: "/api/auth/email/send-code",
    payload: { email: "new-user@example.com" },
  });
  const verification = await fastify.inject({
    method: "POST",
    url: "/api/auth/email/verify-code",
    payload: { email: "new-user@example.com", code: mailer.code, guestToken },
  });
  expect(verification.statusCode).toBe(200);
  const sessionToken = verification.json().sessionToken as string;
  const authorization = { authorization: `Bearer ${sessionToken}` };

  const claim = await fastify.inject({
    method: "POST",
    url: "/api/agents/claim",
    headers: authorization,
    payload: { guestToken, agentName: "Reso" },
  });
  expect(claim.statusCode).toBe(200);

  const created = await fastify.inject({
    method: "POST",
    url: "/api/conversations",
    headers: authorization,
  });
  return { sessionToken, conversationId: created.json().id as string, guestToken };
}

describe("Reso Product Vertical Slice", () => {
  it("migrates a confirmed guest into a user, Persona v1.0, primary Agent and persistent chat", async () => {
    const mailer = new CapturingMailer();
    const agentClient = new ContextCapturingAgentClient();
    app = await buildApp({
      agentClient,
      repository: new InMemoryProductRepository(),
      verticalSliceRepository: new InMemoryVerticalSliceRepository(),
      emailCodeMailer: mailer,
      authCodeHashSecret: "vertical-slice-test-secret",
    });
    const onboardingUser = await onboardAndClaim(app, mailer);
    const token = onboardingUser.sessionToken;
    const authorization = { authorization: `Bearer ${token}` };

    const stream = await app.inject({
      method: "POST",
      url: `/api/conversations/${onboardingUser.conversationId}/turns/stream`,
      headers: authorization,
      payload: {
        message: "你现在对我了解多少？",
        clientMessageId: "first-message",
        publicProcessMode: "relationship_deep_dive",
      },
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain('"type":"status"');
    expect(stream.body).toContain('"label":"先找一个具体共鸣"');
    expect(stream.body).toContain('"type":"message"');
    expect(stream.body).toContain('"type":"done"');
    expect(agentClient.lastTurn?.context?.persona?.content.boundaries).toEqual([
      "需要独处时，希望对方先给我一点空间",
    ]);

    const restored = await app.inject({
      method: "GET",
      url: `/api/conversations/${onboardingUser.conversationId}`,
      headers: authorization,
    });
    expect(restored.json().messages).toHaveLength(2);
    expect(restored.json().messages[1].publicEvents.length).toBeGreaterThan(1);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: authorization });
    expect(me.json()).toMatchObject({
      user: { email: "new-user@example.com" },
      agent: { name: "Reso" },
    });
  });

  it("emits message.created events and closes the candidate decision loop", async () => {
    class CandidateTurnClient extends TestAgentClient {
      override async turn(request: AgentTurnRequest) {
        const response = await super.turn(request);
        return {
          ...response,
          memoryCandidates: [
            {
              type: "correction" as const,
              summary: "用户明确纠正：并非慢热，而是不喜欢无意义社交。",
              evidenceMessageIds: [randomUUID()],
              confidence: 0.9,
              requiresReview: true,
            },
          ],
        };
      }
    }
    const mailer = new CapturingMailer();
    const verticalSliceRepository = new InMemoryVerticalSliceRepository();
    app = await buildApp({
      agentClient: new CandidateTurnClient(),
      repository: new InMemoryProductRepository(),
      verticalSliceRepository,
      emailCodeMailer: mailer,
      authCodeHashSecret: "vertical-slice-test-secret",
    });

    const onboardingUser = await onboardAndClaim(app, mailer);
    const authorization = { authorization: `Bearer ${onboardingUser.sessionToken}` };

    const turnResponse = await app.inject({
      method: "POST",
      url: `/api/conversations/${onboardingUser.conversationId}/turns/stream`,
      headers: authorization,
      payload: {
        message: "其实我不是慢热，只是讨厌无意义的社交。",
        clientMessageId: "growth-1",
      },
    });
    expect(turnResponse.statusCode).toBe(200);
    // Every persisted user message announces itself through the outbox so the
    // Worker can batch reflections.
    const createdEvents = verticalSliceRepository.outboxEvents.filter(
      (event) => event.eventType === "message.created",
    );
    expect(createdEvents.length).toBe(1);
    expect(createdEvents[0]?.idempotencyKey).toContain("message.created:");

    const listing = await app.inject({
      method: "GET",
      url: "/api/memory-candidates",
      headers: authorization,
    });
    expect(listing.statusCode).toBe(200);
    const candidates = listing.json().candidates as Array<{ id: string; status: string }>;
    expect(candidates.length).toBeGreaterThan(0);
    const candidateId = candidates[0]?.id;
    expect(candidateId).toBeTruthy();

    const decided = await app.inject({
      method: "POST",
      url: `/api/memory-candidates/${candidateId}/decision`,
      headers: authorization,
      payload: { decision: "accept" },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ outcome: "promoted" });

    const replay = await app.inject({
      method: "POST",
      url: `/api/memory-candidates/${candidateId}/decision`,
      headers: authorization,
      payload: { decision: "accept" },
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().code).toBe("CANDIDATE_ALREADY_DECIDED");
  });
});
