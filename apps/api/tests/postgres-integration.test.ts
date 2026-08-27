import { createHash, randomUUID } from "node:crypto";
import { JourneyAttemptSchema } from "@reso/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TestAgentClient } from "./test-agent-client.js";
import { buildApp } from "../src/app.js";
import { PostgresSessionResolver } from "../src/auth/postgres-session-resolver.js";
import {
  createPostgresPool,
  PostgresProductRepository,
} from "../src/product/postgres-repository.js";
import { PostgresWindowRateLimiter } from "../src/product/rate-limiter.js";
import { TeaPartyService } from "../src/product/tea-party-service.js";
import { PostgresJourneyRepository } from "../src/journeys/postgres-journey-repository.js";
import { PersonalManualGenerationService } from "../src/journeys/personal-manual-generation-service.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const userA = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a01";
const userB = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a02";
const userC = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a03";
const agentA = "0198d4f3-2f34-7c52-95cc-7ff4f6f93b01";
const agentB = "0198d4f3-2f34-7c52-95cc-7ff4f6f93b02";
const connectionId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93c01";
const messageId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93d01";
const traceId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93e01";
const sessionToken = "integration-session-token-that-is-long-enough-0001";
const sessionTokenB = "integration-session-token-that-is-long-enough-0002";

const pool = databaseUrl === undefined ? undefined : createPostgresPool(databaseUrl, { max: 4 });
const repository = pool === undefined ? undefined : new PostgresProductRepository(pool);
const journeyRepository = pool === undefined ? undefined : new PostgresJourneyRepository(pool);
let app: FastifyInstance | undefined;

