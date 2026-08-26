import type { AnalyzeIncomingRequest } from "@reso/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { MockAgentClient } from "../src/agent-client/mock-agent-client.js";
import { buildApp } from "../src/app.js";
import { InMemoryProductRepository } from "../src/product/in-memory-repository.js";
import { InMemoryWindowRateLimiter } from "../src/product/rate-limiter.js";

const userA = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a01";
const userB = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a02";
const userC = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a03";
const agentA = "0198d4f3-2f34-7c52-95cc-7ff4f6f93b01";
const agentB = "0198d4f3-2f34-7c52-95cc-7ff4f6f93b02";
const connectionId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93c01";
const messageId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93d01";
const traceId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93e01";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function repository() {
  return new InMemoryProductRepository({
    connections: [
      {
        id: connectionId,
        userAId: userA,
        userBId: userB,
        agentAId: agentA,
        agentBId: agentB,
        status: "established",
        userAProxyConsent: true,
        userBProxyConsent: true,
        blockedByUserId: null,
        establishedAt: "2026-08-26T08:00:00+08:00",
      },
    ],
    messages: [
      {
        id: messageId,
        connectionId,
        senderUserId: userB,
        content: "周末有空吗？",
        clientMessageId: "seed-message",
        traceId,
        createdAt: "2026-08-26T08:00:01+08:00",
      },
    ],
  });
}

const sessionResolver = async (request: FastifyRequest): Promise<string | null> => {
  const value = request.headers["x-test-user-id"];
  return typeof value === "string" ? value : null;
};

class SlowCountingAgentClient extends MockAgentClient {
  calls = 0;

  override async analyzeIncoming(
    request: Parameters<MockAgentClient["analyzeIncoming"]>[0],
  ): ReturnType<MockAgentClient["analyzeIncoming"]> {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return super.analyzeIncoming(request);
  }
}

describe("Agent Assist Product API", () => {
  it("analyzes an incoming message idempotently and keeps the result private", async () => {
    const store = repository();
    app = await buildApp({
      agentClient: new MockAgentClient(),
      repository: store,
      sessionUserResolver: sessionResolver,
    });
    const request = {
      method: "POST" as const,
      url: `/api/connections/${connectionId}/assist/analyze`,
      headers: { "x-test-user-id": userA, "x-trace-id": traceId },
      payload: { messageId, clientRequestId: "analyze-1" },
    };
    const first = await app.inject(request);
    const duplicate = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(first.json());
    expect(first.json().traceId).toBe(traceId);

    const ownRead = await app.inject({
      method: "GET",
      url: `/api/assist/${first.json().requestId}`,
      headers: { "x-test-user-id": userA },
    });
    const otherParticipantRead = await app.inject({
      method: "GET",
      url: `/api/assist/${first.json().requestId}`,
      headers: { "x-test-user-id": userB },
    });
    const thirdPartyRead = await app.inject({
      method: "GET",
      url: `/api/assist/${first.json().requestId}`,
      headers: { "x-test-user-id": userC },
    });
    expect(ownRead.statusCode).toBe(200);
    expect(otherParticipantRead.statusCode).toBe(403);
    expect(thirdPartyRead.statusCode).toBe(403);
  });

  it("lets only the idempotency-key creator call Agent under concurrency", async () => {
    const agentClient = new SlowCountingAgentClient();
    app = await buildApp({
      agentClient,
      repository: repository(),
      sessionUserResolver: sessionResolver,
    });
    const request = {
      method: "POST" as const,
      url: `/api/connections/${connectionId}/assist/analyze`,
      headers: { "x-test-user-id": userA, "x-trace-id": traceId },
      payload: { messageId, clientRequestId: "analyze-concurrent" },
    };

    const [left, right] = await Promise.all([app.inject(request), app.inject(request)]);
    const responses = [left.json(), right.json()];

    expect(agentClient.calls).toBe(1);
    expect(new Set(responses.map((response) => response.requestId)).size).toBe(1);
    expect(responses.some((response) => response.status === "completed")).toBe(true);
    expect(responses.every((response) => ["running", "completed"].includes(response.status))).toBe(
      true,
    );
  });

  it("rejects an Agent Assist response with a mismatched trace", async () => {
    class WrongTraceClient extends MockAgentClient {
      override async analyzeIncoming(request: AnalyzeIncomingRequest) {
        return { ...(await super.analyzeIncoming(request)), traceId: userB };
      }
    }
    const store = repository();
    app = await buildApp({
      agentClient: new WrongTraceClient(),
      repository: store,
      sessionUserResolver: sessionResolver,
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/connections/${connectionId}/assist/analyze`,
      headers: { "x-test-user-id": userA },
      payload: { messageId, clientRequestId: "wrong-trace" },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("AGENT_INVALID_RESPONSE");
  });

  it("returns polish candidates without creating or sending a human message", async () => {
    const store = repository();
    app = await buildApp({
      agentClient: new MockAgentClient(),
      repository: store,
      sessionUserResolver: sessionResolver,
    });
    const before = await store.countHumanMessages(connectionId);
    const response = await app.inject({
      method: "POST",
      url: `/api/connections/${connectionId}/assist/polish`,
      headers: { "x-test-user-id": userA, "x-trace-id": traceId },
      payload: { draft: "你怎么又不回我", clientRequestId: "polish-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.candidates).toHaveLength(1);
    expect(await store.countHumanMessages(connectionId)).toBe(before);
  });

  it("keeps human chat usable when Agent is offline", async () => {
    const store = repository();
    app = await buildApp({
      agentClient: new MockAgentClient("unavailable"),
      repository: store,
      sessionUserResolver: sessionResolver,
    });
    const assist = await app.inject({
      method: "POST",
      url: `/api/connections/${connectionId}/assist/polish`,
      headers: { "x-test-user-id": userA, "x-trace-id": traceId },
      payload: { draft: "你好", clientRequestId: "offline-assist" },
    });
    const humanMessage = await app.inject({
      method: "POST",
      url: `/api/connections/${connectionId}/messages`,
      headers: { "x-test-user-id": userA, "x-trace-id": traceId },
      payload: { content: "真人消息仍可发送", clientMessageId: "human-1" },
    });
    expect(assist.statusCode).toBe(503);
    expect(assist.json().code).toBe("AGENT_UNAVAILABLE");
    expect(humanMessage.statusCode).toBe(201);
    expect(await store.countHumanMessages(connectionId)).toBe(2);
  });

  it("requires a server-side session and enforces rate limiting", async () => {
    app = await buildApp({
      agentClient: new MockAgentClient(),
      repository: repository(),
      rateLimiter: new InMemoryWindowRateLimiter(1, 60_000),
      sessionUserResolver: sessionResolver,
    });
    const anonymous = await app.inject({
      method: "POST",
      url: `/api/connections/${connectionId}/assist/polish`,
      payload: { draft: "你好", clientRequestId: "anon" },
    });
    await app.inject({
      method: "POST",
      url: `/api/connections/${connectionId}/assist/polish`,
      headers: { "x-test-user-id": userA },
      payload: { draft: "你好", clientRequestId: "rate-1" },
    });
    const limited = await app.inject({
      method: "POST",
      url: `/api/connections/${connectionId}/assist/polish`,
      headers: { "x-test-user-id": userA },
      payload: { draft: "再次请求", clientRequestId: "rate-2" },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(limited.statusCode).toBe(429);
  });
});
