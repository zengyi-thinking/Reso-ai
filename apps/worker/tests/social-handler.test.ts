import type { EventEnvelope } from "@reso/contracts";
import { describe, expect, it, vi } from "vitest";
import { handleSocialMission } from "../src/social_jobs/handler.js";

const id = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12";
function event(type: EventEnvelope["type"], payload: Record<string, unknown>): EventEnvelope {
  return {
    id,
    type,
    version: 1,
    occurredAt: "2026-08-26T08:00:00+08:00",
    producer: "api",
    correlationId: id,
    causationId: null,
    subjectId: id,
    payload,
  };
}

describe("social worker event adapter", () => {
  it("routes create, consent revocation, and block events to the bounded runner", async () => {
    const runner = {
      onRelationshipEstablished: vi.fn(async () => undefined),
      run: vi.fn(async () => undefined),
      stopForConsentRevocation: vi.fn(async () => undefined),
      stopForBlock: vi.fn(async () => undefined),
    };
    await handleSocialMission(event("social_mission.created", { connectionId: id }), runner);
    await handleSocialMission(event("connection.established", { connectionId: id }), runner);
    await handleSocialMission(event("consent.granted", { connectionId: id, userId: id }), runner);
    await handleSocialMission(event("consent.revoked", { connectionId: id, userId: id }), runner);
    await handleSocialMission(
      event("connection.blocked", { connectionId: id, blockerUserId: id }),
      runner,
    );
    expect(runner.run).toHaveBeenCalledOnce();
    expect(runner.onRelationshipEstablished).toHaveBeenCalledTimes(2);
    expect(runner.stopForConsentRevocation).toHaveBeenCalledOnce();
    expect(runner.stopForBlock).toHaveBeenCalledOnce();
  });
});
