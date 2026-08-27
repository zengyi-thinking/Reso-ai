import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { TestAgentClient } from "./test-agent-client.js";
import { buildApp } from "../src/app.js";
import type { ConnectionRecord } from "../src/product/entities.js";
import { InMemoryProductRepository } from "../src/product/in-memory-repository.js";
import { TeaPartyService } from "../src/product/tea-party-service.js";

const userA = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a01";
const userB = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a02";
const userC = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a03";
const agentA = "0198d4f3-2f34-7c52-95cc-7ff4f6f93b01";
const agentB = "0198d4f3-2f34-7c52-95cc-7ff4f6f93b02";
const connectionId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93c01";
const traceId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93e01";

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());

function connection(overrides: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
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
    ...overrides,
  };
}

const sessionResolver = async (request: FastifyRequest) => {
  const userId = request.headers["x-test-user-id"];
  return typeof userId === "string" ? userId : null;
};

describe("Tea Party query and notification API", () => {
  it("returns ordered records to both participants and denies a third party", async () => {
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const orchestrator = new TeaPartyService(repository, new TestAgentClient(), { maxTurns: 6 });
    await orchestrator.onRelationshipEstablished(connectionId, traceId);
    await orchestrator.run(connectionId);
    app = await buildApp({
      agentClient: new TestAgentClient(),
      repository,
      sessionUserResolver: sessionResolver,
    });
    const mine = await app.inject({
      method: "GET",
      url: `/api/connections/${connectionId}/tea-party`,
      headers: { "x-test-user-id": userA },
    });
    const theirs = await app.inject({
      method: "GET",
      url: `/api/connections/${connectionId}/tea-party`,
      headers: { "x-test-user-id": userB },
    });
    const thirdParty = await app.inject({
      method: "GET",
      url: `/api/connections/${connectionId}/tea-party`,
      headers: { "x-test-user-id": userC },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().status).toBe("ready");
    expect(mine.json().messages.map((message: { turnNo: number }) => message.turnNo)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(theirs.json().messages[0].speakerLabel).toBe("their_agent");
    expect(thirdParty.statusCode).toBe(403);
  });

  it("returns precise not-available, permission-required, and blocked states", async () => {
    for (const [record, expected] of [
      [connection({ status: "pending" }), "not_available"],
      [connection({ userAProxyConsent: false }), "permission_required"],
      [connection({ status: "blocked", blockedByUserId: userB }), "blocked"],
    ] as const) {
      const repository = new InMemoryProductRepository({ connections: [record] });
      app = await buildApp({
        agentClient: new TestAgentClient(),
        repository,
        sessionUserResolver: sessionResolver,
      });
      const response = await app.inject({
        method: "GET",
        url: `/api/connections/${connectionId}/tea-party`,
        headers: { "x-test-user-id": userA },
      });
      expect(response.json().status).toBe(expected);
      expect(response.json().messages).toEqual([]);
      await app.close();
      app = undefined;
    }
  });

  it("exposes ready notifications only to connection participants", async () => {
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const orchestrator = new TeaPartyService(repository, new TestAgentClient(), { maxTurns: 6 });
    await orchestrator.onRelationshipEstablished(connectionId, traceId);
    await orchestrator.run(connectionId);
    app = await buildApp({
      agentClient: new TestAgentClient(),
      repository,
      sessionUserResolver: sessionResolver,
    });
    const participant = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { "x-test-user-id": userA },
    });
    const thirdParty = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { "x-test-user-id": userC },
    });
    expect(participant.json().events).toHaveLength(1);
    expect(participant.json().events[0]).toMatchObject({ type: "tea_party.ready", traceId });
    expect(thirdParty.json().events).toEqual([]);

    await repository.saveConnection(connection({ status: "blocked", blockedByUserId: userB }));
    const afterBlock = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { "x-test-user-id": userA },
    });
    expect(afterBlock.json().events).toEqual([]);
  });

  it("rejects retry unless the current mission is retryable", async () => {
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const orchestrator = new TeaPartyService(repository, new TestAgentClient(), { maxTurns: 6 });
    await orchestrator.onRelationshipEstablished(connectionId, traceId);
    await orchestrator.run(connectionId);
    app = await buildApp({
      agentClient: new TestAgentClient(),
      repository,
      sessionUserResolver: sessionResolver,
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/connections/${connectionId}/tea-party/retry`,
      headers: { "x-test-user-id": userA },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("RETRY_NOT_ALLOWED");
  });

  it("streams a ready notification over SSE without exposing message content", async () => {
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const orchestrator = new TeaPartyService(repository, new TestAgentClient(), { maxTurns: 6 });
    await orchestrator.onRelationshipEstablished(connectionId, traceId);
    await orchestrator.run(connectionId);
    app = await buildApp({
      agentClient: new TestAgentClient(),
      repository,
      sessionUserResolver: sessionResolver,
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/notifications/stream`, {
      headers: { "x-test-user-id": userA },
      signal: controller.signal,
    });
    if (response.body === null) throw new Error("Expected SSE response body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let payload = "";
    while (!payload.includes("tea_party.ready")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      payload += decoder.decode(chunk.value);
    }
    controller.abort();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(payload).toContain("tea_party.ready");
    expect(payload).not.toContain("我家主人");
  });
});
