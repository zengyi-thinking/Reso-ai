import { describe, expect, it } from "vitest";
import { InMemoryProductRepository } from "../src/product/in-memory-repository.js";
import { assertAssistTransition, assertTeaPartyTransition } from "../src/product/state-machine.js";

const id = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12";
const secondId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a13";

function mission() {
  return {
    id,
    connectionId: secondId,
    missionType: "post_connection_tea_party" as const,
    initiatorAgentId: id,
    targetAgentId: secondId,
    status: "queued" as const,
    maxTurns: 8,
    currentTurn: 0,
    maxModelCalls: 9,
    modelCallsUsed: 0,
    stopReason: null,
    traceId: id,
    retryCount: 0,
    summary: null,
    createdAt: "2026-08-26T08:00:00+08:00",
    startedAt: null,
    completedAt: null,
  };
}

describe("Product repository and state machines", () => {
  it("returns one tea-party mission for duplicate create attempts", async () => {
    const repository = new InMemoryProductRepository();
    const first = await repository.createTeaPartyMission(mission());
    const duplicate = await repository.createTeaPartyMission({ ...mission(), id: secondId });
    expect(duplicate.id).toBe(first.id);
  });

  it("stores one interaction per mission and turn", async () => {
    const repository = new InMemoryProductRepository();
    const interaction = {
      id,
      missionId: id,
      turnNo: 1,
      speakerAgentId: id,
      content: "first",
      visibility: "participants" as const,
      modelTraceId: id,
      traceId: id,
      createdAt: "2026-08-26T08:00:00+08:00",
    };
    await repository.saveInteraction(interaction);
    await repository.saveInteraction({ ...interaction, id: secondId, content: "duplicate" });
    expect(await repository.listInteractions(id)).toEqual([interaction]);
  });

  it("rejects illegal terminal-state transitions", () => {
    expect(() => assertAssistTransition("completed", "running")).toThrow();
    expect(() => assertTeaPartyTransition("ready", "running")).toThrow();
    expect(() => assertTeaPartyTransition("queued", "running")).not.toThrow();
  });
});
