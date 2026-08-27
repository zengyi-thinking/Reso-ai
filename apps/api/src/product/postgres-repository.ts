import { Client, Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import type {
  AgentInteractionRecord,
  AssistRequestRecord,
  AuditLogRecord,
  ConnectionRecord,
  HumanMessageRecord,
  OutboxEventRecord,
  TeaPartyMissionRecord,
} from "./entities.js";
import type { ConnectionMutation, ProductRepository } from "./repository.js";

interface ConnectionRow extends QueryResultRow {
  id: string;
  user_a_id: string;
  user_b_id: string;
  agent_a_id: string;
  agent_b_id: string;
  status: ConnectionRecord["status"];
  user_a_proxy_consent: boolean;
  user_b_proxy_consent: boolean;
  blocked_by_user_id: string | null;
  established_at: Date | string | null;
}

interface MessageRow extends QueryResultRow {
  id: string;
  connection_id: string;
  sender_user_id: string;
  content: string;
  client_message_id: string;
  trace_id: string;
  created_at: Date | string;
}

interface AssistRow extends QueryResultRow {
  id: string;
  connection_id: string;
  requester_user_id: string;
  request_type: AssistRequestRecord["requestType"];
  source_message_id: string | null;
  client_request_id: string;
  status: AssistRequestRecord["status"];
  result_json: unknown | null;
  trace_id: string;
  error_code: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
}

interface MissionRow extends QueryResultRow {
  id: string;
  connection_id: string;
  initiator_agent_id: string;
  target_agent_id: string;
  status: TeaPartyMissionRecord["status"];
  max_turns: number;
  current_turn: number;
  budget: { maxModelCalls?: number };
  result: { modelCallsUsed?: number } | null;
  stop_reason: TeaPartyMissionRecord["stopReason"];
  error_code: string | null;
  trace_id: string;
  retry_count: number;
  summary_json: unknown | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface InteractionRow extends QueryResultRow {
  id: string;
  mission_id: string;
  turn_number: number;
  actor_agent_id: string;
  content: string;
  visibility: AgentInteractionRecord["visibility"];
  model_trace_id: string;
  trace_id: string;
  created_at: Date | string;
}

interface OutboxRow extends QueryResultRow {
  id: string;
  event_type: string;
  aggregate_id: string;
  correlation_id: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  occurred_at: Date | string;
  attempts: number | null;
}

export function createPostgresPool(connectionString: string, overrides: PoolConfig = {}): Pool {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, ...overrides });
}

export class PostgresProductRepository implements ProductRepository {
  constructor(public readonly pool: Pool) {}

  async getConnection(id: string): Promise<ConnectionRecord | null> {
    return this.getConnectionFrom(this.pool, id, false);
  }

  private async getConnectionFrom(
    database: Pool | PoolClient,
    id: string,
    forUpdate: boolean,
  ): Promise<ConnectionRecord | null> {
    const result = await database.query<ConnectionRow>(
      `SELECT c.*, b.blocker_user_id AS blocked_by_user_id
         FROM connections c
         LEFT JOIN user_blocks b
           ON (b.blocker_user_id = c.user_a_id AND b.blocked_user_id = c.user_b_id)
            OR (b.blocker_user_id = c.user_b_id AND b.blocked_user_id = c.user_a_id)
        WHERE c.id = $1
        LIMIT 1
        ${forUpdate ? "FOR UPDATE OF c" : ""}`,
      [id],
    );
    return result.rows[0] === undefined ? null : mapConnection(result.rows[0]);
  }

  async saveConnection(connection: ConnectionRecord): Promise<void> {
    await this.upsertConnection(this.pool, connection);
  }

