import { randomUUID } from "node:crypto";
import {
  EventEnvelopeSchema,
  JourneyEvidenceItemSchema,
  type JourneyEvidenceItem,
} from "@reso/contracts";
import { createAgentClient } from "@reso/api/agent-client/factory";
import { PostgresJourneyRepository } from "@reso/api/journeys/postgres-journey-repository";
import { PersonalManualGenerationService } from "@reso/api/journeys/personal-manual-generation-service";
import {
  createPostgresPool,
  PostgresProductRepository,
} from "@reso/api/product/postgres-repository";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleJourneyCompleted } from "../src/persona_jobs/handler.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const pool = databaseUrl === undefined ? undefined : createPostgresPool(databaseUrl, { max: 4 });
const journeyId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12";
const userId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a13";
const evidenceId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a14";
const manualId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a15";
const eventId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a16";
const traceId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a17";

describePostgres("Journey persona_jobs PostgreSQL integration", () => {
  beforeEach(async () => {
    await pool!.query(
      `TRUNCATE product_audit_log,dead_letter_events,event_consumptions,event_outbox,
         personal_manual_edits,persona_versions,personal_manual_snapshots,
         journey_evidence_snapshots,journey_answers,journeys,persona_profiles,agents,users
       RESTART IDENTITY CASCADE`,
    );
    const evidence = createEvidence();
    await pool!.query("INSERT INTO users (id,email) VALUES ($1,'worker@example.test')", [userId]);
    await pool!.query(
      `INSERT INTO journeys (
         id,user_id,version,status,client_attempt_id,official,started_at,completed_at
       ) VALUES ($1,$2,'mountain-v1','completed',$3,true,now(),now())`,
      [journeyId, userId, randomUUID()],
    );
    await pool!.query(
      `INSERT INTO journey_evidence_snapshots (
         id,journey_id,journey_version,evidence_version,official,
         evidence_signature,items_json
       ) VALUES ($1,$2,'mountain-v1',1,true,$3,$4)`,
      [evidenceId, journeyId, "a".repeat(64), JSON.stringify(evidence)],
    );
    await pool!.query(
      `INSERT INTO personal_manual_snapshots (
         id,journey_id,evidence_snapshot_id,status,evidence_signature
       ) VALUES ($1,$2,$3,'generating',$4)`,
      [manualId, journeyId, evidenceId, "a".repeat(64)],
    );
    await pool!.query(
      `INSERT INTO event_outbox (
         id,event_type,event_version,aggregate_type,aggregate_id,correlation_id,
         idempotency_key,payload
       ) VALUES ($1,'journey.completed',1,'journey',$2,$3,$4,$5)`,
      [
        eventId,
        journeyId,
        traceId,
        `journey.completed:${journeyId}`,
        JSON.stringify({
          journeyId,
          evidenceSnapshotId: evidenceId,
          personalManualSnapshotId: manualId,
        }),
      ],
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("claims the committed event, calls IAgentClient, saves ready, and acknowledges once", async () => {
    const productRepository = new PostgresProductRepository(pool!);
    const journeyRepository = new PostgresJourneyRepository(pool!);
    const generator = new PersonalManualGenerationService(
      journeyRepository,
      createAgentClient("mock", "http://unused.test"),
    );
    const claimed = await productRepository.claimOutboxEvents(
      "persona-worker:test",
      ["journey.completed"],
      1,
    );
    expect(claimed).toHaveLength(1);
    const event = EventEnvelopeSchema.parse({
      id: claimed[0]!.id,
      type: claimed[0]!.eventType,
      version: 1,
      occurredAt: claimed[0]!.occurredAt,
      producer: "reso-api",
      correlationId: claimed[0]!.traceId,
      causationId: null,
      subjectId: claimed[0]!.subjectId,
      payload: claimed[0]!.payload,
    });
    await expect(handleJourneyCompleted(event, generator)).resolves.toBe(true);
    await productRepository.completeOutboxEvent(
      claimed[0]!.id,
      "persona-worker:test",
      claimed[0]!.attempts ?? 1,
    );

    const ready = await journeyRepository.getPersonalManual(journeyId);
    expect(ready?.status).toBe("ready");
    expect(ready?.currentContent?.variables).toHaveLength(9);
    expect(
      await productRepository.claimOutboxEvents(
        "persona-worker:other-instance",
        ["journey.completed"],
        1,
      ),
    ).toEqual([]);
  });
});

function createEvidence(): JourneyEvidenceItem[] {
  return Array.from({ length: 7 }, (_value, index) =>
    JourneyEvidenceItemSchema.parse({
      evidenceRef: `mountain-v1/question-${index}/choice-${index}@${randomUUID()}`,
      journeyVersion: "mountain-v1",
      stageId: `question-${index}`,
      questionId: `question-${index}`,
      choiceId: `choice-${index}`,
      optionText: "测试选项",
      responseText: null,
      target: "self",
      summary: "服务端生成的中性 Evidence",
      signals: [{ dimension: "support", value: "observed", weight: 1 }],
      contextTags: ["test"],
      pressure: "medium",
      companionMood: null,
      elapsedMs: 100,
      answeredAt: "2026-08-27T08:00:00+08:00",
    }),
  );
}