describePostgres("PostgreSQL Product Backend integration", () => {
  beforeEach(async () => {
    await app?.close();
    app = undefined;
    await pool!.query(
      `TRUNCATE product_audit_log, dead_letter_events, event_consumptions, event_outbox,
         agent_interactions, social_missions,
         agent_assist_requests, connection_messages, user_sessions, user_blocks,
         connections, agents, users RESTART IDENTITY CASCADE`,
    );
    await pool!.query(
      `INSERT INTO users (id,email,display_name) VALUES
        ($1,'a@example.test','A'),($2,'b@example.test','B'),($3,'c@example.test','C')`,
      [userA, userB, userC],
    );
    await pool!.query(
      `INSERT INTO agents (id,user_id,name) VALUES ($1,$2,'A Agent'),($3,$4,'B Agent')`,
      [agentA, userA, agentB, userB],
    );
    await pool!.query(
      `INSERT INTO connections (
         id,user_a_id,user_b_id,agent_a_id,agent_b_id,status,
         user_a_proxy_consent,user_b_proxy_consent,established_at
       ) VALUES ($1,$2,$3,$4,$5,'established',true,true,now())`,
      [connectionId, userA, userB, agentA, agentB],
    );
    await pool!.query(
      `INSERT INTO connection_messages
         (id,connection_id,sender_user_id,content,client_message_id,trace_id)
       VALUES ($1,$2,$3,'周末有空吗？','seed-message',$4)`,
      [messageId, connectionId, userB, traceId],
    );
    await pool!.query(
      `INSERT INTO user_sessions (user_id,token_hash,expires_at)
       VALUES ($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')`,
      [
        userA,
        createHash("sha256").update(sessionToken).digest("hex"),
        userB,
        createHash("sha256").update(sessionTokenB).digest("hex"),
      ],
    );
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("persists one bounded tea party and survives service reconstruction", async () => {
    const service = new TeaPartyService(repository!, new TestAgentClient(), { maxTurns: 8 });
    const first = await service.onRelationshipEstablished(connectionId, traceId);
    const duplicate = await service.onRelationshipEstablished(connectionId, traceId);
    const completed = await service.run(connectionId);
    const reconstructed = new PostgresProductRepository(pool!);
    const persisted = await reconstructed.getTeaPartyMissionByConnection(connectionId);
    const interactions = await reconstructed.listInteractions(first!.id);

    expect(duplicate?.id).toBe(first?.id);
    expect(completed?.status).toBe("ready");
    expect(persisted?.currentTurn).toBe(8);
    expect(interactions.map((item) => item.turnNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("persists the Journey → Manual → Persona V1 claim through Product API transactions", async () => {
    if (pool === undefined || repository === undefined || journeyRepository === undefined) {
      throw new Error("PostgreSQL integration test requires TEST_DATABASE_URL");
    }
    app = await buildApp({
      agentClient: new TestAgentClient(),
      repository,
      journeyRepository,
      sessionUserResolver: new PostgresSessionResolver(repository).resolve,
    });
    const headers = { authorization: `Bearer ${sessionToken}`, "x-trace-id": traceId };
    const created = await app.inject({
      method: "POST",
      url: "/api/journeys",
      headers,
      payload: { journeyVersion: "mountain-v1", clientAttemptId: randomUUID() },
    });
    expect(created.statusCode).toBe(201);
    const journeyId = created.json().attempt.id;
    const answers = [
      ["invitation", "planned"],
      ["fatigue", "empathize"],
      ["slip", "support"],
      ["storm-thought", "protect"],
      ["cave-repair", "hug"],
      ["home-message", "secure"],
      ["city-realization", "build"],
    ];
    const concurrentAnswers = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/journeys/${journeyId}/answers`,
        headers,
        payload: {
          stageId: "invitation",
          questionId: "invitation",
          choiceId: "planned",
          elapsedMs: 100,
          clientAnswerId: randomUUID(),
        },
      }),
      app.inject({
        method: "POST",
        url: `/api/journeys/${journeyId}/answers`,
        headers,
        payload: {
          stageId: "invitation",
          questionId: "invitation",
          choiceId: "escape",
          elapsedMs: 200,
          clientAnswerId: randomUUID(),
        },
      }),
    ]);
    expect(concurrentAnswers.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409]);

    for (const [questionId, choiceId] of answers.slice(1)) {
      const saved = await app.inject({
        method: "POST",
        url: `/api/journeys/${journeyId}/answers`,
        headers,
        payload: {
          stageId: questionId,
          questionId,
          choiceId,
          elapsedMs: 100,
          clientAnswerId: randomUUID(),
        },
      });
      expect(saved.statusCode).toBe(201);
    }
    const completed = await app.inject({
      method: "POST",
      url: `/api/journeys/${journeyId}/complete`,
      headers,
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().personalManual.status).toBe("generating");
    const eventCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM event_outbox WHERE event_type='journey.completed' AND aggregate_id=$1",
      [journeyId],
    );
    expect(eventCount.rows[0]?.count).toBe("1");

    await pool.query(
      `UPDATE personal_manual_snapshots SET
         status='failed',retryable=true,error_code='AGENT_TIMEOUT'
       WHERE journey_id=$1`,
      [journeyId],
    );
    const retryId = randomUUID();
    const queuedRetry = await app.inject({
      method: "POST",
      url: `/api/journeys/${journeyId}/personal-manual/retry`,
      headers,
      payload: { clientRetryId: retryId },
    });
    expect(queuedRetry.json().status).toBe("generating");
    await pool.query(
      `UPDATE personal_manual_snapshots SET
         status='failed',retryable=true,error_code='AGENT_TIMEOUT'
       WHERE journey_id=$1`,
      [journeyId],
    );
    const staleRetry = await app.inject({
      method: "POST",
      url: `/api/journeys/${journeyId}/personal-manual/retry`,
      headers,
      payload: { clientRetryId: retryId },
    });
    expect(staleRetry.json().status).toBe("failed");
    const freshRetry = await app.inject({
      method: "POST",
      url: `/api/journeys/${journeyId}/personal-manual/retry`,
      headers,
      payload: { clientRetryId: randomUUID() },
    });
    expect(freshRetry.json().status).toBe("generating");
    const retryEvents = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM event_outbox WHERE idempotency_key LIKE $1",
      [`personal-manual.retry:${journeyId}:%`],
    );
    expect(retryEvents.rows[0]?.count).toBe("2");

    await new PersonalManualGenerationService(journeyRepository, new TestAgentClient()).generate(
      journeyId,
      traceId,
    );
    const reconstructed = new PostgresJourneyRepository(pool);
    expect((await reconstructed.getPersonalManual(journeyId))?.status).toBe("ready");
    expect((await reconstructed.getJourneyAttempt(journeyId))?.status).toBe("completed");
    expect(await reconstructed.listJourneyAnswers(journeyId)).toHaveLength(7);
    const visible = await app.inject({
      method: "GET",
      url: `/api/journeys/${journeyId}/personal-manual`,
      headers,
    });
    expect(visible.statusCode).toBe(200);
    expect(visible.json().currentContent.variables).toHaveLength(9);

    const [claimed, repeated] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/journeys/${journeyId}/claim-agent`,
        headers,
        payload: { clientClaimId: randomUUID() },
      }),
      app.inject({
        method: "POST",
        url: `/api/journeys/${journeyId}/claim-agent`,
        headers,
        payload: { clientClaimId: randomUUID() },
      }),
    ]);
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect(claimed.json().personaVersion.version).toBe(1);
    expect(claimed.json().personaVersion.confirmedByUser).toBe(true);
    expect(repeated.json().personaVersion.id).toBe(claimed.json().personaVersion.id);
    expect(repeated.json().agent.id).toBe(claimed.json().agent.id);
    const personaEvents = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM event_outbox WHERE event_type='persona.created' AND aggregate_id=$1",
      [claimed.json().personaVersion.id],
    );
    expect(personaEvents.rows[0]?.count).toBe("1");
  });

  it("serializes tea-party runners across PostgreSQL repository instances", async () => {
    const otherRepository = new PostgresProductRepository(pool!);
    const releaseFirst = await repository!.acquireTeaPartyRunLock(connectionId);
    expect(releaseFirst).not.toBeNull();
    expect(await otherRepository.acquireTeaPartyRunLock(connectionId)).toBeNull();
    await releaseFirst!();
    const releaseSecond = await otherRepository.acquireTeaPartyRunLock(connectionId);
    expect(releaseSecond).not.toBeNull();
    await releaseSecond!();
  });

  it("claims an anonymous Journey only with its hashed bearer credential", async () => {
    app = await buildApp({
      agentClient: new TestAgentClient(),
      repository: repository!,
      journeyRepository: journeyRepository!,
      sessionUserResolver: new PostgresSessionResolver(repository!).resolve,
    });
    const anonymousToken = "anonymous-journey-token-with-at-least-43-characters-0001";
    const created = await app.inject({
      method: "POST",
      url: "/api/journeys",
      payload: {
        journeyVersion: "mountain-v1",
        clientAttemptId: randomUUID(),
        anonymousAccessToken: anonymousToken,
      },
    });
    const journeyId = created.json().attempt.id;
    const denied = await app.inject({
      method: "POST",
      url: `/api/journeys/${journeyId}/claim-ownership`,
      headers: {
        authorization: `Bearer ${sessionTokenB}`,
        "x-journey-token": "wrong-anonymous-token-with-at-least-43-characters-01",
      },
      payload: { clientClaimId: randomUUID() },
    });
    const claimed = await app.inject({
      method: "POST",
      url: `/api/journeys/${journeyId}/claim-ownership`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "x-journey-token": anonymousToken,
      },
      payload: { clientClaimId: randomUUID() },
    });
    const stored = await pool!.query<{
      user_id: string | null;
      anonymous_token_hash: string | null;
    }>("SELECT user_id,anonymous_token_hash FROM journeys WHERE id=$1", [journeyId]);
    expect(denied.statusCode).toBe(403);
    expect(claimed.statusCode).toBe(200);
    expect(stored.rows[0]).toEqual({ user_id: userA, anonymous_token_hash: null });
    expect(JSON.stringify(stored.rows[0])).not.toContain(anonymousToken);
  });

  it("allows only one official Journey when concurrent clients omit replay metadata", async () => {
    app = await buildApp({
      agentClient: new TestAgentClient(),
      repository: repository!,
      journeyRepository: journeyRepository!,
      sessionUserResolver: new PostgresSessionResolver(repository!).resolve,
    });
    const attempts = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/journeys",
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: { journeyVersion: "mountain-v1", clientAttemptId: randomUUID() },
      }),
      app.inject({
        method: "POST",
        url: "/api/journeys",
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: { journeyVersion: "mountain-v1", clientAttemptId: randomUUID() },
      }),
    ]);
    expect(attempts.map(({ statusCode }) => statusCode)).toEqual([201, 201]);
    const records = attempts.map((response) => JourneyAttemptSchema.parse(response.json().attempt));
    expect(records.map(({ official }) => official).sort()).toEqual([false, true]);
    const official = records.find((record) => record.official === true);
    const replay = records.find((record) => record.official === false);
    if (official === undefined || replay === undefined) {
      throw new Error("Expected one official Journey and one replay");
    }
    expect(replay.replayOfJourneyId).toBe(official.id);
    const officialCount = await pool!.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM journeys WHERE user_id=$1 AND version='mountain-v1' AND official=true",
      [userA],
    );
    expect(officialCount.rows[0]?.count).toBe("1");
  });

  it("rolls back Journey completion, Evidence, Manual, and Outbox together", async () => {
    app = await buildApp({
      agentClient: new TestAgentClient(),
      repository: repository!,
      journeyRepository: journeyRepository!,
      sessionUserResolver: new PostgresSessionResolver(repository!).resolve,
    });
    const headers = { authorization: `Bearer ${sessionToken}`, "x-trace-id": traceId };
    const created = await app.inject({
      method: "POST",
      url: "/api/journeys",
      headers,
      payload: { journeyVersion: "mountain-v1", clientAttemptId: randomUUID() },
    });
    const journeyId = created.json().attempt.id;
    const choices = [
      ["invitation", "planned"],
      ["fatigue", "empathize"],
      ["slip", "support"],
      ["storm-thought", "protect"],
      ["cave-repair", "hug"],
      ["home-message", "secure"],
      ["city-realization", "build"],
    ] satisfies ReadonlyArray<readonly [string, string]>;
    for (const [questionId, choiceId] of choices) {
      const response = await app.inject({
        method: "POST",
        url: `/api/journeys/${journeyId}/answers`,
        headers,
        payload: {
          stageId: questionId,
          questionId,
          choiceId,
          clientAnswerId: randomUUID(),
        },
      });
      expect(response.statusCode).toBe(201);
    }
    const answers = await journeyRepository!.listJourneyAnswers(journeyId);
    const completedAt = new Date().toISOString();
    const evidenceSnapshotId = randomUUID();
    const manualSnapshotId = randomUUID();
    await expect(
      journeyRepository!.completeJourney({
        journeyId,
        expectedQuestionIds: choices.map(([questionId]) => questionId),
        evidenceSnapshot: {
          id: evidenceSnapshotId,
          journeyId,
          journeyVersion: "mountain-v1",
          evidenceVersion: 1,
          official: true,
          evidenceSignature: "b".repeat(64),
          items: answers.map(({ evidence }) => evidence),
          createdAt: completedAt,
        },
        manualSnapshot: {
          id: manualSnapshotId,
          journeyId,
          status: "generating",
          evidenceSignature: "b".repeat(64),
          originalContent: null,
          currentContent: null,
          revision: 1,
          currentSource: "agent_generated",
          retryable: false,
          errorCode: null,
          agentTraceId: null,
          agentVersionId: null,
          modelVersion: null,
          personaVersionId: null,
          agentId: null,
          createdAt: completedAt,
          updatedAt: completedAt,
          generatedAt: null,
          claimedAt: null,
        },
        event: {
          id: randomUUID(),
          eventType: "journey.completed",
          subjectId: journeyId,
          traceId,
          idempotencyKey: `journey.completed:${journeyId}`,
          payload: { journeyId, evidenceSnapshotId, personalManualSnapshotId: manualSnapshotId },
          occurredAt: completedAt,
        },
        audit: {
          id: randomUUID(),
          actorUserId: randomUUID(),
          action: "journey.complete",
          subjectId: journeyId,
          traceId,
          outcome: "completed",
          metadata: {},
          createdAt: completedAt,
        },
      }),
    ).rejects.toMatchObject({ code: "23503" });
    expect((await journeyRepository!.getJourneyAttempt(journeyId))?.status).toBe("started");
    expect(await journeyRepository!.getJourneyEvidenceSnapshot(journeyId)).toBeNull();
    expect(await journeyRepository!.getPersonalManual(journeyId)).toBeNull();
    const outbox = await pool!.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM event_outbox WHERE aggregate_id=$1",
      [journeyId],
    );
    expect(outbox.rows[0]?.count).toBe("0");
  });

  it("uses a hashed production session and keeps Assist private", async () => {
    app = await buildApp({
      agentClient: new TestAgentClient(),
      repository: repository!,
      rateLimiter: new PostgresWindowRateLimiter(pool!, 10, 60_000),
      sessionUserResolver: new PostgresSessionResolver(repository!).resolve,
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/connections/${connectionId}/assist/analyze`,
      headers: { authorization: `Bearer ${sessionToken}`, "x-trace-id": traceId },
      payload: { messageId, clientRequestId: "postgres-assist-1" },
    });
    const assist = response.json();
    const unauthorized = await app.inject({
      method: "GET",
      url: `/api/assist/${assist.requestId}`,
      headers: { authorization: "Bearer invalid-session-token-that-is-long-enough" },
    });
    const auditCount = await pool!.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM product_audit_log WHERE trace_id=$1",
      [traceId],
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-trace-id"]).toBe(traceId);
    expect(assist.traceId).toBe(traceId);
    expect(unauthorized.statusCode).toBe(401);
    expect(Number(auditCount.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("keeps the same trace on Agent failure while human chat still commits", async () => {
    app = await buildApp({
      agentClient: new TestAgentClient("unavailable"),
      repository: repository!,
      rateLimiter: new PostgresWindowRateLimiter(pool!, 10, 60_000),
      sessionUserResolver: new PostgresSessionResolver(repository!).resolve,
    });
    const assist = await app.inject({
      method: "POST",
      url: `/api/connections/${connectionId}/assist/polish`,
      headers: { authorization: `Bearer ${sessionToken}`, "x-trace-id": traceId },
      payload: { draft: "你好", clientRequestId: "postgres-offline-assist" },
    });
    const human = await app.inject({
      method: "POST",
      url: `/api/connections/${connectionId}/messages`,
      headers: { authorization: `Bearer ${sessionToken}`, "x-trace-id": traceId },
      payload: { content: "真人消息继续", clientMessageId: "postgres-human-1" },
    });

    expect(assist.statusCode).toBe(503);
    expect(assist.headers["x-trace-id"]).toBe(traceId);
    expect(assist.json().traceId).toBe(traceId);
    expect(human.statusCode).toBe(201);
    expect(await repository!.countHumanMessages(connectionId)).toBe(2);
  });

  it("rolls back an Assist terminal state when its event/audit transaction fails", async () => {
    const requestId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93f04";
    const running = await repository!.saveAssistRequest({
      id: requestId,
      connectionId,
      requesterUserId: userA,
      requestType: "analyze",
      sourceMessageId: messageId,
      clientRequestId: "transaction-rollback",
      status: "running",
      result: null,
      traceId,
      errorCode: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });

    await expect(
      repository!.saveAssistRequestWithEventAndAudit(
        {
          ...running,
          status: "completed",
          result: { interpretation: "result", replyRoutes: [] },
          completedAt: new Date().toISOString(),
        },
        {
          id: "0198d4f3-2f34-7c52-95cc-7ff4f6f93f05",
          eventType: "agent_assist.completed",
          subjectId: requestId,
          traceId,
          idempotencyKey: "transaction-rollback-event",
          payload: { connectionId, requesterUserId: userA },
          occurredAt: new Date().toISOString(),
        },
        {
          id: "0198d4f3-2f34-7c52-95cc-7ff4f6f93f06",
          actorUserId: "0198d4f3-2f34-7c52-95cc-7ff4f6f93a99",
          action: "agent_assist.analyze",
          subjectId: requestId,
          traceId,
          outcome: "completed",
          metadata: {},
          createdAt: new Date().toISOString(),
        },
      ),
    ).rejects.toMatchObject({ code: "23503" });

    expect(await repository!.getAssistRequest(requestId)).toMatchObject({ status: "running" });
    const eventCount = await pool!.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM event_outbox WHERE idempotency_key=$1",
      ["transaction-rollback-event"],
    );
    expect(eventCount.rows[0]?.count).toBe("0");
  });

  it("claims each durable outbox event once across competing workers", async () => {
    const service = new TeaPartyService(repository!, new TestAgentClient());
    await service.onRelationshipEstablished(connectionId, traceId);
    const [left, right] = await Promise.all([
      repository!.claimOutboxEvents("social-worker:left", ["social_mission.created"], 10),
      repository!.claimOutboxEvents("social-worker:right", ["social_mission.created"], 10),
    ]);
    const claimed = [...left, ...right];
    expect(claimed).toHaveLength(1);
    expect(new Set(claimed.map((event) => event.id)).size).toBe(1);
    await repository!.completeOutboxEvent(
      claimed[0]!.id,
      "social-worker:left",
      claimed[0]!.attempts ?? 1,
    );
    expect(
      await repository!.claimOutboxEvents("social-worker:third", ["social_mission.created"], 10),
    ).toEqual([]);
  });

  it("does not let a stale worker acknowledge a newer outbox attempt", async () => {
    await repository!.saveOutboxEvent({
      id: "0198d4f3-2f34-7c52-95cc-7ff4f6f93f03",
      eventType: "connection.blocked",
      subjectId: connectionId,
      traceId,
      idempotencyKey: "stale-worker-fencing",
      payload: { connectionId, blockerUserId: userA },
      occurredAt: new Date().toISOString(),
    });
    const first = await repository!.claimOutboxEvents(
      "social-fencing-worker:first",
      ["connection.blocked"],
      1,
    );
    await pool!.query(
      `UPDATE event_consumptions SET updated_at=now()-interval '6 minutes'
        WHERE consumer_name='social-fencing-worker' AND event_id=$1`,
      [first[0]!.id],
    );
    const second = await repository!.claimOutboxEvents(
      "social-fencing-worker:second",
      ["connection.blocked"],
      1,
    );

    await repository!.completeOutboxEvent(first[0]!.id, "social-fencing-worker:first", 1);
    const stillProcessing = await pool!.query<{ status: string; attempt_count: number }>(
      `SELECT status,attempt_count FROM event_consumptions
        WHERE consumer_name='social-fencing-worker' AND event_id=$1`,
      [first[0]!.id],
    );
    expect(second[0]?.attempts).toBe(2);
    expect(stillProcessing.rows[0]).toMatchObject({ status: "processing", attempt_count: 2 });

    await repository!.completeOutboxEvent(second[0]!.id, "social-fencing-worker:second", 2);
  });

  it("releases retryable jobs and dead-letters them after five attempts", async () => {
    await repository!.saveOutboxEvent({
      id: "0198d4f3-2f34-7c52-95cc-7ff4f6f93f02",
      eventType: "connection.blocked",
      subjectId: connectionId,
      traceId,
      idempotencyKey: "retry-e2e",
      payload: { connectionId, blockerUserId: userA },
      occurredAt: new Date().toISOString(),
    });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claimed = await repository!.claimOutboxEvents(
        `social-retry-worker:${attempt}`,
        ["connection.blocked"],
        1,
      );
      expect(claimed).toHaveLength(1);
      await repository!.retryOutboxEvent(
        claimed[0]!.id,
        `social-retry-worker:${attempt}`,
        claimed[0]!.attempts ?? 1,
        "AGENT_UNAVAILABLE",
        new Date(Date.now() - 1_000).toISOString(),
      );
    }
    expect(
      await repository!.claimOutboxEvents("social-retry-worker:final", ["connection.blocked"], 1),
    ).toEqual([]);
    const state = await pool!.query<{ attempt_count: number; dead_lettered: boolean }>(
      `SELECT c.attempt_count,EXISTS(
         SELECT 1 FROM dead_letter_events d
          WHERE d.consumer_name=c.consumer_name AND d.event_id=c.event_id
       ) AS dead_lettered
         FROM event_consumptions c
        WHERE c.consumer_name='social-retry-worker' AND c.event_id=$1`,
      ["0198d4f3-2f34-7c52-95cc-7ff4f6f93f02"],
    );
    expect(state.rows[0]?.attempt_count).toBe(5);
    expect(state.rows[0]?.dead_lettered).toBe(true);
  });

  it("immediately dead-letters a non-retryable Agent schema failure", async () => {
    const eventId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93f09";
    await repository!.saveOutboxEvent({
      id: eventId,
      eventType: "journey.completed",
      subjectId: connectionId,
      traceId,
      idempotencyKey: "invalid-personal-manual-candidate",
      payload: {
        journeyId: connectionId,
        evidenceSnapshotId: messageId,
        personalManualSnapshotId: traceId,
      },
      occurredAt: new Date().toISOString(),
    });
    const claimed = await repository!.claimOutboxEvents(
      "persona-worker:first",
      ["journey.completed"],
      1,
    );
    await repository!.deadLetterOutboxEvent(
      claimed[0]!.id,
      "persona-worker:first",
      claimed[0]!.attempts ?? 1,
      "AGENT_INVALID_RESPONSE",
    );
    expect(
      await repository!.claimOutboxEvents("persona-worker:second", ["journey.completed"], 1),
    ).toEqual([]);
    const deadLetter = await pool!.query<{ failure_code: string; attempt_count: number }>(
      `SELECT failure_code,attempt_count FROM dead_letter_events
        WHERE consumer_name='persona-worker' AND event_id=$1`,
      [eventId],
    );
    expect(deadLetter.rows[0]).toEqual({
      failure_code: "AGENT_INVALID_RESPONSE",
      attempt_count: 5,
    });
  });
});
