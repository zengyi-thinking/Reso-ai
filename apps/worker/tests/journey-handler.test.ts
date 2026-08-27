import type { EventEnvelope } from "@reso/contracts";
import { describe, expect, it, vi } from "vitest";
import { handleJourneyCompleted } from "../src/persona_jobs/handler.js";

const journeyId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12";
const traceId = "0198d4f3-6f1e-72b4-8bc9-3af746768b00";

function journeyEvent(): EventEnvelope {
  return {
    id: "0198d4f3-4a10-7851-a56d-bacbd2d90fb0",
    type: "journey.completed",
    version: 1,
    occurredAt: "2026-08-27T08:00:00+08:00",
    producer: "reso-api",
    correlationId: traceId,
    causationId: null,
    subjectId: journeyId,
    payload: {
      journeyId,
      evidenceSnapshotId: "0198d4f3-8a10-7851-a56d-bacbd2d90fb0",
      personalManualSnapshotId: "0198d4f3-9a10-7851-a56d-bacbd2d90fb0",
    },
  };
}

describe("Journey completed Worker", () => {
  it("generates a Personal Manual only from a committed Journey event", async () => {
    const generate = vi.fn(async () => undefined);
    await expect(handleJourneyCompleted(journeyEvent(), { generate })).resolves.toBe(true);
    expect(generate).toHaveBeenCalledWith(journeyId, traceId);
  });

  it("rejects a payload whose Journey does not match the event subject", async () => {
    const event = journeyEvent();
    event.payload = { ...event.payload, journeyId: traceId };
    await expect(handleJourneyCompleted(event, { generate: vi.fn() })).rejects.toMatchObject({
      message: "INVALID_JOURNEY_COMPLETED_EVENT",
      retryable: false,
    });
  });

  it("ignores unrelated event types", async () => {
    const event = journeyEvent();
    event.type = "message.created";
    await expect(handleJourneyCompleted(event, { generate: vi.fn() })).resolves.toBe(false);
  });
});