  async mutateConnectionWithOutboxEvent(
    connectionId: string,
    mutate: (current: ConnectionRecord) => ConnectionMutation,
  ): Promise<ConnectionRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.getConnectionFrom(client, connectionId, true);
      if (current === null) {
        await client.query("COMMIT");
        return null;
      }
      const mutation = mutate(current);
      await this.upsertConnection(client, mutation.connection);
      if (mutation.event !== null) await this.insertOutboxEvent(client, mutation.event);
      await client.query("COMMIT");
      return mutation.connection;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertConnection(
    database: Pool | PoolClient,
    connection: ConnectionRecord,
  ): Promise<void> {
    await database.query(
      `INSERT INTO connections (
         id, user_a_id, user_b_id, agent_a_id, agent_b_id, status,
         user_a_proxy_consent, user_b_proxy_consent, established_at, blocked_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         user_a_proxy_consent = EXCLUDED.user_a_proxy_consent,
         user_b_proxy_consent = EXCLUDED.user_b_proxy_consent,
         established_at = EXCLUDED.established_at,
         blocked_at = EXCLUDED.blocked_at,
         updated_at = now()`,
      [
        connection.id,
        connection.userAId,
        connection.userBId,
        connection.agentAId,
        connection.agentBId,
        connection.status,
        connection.userAProxyConsent,
        connection.userBProxyConsent,
        connection.establishedAt,
        connection.blockedByUserId === null ? null : new Date().toISOString(),
      ],
    );
    if (connection.blockedByUserId !== null) {
      const blockedUserId =
        connection.blockedByUserId === connection.userAId ? connection.userBId : connection.userAId;
      await database.query(
        `INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [connection.blockedByUserId, blockedUserId],
      );
    }
  }

  async getHumanMessage(id: string): Promise<HumanMessageRecord | null> {
    const result = await this.pool.query<MessageRow>(
      "SELECT * FROM connection_messages WHERE id = $1",
      [id],
    );
    return result.rows[0] === undefined ? null : mapMessage(result.rows[0]);
  }

  async saveHumanMessage(message: HumanMessageRecord): Promise<HumanMessageRecord> {
    const result = await this.pool.query<MessageRow>(
      `INSERT INTO connection_messages
         (id, connection_id, sender_user_id, content, client_message_id, trace_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (sender_user_id, client_message_id) DO UPDATE
         SET client_message_id = EXCLUDED.client_message_id
       RETURNING *`,
      [
        message.id,
        message.connectionId,
        message.senderUserId,
        message.content,
        message.clientMessageId,
        message.traceId,
        message.createdAt,
      ],
    );
    return mapMessage(requiredRow(result.rows[0]));
  }

  async countHumanMessages(connectionId: string): Promise<number> {
    const result = await this.pool.query<{ count: string } & QueryResultRow>(
      "SELECT count(*)::text AS count FROM connection_messages WHERE connection_id = $1",
      [connectionId],
    );
    return Number(requiredRow(result.rows[0]).count);
  }

  async findAssistRequest(
    requesterUserId: string,
    clientRequestId: string,
  ): Promise<AssistRequestRecord | null> {
    const result = await this.pool.query<AssistRow>(
      `SELECT * FROM agent_assist_requests
        WHERE requester_user_id = $1 AND client_request_id = $2`,
      [requesterUserId, clientRequestId],
    );
    return result.rows[0] === undefined ? null : mapAssist(result.rows[0]);
  }

  async saveAssistRequest(request: AssistRequestRecord): Promise<AssistRequestRecord> {
    try {
      return await this.upsertAssistRequest(this.pool, request);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.findAssistRequest(
        request.requesterUserId,
        request.clientRequestId,
      );
      if (existing === null) throw error;
      return existing;
    }
  }

  private async upsertAssistRequest(
    database: Pool | PoolClient,
    request: AssistRequestRecord,
  ): Promise<AssistRequestRecord> {
    const result = await database.query<AssistRow>(
      `INSERT INTO agent_assist_requests (
           id, connection_id, requester_user_id, request_type, source_message_id,
           client_request_id, status, result_json, trace_id, error_code, created_at, completed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           result_json = EXCLUDED.result_json,
           error_code = EXCLUDED.error_code,
           completed_at = EXCLUDED.completed_at,
           updated_at = now()
         RETURNING *`,
      [
        request.id,
        request.connectionId,
        request.requesterUserId,
        request.requestType,
        request.sourceMessageId,
        request.clientRequestId,
        request.status,
        request.result === null ? null : JSON.stringify(request.result),
        request.traceId,
        request.errorCode,
        request.createdAt,
        request.completedAt,
      ],
    );
    return mapAssist(requiredRow(result.rows[0]));
  }

  async saveAssistRequestWithEventAndAudit(
    request: AssistRequestRecord,
    event: OutboxEventRecord,
    audit: AuditLogRecord,
  ): Promise<AssistRequestRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await this.upsertAssistRequest(client, request);
      await this.insertOutboxEvent(client, event);
      await this.insertAuditLog(client, audit);
      await client.query("COMMIT");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getAssistRequest(id: string): Promise<AssistRequestRecord | null> {
    const result = await this.pool.query<AssistRow>(
      "SELECT * FROM agent_assist_requests WHERE id = $1",
      [id],
    );
    return result.rows[0] === undefined ? null : mapAssist(result.rows[0]);
  }

  async createTeaPartyMission(mission: TeaPartyMissionRecord): Promise<TeaPartyMissionRecord> {
    try {
      const result = await this.pool.query<MissionRow>(
        `INSERT INTO social_missions (
           id, connection_id, mission_type, initiator_agent_id, target_agent_id,
           goal, max_turns, allowed_topics, forbidden_topics, disclosure_level,
           budget, stop_conditions, status, current_turn, stop_reason, trace_id,
           retry_count, result, summary_json, created_at, started_at, completed_at
         ) VALUES (
           $1,$2,'post_connection_tea_party',$3,$4,$5,$6,'[]','[]','L2_SOCIAL',
           $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
         ) RETURNING *`,
        missionValues(mission),
      );
      return mapMission(requiredRow(result.rows[0]));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.getTeaPartyMissionByConnection(mission.connectionId);
      if (existing === null) throw error;
      return existing;
    }
  }

  async getTeaPartyMissionByConnection(
    connectionId: string,
  ): Promise<TeaPartyMissionRecord | null> {
    const result = await this.pool.query<MissionRow>(
      `SELECT * FROM social_missions
        WHERE connection_id = $1 AND mission_type = 'post_connection_tea_party'
        LIMIT 1`,
      [connectionId],
    );
    return result.rows[0] === undefined ? null : mapMission(result.rows[0]);
  }

  async acquireTeaPartyRunLock(connectionId: string): Promise<(() => Promise<void>) | null> {
    const client = new Client(this.pool.options);
    const lockKey = `reso-ai:tea-party:${connectionId}`;
    try {
      await client.connect();
      const result = await client.query<{ acquired: boolean } & QueryResultRow>(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
        [lockKey],
      );
      if (result.rows[0]?.acquired !== true) {
        await client.end();
        return null;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]);
        } finally {
          await client.end();
        }
      };
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
  }

  async saveTeaPartyMission(mission: TeaPartyMissionRecord): Promise<TeaPartyMissionRecord> {
    return this.updateTeaPartyMission(this.pool, mission);
  }

  private async updateTeaPartyMission(
    database: Pool | PoolClient,
    mission: TeaPartyMissionRecord,
  ): Promise<TeaPartyMissionRecord> {
    const result = await database.query<MissionRow>(
      `UPDATE social_missions SET
         status=$2, current_turn=$3, stop_reason=$4, error_code=$5, trace_id=$6, retry_count=$7,
         result=$8, summary_json=$9, started_at=$10, completed_at=$11, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [
        mission.id,
        mission.status,
        mission.currentTurn,
        mission.stopReason,
        mission.errorCode ?? null,
        mission.traceId,
        mission.retryCount,
        JSON.stringify({ modelCallsUsed: mission.modelCallsUsed }),
        mission.summary === null ? null : JSON.stringify(mission.summary),
        mission.startedAt,
        mission.completedAt,
      ],
    );
    return mapMission(requiredRow(result.rows[0]));
  }

  async saveTeaPartyMissionWithEventAndAudit(
    mission: TeaPartyMissionRecord,
    event: OutboxEventRecord,
    audit: AuditLogRecord,
  ): Promise<TeaPartyMissionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await this.updateTeaPartyMission(client, mission);
      await this.insertOutboxEvent(client, event);
      await this.insertAuditLog(client, audit);
      await client.query("COMMIT");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveInteraction(interaction: AgentInteractionRecord): Promise<AgentInteractionRecord> {
    const result = await this.pool.query<InteractionRow>(
      `INSERT INTO agent_interactions (
         id, mission_id, turn_number, actor_agent_id, input_summary, output_summary,
         disclosure_decision, content, visibility, model_trace_id, trace_id, created_at
       ) VALUES ($1,$2,$3,$4,'',$5,'ALLOW',$5,$6,$7,$8,$9)
       ON CONFLICT (mission_id, turn_number) DO NOTHING
       RETURNING *`,
      [
        interaction.id,
        interaction.missionId,
        interaction.turnNo,
        interaction.speakerAgentId,
        interaction.content,
        interaction.visibility,
        interaction.modelTraceId,
        interaction.traceId,
        interaction.createdAt,
      ],
    );
    if (result.rows[0] !== undefined) return mapInteraction(result.rows[0]);
    const existing = await this.pool.query<InteractionRow>(
      "SELECT * FROM agent_interactions WHERE mission_id=$1 AND turn_number=$2",
      [interaction.missionId, interaction.turnNo],
    );
    return mapInteraction(requiredRow(existing.rows[0]));
  }

  async listInteractions(missionId: string): Promise<AgentInteractionRecord[]> {
    const result = await this.pool.query<InteractionRow>(
      "SELECT * FROM agent_interactions WHERE mission_id=$1 ORDER BY turn_number ASC",
      [missionId],
    );
    return result.rows.map(mapInteraction);
  }

  async saveOutboxEvent(event: OutboxEventRecord): Promise<OutboxEventRecord> {
    return this.insertOutboxEvent(this.pool, event);
  }

  private async insertOutboxEvent(
    database: Pool | PoolClient,
    event: OutboxEventRecord,
  ): Promise<OutboxEventRecord> {
    const result = await database.query<OutboxRow>(
      `INSERT INTO event_outbox
         (id,event_type,event_version,aggregate_type,aggregate_id,correlation_id,
          causation_id,idempotency_key,payload,occurred_at)
       VALUES ($1,$2,1,$3,$4,$5,NULL,$6,$7,$8)
       ON CONFLICT (idempotency_key) DO UPDATE
         SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING id,event_type,aggregate_id,correlation_id,idempotency_key,payload,
                 occurred_at,0::integer AS attempts`,
      [
        event.id,
        event.eventType,
        aggregateTypeFor(event.eventType),
        event.subjectId,
        event.traceId,
        event.idempotencyKey,
        JSON.stringify(event.payload),
        event.occurredAt,
      ],
    );
    return mapOutbox(requiredRow(result.rows[0]));
  }

  async listOutboxEvents(): Promise<OutboxEventRecord[]> {
    const result = await this.pool.query<OutboxRow>(
      `SELECT id,event_type,aggregate_id,correlation_id,idempotency_key,payload,
              occurred_at,0::integer AS attempts
         FROM event_outbox ORDER BY occurred_at ASC,id ASC`,
    );
    return result.rows.map(mapOutbox);
  }

  async claimOutboxEvents(
    workerId: string,
    eventTypes: string[],
    limit: number,
  ): Promise<OutboxEventRecord[]> {
    const consumerName = consumerNameFor(workerId);
    const result = await this.pool.query<OutboxRow>(
      `WITH candidates AS (
         SELECT e.id
           FROM event_outbox e
           LEFT JOIN event_consumptions c
             ON c.consumer_name=$1 AND c.event_id=e.id
          WHERE e.event_type=ANY($2::text[])
            AND (
              c.event_id IS NULL
              OR (c.status='failed' AND c.attempt_count < 5 AND c.available_at <= now())
               OR (c.status='processing' AND c.attempt_count < 5
                  AND c.updated_at < now() - interval '5 minutes')
            )
          ORDER BY e.occurred_at,e.id
          FOR UPDATE OF e SKIP LOCKED
          LIMIT $3
       ), claimed AS (
         INSERT INTO event_consumptions
           (consumer_name,event_id,status,attempt_count,last_error,available_at,
            first_seen_at,updated_at)
         SELECT $1,id,'processing',1,NULL,now(),now(),now() FROM candidates
         ON CONFLICT (consumer_name,event_id) DO UPDATE SET
           status='processing',
           attempt_count=event_consumptions.attempt_count+1,
           last_error=NULL,
           available_at=now(),
           updated_at=now(),
           acknowledged_at=NULL
         RETURNING event_id,attempt_count
       )
       SELECT e.id,e.event_type,e.aggregate_id,e.correlation_id,e.idempotency_key,
              e.payload,e.occurred_at,c.attempt_count AS attempts
         FROM claimed c JOIN event_outbox e ON e.id=c.event_id
        ORDER BY e.occurred_at,e.id`,
      [consumerName, eventTypes, limit],
    );
    return result.rows.map(mapOutbox);
  }

  async completeOutboxEvent(
    eventId: string,
    workerId: string,
    expectedAttempt: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE event_consumptions SET
         status='acked',last_error=NULL,updated_at=now(),acknowledged_at=now()
        WHERE consumer_name=$1 AND event_id=$2 AND status='processing' AND attempt_count=$3`,
      [consumerNameFor(workerId), eventId, expectedAttempt],
    );
  }

  async retryOutboxEvent(
    eventId: string,
    workerId: string,
    expectedAttempt: number,
    errorCode: string,
    availableAt: string,
  ): Promise<void> {
    const consumerName = consumerNameFor(workerId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const failed = await client.query<{ attempt_count: number } & QueryResultRow>(
        `UPDATE event_consumptions SET
           status='failed',last_error=$4,available_at=$5,updated_at=now()
          WHERE consumer_name=$1 AND event_id=$2 AND status='processing' AND attempt_count=$3
          RETURNING attempt_count`,
        [consumerName, eventId, expectedAttempt, errorCode, availableAt],
      );
      const attempts = failed.rows[0]?.attempt_count;
      if (attempts !== undefined && attempts >= 5) {
        await client.query(
          `INSERT INTO dead_letter_events
             (consumer_name,event_id,event_type,payload,attempt_count,
              failure_code,failure_message)
           SELECT $1,e.id,e.event_type,e.payload,$3,$4,$4
             FROM event_outbox e WHERE e.id=$2
           ON CONFLICT (consumer_name,event_id) DO NOTHING`,
          [consumerName, eventId, attempts, errorCode],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveSession(tokenHash: string): Promise<string | null> {
    const result = await this.pool.query<{ user_id: string } & QueryResultRow>(
      `UPDATE user_sessions SET last_seen_at=now()
        WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [tokenHash],
    );
    return result.rows[0]?.user_id ?? null;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_sessions (user_id,token_hash,expires_at)
       VALUES ($1,$2,$3)`,
      [userId, tokenHash, expiresAt],
    );
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.pool.query(
      "UPDATE user_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL",
      [tokenHash],
    );
  }

  async saveAuditLog(record: AuditLogRecord): Promise<void> {
    await this.insertAuditLog(this.pool, record);
  }

  private async insertAuditLog(database: Pool | PoolClient, record: AuditLogRecord): Promise<void> {
    await database.query(
      `INSERT INTO product_audit_log
         (id,actor_user_id,action,subject_id,trace_id,outcome,metadata,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        record.id,
        record.actorUserId,
        record.action,
        record.subjectId,
        record.traceId,
        record.outcome,
        JSON.stringify(record.metadata),
        record.createdAt,
      ],
    );
  }
}

function missionValues(mission: TeaPartyMissionRecord): unknown[] {
  return [
    mission.id,
    mission.connectionId,
    mission.initiatorAgentId,
    mission.targetAgentId,
    "Generate a bounded post-connection tea party",
    mission.maxTurns,
    JSON.stringify({ maxModelCalls: mission.maxModelCalls, maxTokens: 1 }),
    JSON.stringify(["max_turns", "consent_revoked", "relationship_blocked"]),
    mission.status,
    mission.currentTurn,
    mission.stopReason,
    mission.traceId,
    mission.retryCount,
    JSON.stringify({ modelCallsUsed: mission.modelCallsUsed }),
    mission.summary === null ? null : JSON.stringify(mission.summary),
    mission.createdAt,
    mission.startedAt,
    mission.completedAt,
  ];
}

function mapConnection(row: ConnectionRow): ConnectionRecord {
  return {
    id: row.id,
    userAId: row.user_a_id,
    userBId: row.user_b_id,
    agentAId: row.agent_a_id,
    agentBId: row.agent_b_id,
    status: row.status,
    userAProxyConsent: row.user_a_proxy_consent,
    userBProxyConsent: row.user_b_proxy_consent,
    blockedByUserId: row.blocked_by_user_id,
    establishedAt: iso(row.established_at),
  };
}

function mapMessage(row: MessageRow): HumanMessageRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    senderUserId: row.sender_user_id,
    content: row.content,
    clientMessageId: row.client_message_id,
    traceId: row.trace_id,
    createdAt: requiredIso(row.created_at),
  };
}

