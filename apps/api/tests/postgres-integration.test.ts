import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockAgentClient } from "../src/agent-client/mock-agent-client.js";
import { buildApp } from "../src/app.js";
import { PostgresSessionResolver } from "../src/auth/postgres-session-resolver.js";
import {
  createPostgresPool,
  PostgresProductRepository,
} from "../src/product/postgres-repository.js";
import { PostgresWindowRateLimiter } from "../src/product/rate-limiter.js";
import { TeaPartyService } from "../src/product/tea-party-service.js";

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

const pool = databaseUrl === undefined ? undefined : createPostgresPool(databaseUrl, { max: 4 });
const repository = pool === undefined ? undefined : new PostgresProductRepository(pool);
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
       VALUES ($1,$2,now()+interval '1 hour')`,
      [userA, createHash("sha256").update(sessionToken).digest("hex")],
    );
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("persists one bounded tea party and survives service reconstruction", async () => {
    const service = new TeaPartyService(repository!, new MockAgentClient(), { maxTurns: 8 });
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

  it("uses a hashed production session and keeps Assist private", async () => {
    app = await buildApp({
      agentClient: new MockAgentClient(),
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
      agentClient: new MockAgentClient("unavailable"),
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
    const service = new TeaPartyService(repository!, new MockAgentClient());
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
      eventType: "relationship.blocked",
      subjectId: connectionId,
      traceId,
      idempotencyKey: "stale-worker-fencing",
      payload: { connectionId, blockerUserId: userA },
      occurredAt: new Date().toISOString(),
    });
    const first = await repository!.claimOutboxEvents(
      "social-fencing-worker:first",
      ["relationship.blocked"],
      1,
    );
    await pool!.query(
      `UPDATE event_consumptions SET updated_at=now()-interval '6 minutes'
        WHERE consumer_name='social-fencing-worker' AND event_id=$1`,
      [first[0]!.id],
    );
    const second = await repository!.claimOutboxEvents(
      "social-fencing-worker:second",
      ["relationship.blocked"],
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
      eventType: "relationship.blocked",
      subjectId: connectionId,
      traceId,
      idempotencyKey: "retry-e2e",
      payload: { connectionId, blockerUserId: userA },
      occurredAt: new Date().toISOString(),
    });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claimed = await repository!.claimOutboxEvents(
        `social-retry-worker:${attempt}`,
        ["relationship.blocked"],
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
      await repository!.claimOutboxEvents("social-retry-worker:final", ["relationship.blocked"], 1),
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
});
