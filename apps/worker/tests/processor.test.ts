import type { EventEnvelope } from "@reso/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  EventConsumer,
  EventProcessor,
  InMemoryIdempotencyStore,
  type CommittedEventSource,
  type Delivery,
} from "../src/events/processor.js";

const event: EventEnvelope = {
  id: "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12",
  type: "message.created",
  version: 1,
  occurredAt: "2026-08-26T08:00:00+08:00",
  producer: "api",
  correlationId: "0198d4f3-5cf6-7f2e-aef8-dbc910a31147",
  causationId: null,
  subjectId: "0198d4f3-4a10-7851-a56d-bacbd2d90fb0",
  payload: { messageId: "0198d4f3-6f1e-72b4-8bc9-3af746768b00" },
};

function createDelivery(attempt = 1): Delivery {
  return {
    event,
    attempt,
    ack: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    deadLetter: vi.fn(async () => undefined),
  };
}

describe("EventProcessor", () => {
  it("acks a successful event and does not execute it twice", async () => {
    const processor = new EventProcessor("memory", new InMemoryIdempotencyStore());
    const handler = vi.fn(async () => undefined);

    expect(await processor.process(createDelivery(), handler)).toBe("acked");
    expect(await processor.process(createDelivery(), handler)).toBe("acked");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures before the attempt limit", async () => {
    const delivery = createDelivery(1);
    const processor = new EventProcessor("reflection", new InMemoryIdempotencyStore(), 3);

    expect(
      await processor.process(delivery, async () => {
        throw new Error("temporary");
      }),
    ).toBe("retried");
    expect(delivery.retry).toHaveBeenCalledWith("temporary");
    expect(delivery.ack).not.toHaveBeenCalled();
  });

  it("dead-letters failures at the attempt limit", async () => {
    const delivery = createDelivery(3);
    const processor = new EventProcessor("persona", new InMemoryIdempotencyStore(), 3);

    expect(
      await processor.process(delivery, async () => {
        throw new Error("permanent");
      }),
    ).toBe("dead");
    expect(delivery.deadLetter).toHaveBeenCalledWith("permanent");
  });

  it("consumes only deliveries exposed by the committed outbox seam", async () => {
    const delivery = createDelivery();
    const next = vi
      .fn<CommittedEventSource["next"]>()
      .mockResolvedValueOnce(delivery)
      .mockResolvedValue(null);
    const consumer = new EventConsumer(
      { next },
      new EventProcessor("memory", new InMemoryIdempotencyStore()),
      vi.fn(async () => undefined),
    );

    await expect(consumer.runOnce()).resolves.toBe("acked");
    await expect(consumer.runOnce()).resolves.toBe("idle");
  });
});