function mapAssist(row: AssistRow): AssistRequestRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    requesterUserId: row.requester_user_id,
    requestType: row.request_type,
    sourceMessageId: row.source_message_id,
    clientRequestId: row.client_request_id,
    status: row.status,
    result: row.result_json,
    traceId: row.trace_id,
    errorCode: row.error_code,
    createdAt: requiredIso(row.created_at),
    completedAt: iso(row.completed_at),
  };
}

function mapMission(row: MissionRow): TeaPartyMissionRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    missionType: "post_connection_tea_party",
    initiatorAgentId: row.initiator_agent_id,
    targetAgentId: row.target_agent_id,
    status: row.status,
    maxTurns: row.max_turns,
    currentTurn: row.current_turn,
    maxModelCalls: row.budget.maxModelCalls ?? row.max_turns + 1,
    modelCallsUsed: row.result?.modelCallsUsed ?? 0,
    stopReason: row.stop_reason,
    errorCode: row.error_code,
    traceId: row.trace_id,
    retryCount: row.retry_count,
    summary: row.summary_json,
    createdAt: requiredIso(row.created_at),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
  };
}

function mapInteraction(row: InteractionRow): AgentInteractionRecord {
  return {
    id: row.id,
    missionId: row.mission_id,
    turnNo: row.turn_number,
    speakerAgentId: row.actor_agent_id,
    content: row.content,
    visibility: row.visibility,
    modelTraceId: row.model_trace_id,
    traceId: row.trace_id,
    createdAt: requiredIso(row.created_at),
  };
}

function mapOutbox(row: OutboxRow): OutboxEventRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    subjectId: row.aggregate_id,
    traceId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    occurredAt: requiredIso(row.occurred_at),
    attempts: row.attempts ?? 0,
  };
}

function aggregateTypeFor(eventType: string): string {
  if (eventType.startsWith("agent_assist.")) return "assist_request";
  if (eventType.startsWith("tea_party.") || eventType === "social_mission.created") {
    return "tea_party_mission";
  }
  return "product";
}

function consumerNameFor(workerId: string): string {
  return workerId.split(":", 1)[0] ?? workerId;
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : requiredIso(value);
}

function requiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requiredRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error("Expected PostgreSQL to return a row");
  return row;
}

function isUniqueViolation(error: unknown): error is { code: "23505" } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
