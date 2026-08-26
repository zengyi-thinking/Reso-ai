import type { EventEnvelope } from "@reso/contracts";

export interface Delivery {
  event: EventEnvelope;
  attempt: number;
  ack(): Promise<void>;
  retry(reason: string): Promise<void>;
  deadLetter(reason: string): Promise<void>;
}

export interface IdempotencyStore {
  hasAcknowledged(consumerName: string, eventId: string): Promise<boolean>;
  markAcknowledged(consumerName: string, eventId: string): Promise<void>;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

export interface CommittedEventSource {
  /** Returns only events already committed to the Product DB outbox. */
  next(): Promise<Delivery | null>;
}

export class EventProcessor {
  constructor(
    private readonly consumerName: string,
    private readonly store: IdempotencyStore,
    private readonly maxAttempts = 3,
  ) {}

  async process(delivery: Delivery, handler: EventHandler): Promise<"acked" | "retried" | "dead"> {
    if (await this.store.hasAcknowledged(this.consumerName, delivery.event.id)) {
      await delivery.ack();
      return "acked";
    }

    try {
      await handler(delivery.event);
      await this.store.markAcknowledged(this.consumerName, delivery.event.id);
      await delivery.ack();
      return "acked";
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "unknown_worker_failure";
      if (delivery.attempt >= this.maxAttempts) {
        await delivery.deadLetter(reason);
        return "dead";
      }
      await delivery.retry(reason);
      return "retried";
    }
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly acknowledged = new Set<string>();

  hasAcknowledged(consumerName: string, eventId: string): Promise<boolean> {
    return Promise.resolve(this.acknowledged.has(`${consumerName}:${eventId}`));
  }

  markAcknowledged(consumerName: string, eventId: string): Promise<void> {
    this.acknowledged.add(`${consumerName}:${eventId}`);
    return Promise.resolve();
  }
}

export class EventConsumer {
  constructor(
    private readonly source: CommittedEventSource,
    private readonly processor: EventProcessor,
    private readonly handler: EventHandler,
  ) {}

  async runOnce(): Promise<"idle" | "acked" | "retried" | "dead"> {
    const delivery = await this.source.next();
    return delivery ? this.processor.process(delivery, this.handler) : "idle";
  }
}
