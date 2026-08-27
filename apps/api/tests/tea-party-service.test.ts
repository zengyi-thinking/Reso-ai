import type {
  SocialActRequest,
  SocialActResponse,
  SocialEvaluateRequest,
  SocialEvaluateResponse,
} from "@reso/contracts";
import { describe, expect, it } from "vitest";
import { TestAgentClient } from "./test-agent-client.js";
import type { ConnectionRecord } from "../src/product/entities.js";
import { InMemoryProductRepository } from "../src/product/in-memory-repository.js";
import { TeaPartyService } from "../src/product/tea-party-service.js";

const userA = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a01";
const userB = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a02";
const agentA = "0198d4f3-2f34-7c52-95cc-7ff4f6f93b01";
const agentB = "0198d4f3-2f34-7c52-95cc-7ff4f6f93b02";
const connectionId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93c01";
const traceId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93e01";

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

describe("post-connection Tea Party orchestration", () => {
  it("does not create a mission before the human connection is established", async () => {
    const repository = new InMemoryProductRepository({
      connections: [connection({ status: "pending" })],
    });
    const service = new TeaPartyService(repository, new TestAgentClient());
    expect(await service.onRelationshipEstablished(connectionId, traceId)).toBeNull();
    expect(await repository.getTeaPartyMissionByConnection(connectionId)).toBeNull();
  });

  it("creates one mission for duplicate events and never exceeds eight turns", async () => {
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const service = new TeaPartyService(repository, new TestAgentClient(), { maxTurns: 8 });
    const first = await service.onRelationshipEstablished(connectionId, traceId);
    const duplicate = await service.onRelationshipEstablished(connectionId, traceId);
    const completed = await service.run(connectionId);
    const rerun = await service.run(connectionId);
    const interactions = await repository.listInteractions(first!.id);

    expect(duplicate!.id).toBe(first!.id);
    expect(completed?.status).toBe("ready");
    expect(completed?.currentTurn).toBe(8);
    expect(interactions).toHaveLength(8);
    expect(rerun?.currentTurn).toBe(8);
    expect(new Set(interactions.map((item) => item.turnNo)).size).toBe(8);
    expect(
      interactions.every((item) => item.traceId === traceId && item.modelTraceId === traceId),
    ).toBe(true);
  });

  it("allows only one runner to call Agent for a mission at a time", async () => {
    let releaseFirstTurn!: () => void;
    let markFirstTurnStarted!: () => void;
    const firstTurnStarted = new Promise<void>((resolve) => {
      markFirstTurnStarted = resolve;
    });
    const firstTurnRelease = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });
    class PausingAgentClient extends TestAgentClient {
      calls = 0;
      override async actSocially(request: SocialActRequest): Promise<SocialActResponse> {
        this.calls += 1;
        if (this.calls === 1) {
          markFirstTurnStarted();
          await firstTurnRelease;
        }
        return super.actSocially(request);
      }
    }
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const agentClient = new PausingAgentClient();
    const service = new TeaPartyService(repository, agentClient);
    await service.onRelationshipEstablished(connectionId, traceId);

    const firstRun = service.run(connectionId);
    await firstTurnStarted;
    await expect(service.run(connectionId)).rejects.toMatchObject({
      code: "TEA_PARTY_ALREADY_RUNNING",
    });
    releaseFirstTurn();
    await expect(firstRun).resolves.toMatchObject({ status: "ready" });
    expect(agentClient.calls).toBe(8);
  });

  it("stops an unfinished mission after consent is revoked", async () => {
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const service = new TeaPartyService(repository, new TestAgentClient());
    await service.onRelationshipEstablished(connectionId, traceId);
    await service.stopForConsentRevocation(connectionId, userA);
    const mission = await repository.getTeaPartyMissionByConnection(connectionId);
    expect(mission?.status).toBe("cancelled");
    expect(mission?.stopReason).toBe("consent_revoked");
    expect(await repository.listInteractions(mission!.id)).toHaveLength(0);
  });

  it("stops an unfinished mission after a participant blocks the relationship", async () => {
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const service = new TeaPartyService(repository, new TestAgentClient());
    await service.onRelationshipEstablished(connectionId, traceId);
    await service.stopForBlock(connectionId, userB);
    expect((await repository.getTeaPartyMissionByConnection(connectionId))?.status).toBe("blocked");
  });

  it("rejects a wrong speaker/trace before it can enter the database", async () => {
    class InvalidAgentClient extends TestAgentClient {
      override async actSocially(request: SocialActRequest): Promise<SocialActResponse> {
        return { ...(await super.actSocially(request)), speakerAgentId: agentB, traceId: userA };
      }
    }
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const service = new TeaPartyService(repository, new InvalidAgentClient());
    const mission = await service.onRelationshipEstablished(connectionId, traceId);
    const failed = await service.run(connectionId);
    expect(failed?.status).toBe("failed");
    expect(await repository.listInteractions(mission!.id)).toHaveLength(0);
  });

  it("rejects disclosure above the authorized L2 level before persistence", async () => {
    class PrivateDisclosureClient extends TestAgentClient {
      override async actSocially(request: SocialActRequest): Promise<SocialActResponse> {
        return {
          ...(await super.actSocially(request)),
          disclosure: {
            decision: "ALLOW",
            level: "L4_PRIVATE",
            reasonCode: "too_private",
          },
        };
      }
    }
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const service = new TeaPartyService(repository, new PrivateDisclosureClient());
    const mission = await service.onRelationshipEstablished(connectionId, traceId);
    const failed = await service.run(connectionId);
    expect(failed?.errorCode).toBe("AGENT_INVALID_RESPONSE");
    expect(await repository.listInteractions(mission!.id)).toHaveLength(0);
  });

  it("keeps completed records readable when optional summary generation fails", async () => {
    class SummaryFailureClient extends TestAgentClient {
      override async evaluateSocial(
        _request: SocialEvaluateRequest,
      ): Promise<SocialEvaluateResponse> {
        throw new Error("summary failed");
      }
    }
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const service = new TeaPartyService(repository, new SummaryFailureClient(), { maxTurns: 6 });
    const mission = await service.onRelationshipEstablished(connectionId, traceId);
    const completed = await service.run(connectionId);
    expect(completed?.status).toBe("ready");
    expect(completed?.summary).toBeNull();
    expect(await repository.listInteractions(mission!.id)).toHaveLength(6);
  });

  it("surfaces retryable Agent failures until the bounded retry budget is exhausted", async () => {
    const repository = new InMemoryProductRepository({ connections: [connection()] });
    const service = new TeaPartyService(repository, new TestAgentClient("unavailable"), {
      maxRetries: 2,
    });
    await service.onRelationshipEstablished(connectionId, traceId);

    await expect(service.run(connectionId)).rejects.toMatchObject({ code: "AGENT_UNAVAILABLE" });
    await expect(service.run(connectionId)).rejects.toMatchObject({ code: "AGENT_UNAVAILABLE" });
    const terminal = await service.run(connectionId);

    expect(terminal?.status).toBe("failed");
    expect(terminal?.retryCount).toBe(2);
    expect(terminal?.errorCode).toBe("AGENT_UNAVAILABLE");
  });
});
