import { describe, expect, it } from "vitest";
import { ConnectionLifecycleService } from "../src/product/connection-lifecycle-service.js";
import { InMemoryProductRepository } from "../src/product/in-memory-repository.js";

const userA = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a01";
const userB = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a02";
const outsider = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a03";
const connectionId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93c01";
const traceId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93e01";

function repository() {
  return new InMemoryProductRepository({
    connections: [
      {
        id: connectionId,
        userAId: userA,
        userBId: userB,
        agentAId: "0198d4f3-2f34-7c52-95cc-7ff4f6f93b01",
        agentBId: "0198d4f3-2f34-7c52-95cc-7ff4f6f93b02",
        status: "pending",
        userAProxyConsent: false,
        userBProxyConsent: false,
        blockedByUserId: null,
        establishedAt: null,
      },
    ],
  });
}

describe("Connection lifecycle committed events", () => {
  it("commits relationship, consent, and block facts with their outbox events", async () => {
    const store = repository();
    const service = new ConnectionLifecycleService(store, () => "2026-08-26T08:00:00.000Z");

    await service.establish(connectionId, traceId);
    await service.setProxyConsent(connectionId, userA, true, traceId);
    await service.setProxyConsent(connectionId, userB, true, traceId);
    await service.block(connectionId, userA, traceId);

    const connection = await store.getConnection(connectionId);
    const events = await store.listOutboxEvents();
    expect(connection).toMatchObject({
      status: "blocked",
      userAProxyConsent: true,
      userBProxyConsent: true,
      blockedByUserId: userA,
    });
    expect(events.map((event) => event.eventType)).toEqual([
      "connection.established",
      "consent.granted",
      "consent.granted",
      "connection.blocked",
    ]);
  });

  it("rejects lifecycle commands from a non-participant", async () => {
    const service = new ConnectionLifecycleService(repository());
    await expect(
      service.setProxyConsent(connectionId, outsider, true, traceId),
    ).rejects.toMatchObject({ code: "CONNECTION_FORBIDDEN" });
  });

  it("does not lose either participant's consent when grants race", async () => {
    const store = repository();
    const service = new ConnectionLifecycleService(store);
    await service.establish(connectionId, traceId);

    await Promise.all([
      service.setProxyConsent(connectionId, userA, true, traceId),
      service.setProxyConsent(connectionId, userB, true, traceId),
    ]);

    expect(await store.getConnection(connectionId)).toMatchObject({
      userAProxyConsent: true,
      userBProxyConsent: true,
    });
  });
});
