import { randomUUID } from "node:crypto";
import { createAgentClient } from "@reso/api/agent-client/factory";
import {
  createPostgresPool,
  PostgresProductRepository,
} from "@reso/api/product/postgres-repository";
import { TeaPartyService } from "@reso/api/product/tea-party-service";
import { RuntimeConfigSchema } from "@reso/config";
import { EventEnvelopeSchema } from "@reso/contracts";
import { handleSocialMission } from "./social_jobs/handler.js";

export const workerQueues = ["social_jobs"] as const;

const config = RuntimeConfigSchema.parse(process.env);
if (config.PRODUCT_REPOSITORY !== "postgres") {
  throw new Error("Worker requires PRODUCT_REPOSITORY=postgres");
}

const pool = createPostgresPool(config.DATABASE_URL);
const repository = new PostgresProductRepository(pool);
const agentClient = createAgentClient(config.AGENT_PROVIDER, config.AGENT_SERVICE_URL, {
  timeoutMs: config.AGENT_TIMEOUT_MS,
  serviceToken: config.AGENT_SERVICE_TOKEN,
  mockFailureMode: config.MOCK_AGENT_FAILURE,
});
const teaPartyService = new TeaPartyService(repository, agentClient);
const workerId = `social-worker:${randomUUID()}`;
const supportedEvents = [
  "relationship.updated",
  "social_mission.created",
  "consent.granted",
  "consent.revoked",
  "relationship.blocked",
];
let stopping = false;
const stop = (): void => {
  stopping = true;
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

console.info("Reso worker started", { workerId, queues: workerQueues });

while (!stopping) {
  const events = await repository.claimOutboxEvents(
    workerId,
    supportedEvents,
    config.WORKER_BATCH_SIZE,
  );
  for (const event of events) {
    const envelope = EventEnvelopeSchema.safeParse({
      id: event.id,
      type: event.eventType,
      version: 1,
      occurredAt: event.occurredAt,
      producer: "reso-api",
      correlationId: event.traceId,
      causationId: null,
      subjectId: event.subjectId,
      payload: event.payload,
    });
    if (!envelope.success) {
      await repository.retryOutboxEvent(
        event.id,
        workerId,
        event.attempts ?? 1,
        "INVALID_EVENT",
        retryAt(event.attempts ?? 1),
      );
      continue;
    }
    try {
      const handled = await handleSocialMission(envelope.data, teaPartyService);
      if (!handled) throw new Error("UNSUPPORTED_EVENT");
      await repository.completeOutboxEvent(event.id, workerId, event.attempts ?? 1);
    } catch (error) {
      const code = error instanceof Error ? error.name : "WORKER_ERROR";
      await repository.retryOutboxEvent(
        event.id,
        workerId,
        event.attempts ?? 1,
        code,
        retryAt(event.attempts ?? 1),
      );
    }
  }
  if (events.length === 0) await delay(config.WORKER_POLL_MS);
}

await pool.end();

function retryAt(attempts: number): string {
  const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMs).toISOString();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
