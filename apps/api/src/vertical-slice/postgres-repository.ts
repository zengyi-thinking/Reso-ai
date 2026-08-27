import { randomUUID } from "node:crypto";
import {
  AgentPublicEventSchema,
  MemoryCandidateRecordSchema,
  MemoryContextSchema,
  PersonaContentSchema,
  PersonaPatchRecordSchema,
  PersonaVersionSchema,
  PrimaryAgentSchema,
  ProductConversationSchema,
  ProductIdentitySchema,
  ProductMessageSchema,
  ProductUserSchema,
  QuickStartAnswersSchema,
  type AgentPublicEvent,
  type MemoryCandidate,
  type MemoryCandidateRecord,
  type PersonaPatchRecord,
  type ProductConversation,
  type ProductConversationDetail,
  type ProductIdentity,
  type ProductMessage,
} from "@reso/contracts";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  AgentContextRecord,
  CandidateDecision,
  CorrectionRecord,
  DecideResult,
  EmailCodeRecord,
  GuestRecord,
  OutboxAppend,
  ReflectionCandidateInput,
  ReflectionPatchInput,
  ReflectionPersona,
  TranscriptRow,
  VerticalSliceRepository,
} from "./repository.js";

type Database = Pool | PoolClient;
interface CodeRow extends QueryResultRow {
  id: string;
  email: string;
  code_hash: string;
  expires_at: Date | string;
  resend_available_at: Date | string;
  attempts: number;
  max_attempts: number;
  consumed_at: Date | string | null;
  created_at: Date | string;
}
interface GuestRow extends QueryResultRow {
  id: string;
  token_hash: string;
  status: GuestRecord["status"];
  answers_json: unknown;
  persona_draft_json: unknown;
  user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}
interface CorrectionRow extends QueryResultRow {
  id: string;
  path: string;
  previous_value: unknown;
  corrected_value: unknown;
  created_at: Date | string;
}
interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  display_name: string | null;
  created_at: Date | string;
}
interface AgentRow extends QueryResultRow {
  id: string;
  user_id: string;
  name: string;
  status: "active" | "paused" | "retired";
  created_at: Date | string;
}
interface PersonaRow extends QueryResultRow {
  id: string;
  profile_id: string;
  version: number;
  content: unknown;
  change_summary: string;
  confirmed_by_user: boolean;
  created_at: Date | string;
}
interface ConversationRow extends QueryResultRow {
  id: string;
  user_id: string;
  agent_id: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface MessageRow extends QueryResultRow {
  id: string;
  conversation_id: string;
  role: "user" | "agent";
  content: string;
  public_events: unknown;
  created_at: Date | string;
}
interface MemoryCandidateRow extends QueryResultRow {
  id: string;
  user_id: string;
  source_message_id: string | null;
  type: MemoryCandidate["type"];
  summary: string;
  evidence_message_ids: unknown;
  confidence: string | number;
  requires_review: boolean;
  status: "pending" | "accepted" | "rejected";
  created_at: Date | string;
}
interface PersonaPatchRow extends QueryResultRow {
  id: string;
  user_id: string;
  from_version_id: string;
  path: string;
  old_value: unknown;
  proposed_value: unknown;
  reason: string;
  evidence_message_ids: unknown;
  confidence: string | number;
  status: "pending" | "accepted" | "rejected" | "superseded";
  created_at: Date | string;
  confirmed_at: Date | string | null;
}

interface MemoryRow extends QueryResultRow {
  id: string;
  user_id: string;
  type: "episodic" | "persona_related" | "relationship" | "correction" | "reflection";
  summary: string;
  source_event_id: string | null;
  occurred_at: Date | string;
  created_at: Date | string;
  importance: string | number;
  relationship_relevance: string | number;
  topics: unknown;
  enabled: boolean;
  conflicts_with: unknown;
}

export class PostgresVerticalSliceRepository implements VerticalSliceRepository {
  constructor(private readonly pool: Pool) {}

  async findLatestEmailCode(email: string): Promise<EmailCodeRecord | null> {
    const result = await this.pool.query<CodeRow>(
      "SELECT * FROM email_verification_codes WHERE email=$1 ORDER BY created_at DESC LIMIT 1",
      [email],
    );
    return result.rows[0] === undefined ? null : mapCode(result.rows[0]);
  }
  async saveEmailCode(record: EmailCodeRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO email_verification_codes (id,email,code_hash,expires_at,resend_available_at,attempts,max_attempts,consumed_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        record.id,
        record.email,
        record.codeHash,
        record.expiresAt,
        record.resendAvailableAt,
        record.attempts,
        record.maxAttempts,
        record.consumedAt,
        record.createdAt,
      ],
    );
  }
  async updateEmailCode(record: EmailCodeRecord): Promise<void> {
    await this.pool.query(
      "UPDATE email_verification_codes SET attempts=$2, consumed_at=$3 WHERE id=$1",
      [record.id, record.attempts, record.consumedAt],
    );
  }
  async incrementEmailCodeAttempt(id: string, email: string): Promise<number> {
    const result = await this.pool.query<{ attempts: number } & QueryResultRow>(
      `UPDATE email_verification_codes SET attempts=attempts+1 WHERE id=$1 AND email=$2 AND consumed_at IS NULL RETURNING attempts`,
      [id, email],
    );
    return result.rows[0]?.attempts ?? 0;
  }
  async consumeEmailCode(id: string, email: string, consumedAt: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE email_verification_codes SET consumed_at=$3 WHERE id=$1 AND email=$2 AND consumed_at IS NULL AND expires_at > $3 AND attempts < max_attempts`,
      [id, email, consumedAt],
    );
    return (result.rowCount ?? 0) === 1;
  }
  async findOrCreateUser(email: string, now: string) {
    const existing = await this.pool.query<UserRow>(
      "SELECT id,email,display_name,created_at FROM users WHERE email=$1",
      [email],
    );
    if (existing.rows[0] !== undefined) return { user: mapUser(existing.rows[0]), created: false };
    const inserted = await this.pool.query<UserRow>(
      `INSERT INTO users (id,email,created_at,updated_at) VALUES ($1,$2,$3,$3) ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id,email,display_name,created_at`,
      [randomUUID(), email, now],
    );
    return { user: mapUser(inserted.rows[0]!), created: true };
  }
  async getIdentity(userId: string): Promise<ProductIdentity | null> {
    return this.identity(this.pool, userId);
  }

  async createGuest(record: GuestRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO guest_onboarding_sessions (id,token_hash,status,answers_json,persona_draft_json,user_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        record.id,
        record.tokenHash,
        record.status,
        record.answers,
        record.personaDraft,
        record.userId,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }
  async getGuestByTokenHash(tokenHash: string): Promise<GuestRecord | null> {
    const result = await this.pool.query<GuestRow>(
      "SELECT * FROM guest_onboarding_sessions WHERE token_hash=$1",
      [tokenHash],
    );
    return result.rows[0] === undefined ? null : this.mapGuest(this.pool, result.rows[0]);
  }
  async saveGuest(record: GuestRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE guest_onboarding_sessions SET status=$2,answers_json=$3,persona_draft_json=$4,user_id=$5,updated_at=$6 WHERE id=$1`,
        [
          record.id,
          record.status,
          record.answers,
          record.personaDraft,
          record.userId,
          record.updatedAt,
        ],
      );
      await client.query("DELETE FROM onboarding_corrections WHERE guest_session_id=$1", [
        record.id,
      ]);
      for (const item of record.corrections)
        await client.query(
          `INSERT INTO onboarding_corrections (id,guest_session_id,path,previous_value,corrected_value,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [item.id, record.id, item.path, item.previousValue, item.correctedValue, item.createdAt],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async attachGuestToUser(guestId: string, userId: string, now: string): Promise<void> {
    await this.pool.query(
      "UPDATE guest_onboarding_sessions SET user_id=$2,updated_at=$3 WHERE id=$1 AND (user_id IS NULL OR user_id=$2)",
      [guestId, userId, now],
    );
  }
  async claimGuest(
    guestId: string,
    userId: string,
    agentName: string,
    now: string,
  ): Promise<ProductIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const guestResult = await client.query<GuestRow>(
        "SELECT * FROM guest_onboarding_sessions WHERE id=$1 FOR UPDATE",
        [guestId],
      );
      const row = guestResult.rows[0];
      if (row === undefined || row.user_id !== userId || row.persona_draft_json === null)
        throw new Error("Guest onboarding cannot be claimed");
      let identity = await this.identity(client, userId);
      if (identity?.persona === null) {
        const profileId = randomUUID();
        const versionId = randomUUID();
        await client.query(
          "INSERT INTO persona_profiles (id,user_id,created_at,updated_at) VALUES ($1,$2,$3,$3)",
          [profileId, userId, now],
        );
        await client.query(
          `INSERT INTO persona_versions (id,profile_id,version,content,change_summary,confirmed_by_user,created_at) VALUES ($1,$2,1,$3,'Quick Start draft confirmed by user',true,$4)`,
          [versionId, profileId, PersonaContentSchema.parse(row.persona_draft_json), now],
        );
        await client.query(
          "UPDATE persona_profiles SET current_version_id=$2,updated_at=$3 WHERE id=$1",
          [profileId, versionId, now],
        );
      }
      await client.query(
        `INSERT INTO agents (id,user_id,name,status,created_at,updated_at) VALUES ($1,$2,$3,'active',$4,$4) ON CONFLICT (user_id) DO NOTHING`,
        [randomUUID(), userId, agentName, now],
      );
      const corrections = await client.query<CorrectionRow>(
        "SELECT * FROM onboarding_corrections WHERE guest_session_id=$1",
        [guestId],
      );
      for (const correction of corrections.rows) {
        await client.query(
          `INSERT INTO memories (id,user_id,type,summary,source_event_id,occurred_at,created_at,updated_at,importance,topics,enabled) VALUES ($1,$2,'correction',$3,$4,$5,$5,$5,1.0,$6,true) ON CONFLICT (id) DO NOTHING`,
          [
            correction.id,
            userId,
            `用户明确修正了 Persona 的 ${correction.path} 字段；后续理解以用户修正为准。`,
            correction.id,
            correction.created_at,
            JSON.stringify(["persona-correction", correction.path]),
          ],
        );
      }
      await client.query(
        "UPDATE guest_onboarding_sessions SET status='claimed',updated_at=$2 WHERE id=$1",
        [guestId, now],
      );
      identity = await this.identity(client, userId);
      await client.query("COMMIT");
      if (identity === null || identity.agent === null || identity.persona === null)
        throw new Error("Claim transaction did not create identity");
      return identity;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createConversation(
    userId: string,
    agentId: string,
    now: string,
  ): Promise<ProductConversation> {
    const result = await this.pool.query<ConversationRow>(
      `INSERT INTO conversations (id,user_id,agent_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$4) RETURNING *`,
      [randomUUID(), userId, agentId, now],
    );
    return mapConversation(result.rows[0]!);
  }
  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ProductConversationDetail | null> {
    const result = await this.pool.query<ConversationRow>(
      "SELECT * FROM conversations WHERE id=$1 AND user_id=$2",
      [conversationId, userId],
    );
    if (result.rows[0] === undefined) return null;
    const messages = await this.pool.query<MessageRow>(
      "SELECT id,conversation_id,role,content,public_events,created_at FROM messages WHERE conversation_id=$1 AND role IN ('user','agent') ORDER BY created_at,id",
      [conversationId],
    );
    return {
      conversation: mapConversation(result.rows[0]),
      messages: messages.rows.map(mapMessage),
    };
  }
  async listConversations(userId: string): Promise<ProductConversation[]> {
    const result = await this.pool.query<ConversationRow>(
      "SELECT * FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC",
      [userId],
    );
    return result.rows.map(mapConversation);
  }
  async findMessageByClientId(
    userId: string,
    clientMessageId: string,
  ): Promise<ProductMessage | null> {
    const result = await this.pool.query<MessageRow>(
      `SELECT m.id,m.conversation_id,m.role,m.content,m.public_events,m.created_at FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=$1 AND m.client_message_id=$2 LIMIT 1`,
      [userId, clientMessageId],
    );
    return result.rows[0] === undefined ? null : mapMessage(result.rows[0]);
  }
  async saveMessage(message: ProductMessage, clientMessageId?: string): Promise<ProductMessage> {
    const result = await this.pool.query<MessageRow>(
      `INSERT INTO messages (id,conversation_id,role,content,public_events,client_message_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (conversation_id,client_message_id) WHERE client_message_id IS NOT NULL DO UPDATE SET content=messages.content RETURNING id,conversation_id,role,content,public_events,created_at`,
      [
        message.id,
        message.conversationId,
        message.role,
        message.content,
        JSON.stringify(message.publicEvents),
        clientMessageId ?? null,
        message.createdAt,
      ],
    );
    await this.pool.query("UPDATE conversations SET updated_at=$2 WHERE id=$1", [
      message.conversationId,
      message.createdAt,
    ]);
    return mapMessage(result.rows[0]!);
  }
  async getAgentContext(
    userId: string,
    conversationId: string,
  ): Promise<AgentContextRecord | null> {
    const identity = await this.identity(this.pool, userId);
    const conversationResult = await this.pool.query<ConversationRow>(
      "SELECT * FROM conversations WHERE id=$1 AND user_id=$2",
      [conversationId, userId],
    );
    if (
      identity?.agent === null ||
      identity?.agent === undefined ||
      identity.persona === null ||
      conversationResult.rows[0] === undefined
    )
      return null;
    const memories = await this.pool.query<MemoryRow>(
      "SELECT * FROM memories WHERE user_id=$1 AND enabled=true ORDER BY importance DESC,occurred_at DESC LIMIT 12",
      [userId],
    );
    const recent = await this.pool.query<MessageRow>(
      `SELECT id,conversation_id,role,content,public_events,created_at FROM messages WHERE conversation_id=$1 AND role IN ('user','agent') ORDER BY created_at DESC,id DESC LIMIT 12`,
      [conversationId],
    );
    return {
      identity,
      conversation: mapConversation(conversationResult.rows[0]),
      persona: identity.persona,
      memories: memories.rows.map((row) =>
        MemoryContextSchema.parse({
          id: row.id,
          userId: row.user_id,
          type: row.type,
          summary: row.summary,
          sourceEventId: row.source_event_id,
          occurredAt: iso(row.occurred_at),
          createdAt: iso(row.created_at),
          importance: Number(row.importance),
          relationshipRelevance: Number(row.relationship_relevance),
          topics: row.topics,
          enabled: row.enabled,
          conflictsWith: row.conflicts_with,
        }),
      ),
      recentMessages: recent.rows
        .reverse()
        .map((row) => ({ id: row.id, role: row.role, content: row.content })),
    };
  }
  async saveMemoryCandidates(
    userId: string,
    sourceMessageId: string,
    candidates: MemoryCandidate[],
    now: string,
  ): Promise<void> {
    for (const item of candidates)
      await this.pool.query(
        `INSERT INTO memory_candidates (user_id,source_message_id,type,summary,evidence_message_ids,confidence,requires_review,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          userId,
          sourceMessageId,
          item.type,
          item.summary,
          JSON.stringify(item.evidenceMessageIds),
          item.confidence,
          item.requiresReview,
          now,
        ],
      );
  }
  async savePublicEvents(messageId: string, events: AgentPublicEvent[]): Promise<void> {
    await this.pool.query("UPDATE messages SET public_events=$2 WHERE id=$1", [
      messageId,
      JSON.stringify(events.map((event) => AgentPublicEventSchema.parse(event))),
    ]);
  }

  async appendOutboxEvent(event: OutboxAppend): Promise<void> {
    await this.pool.query(
      `INSERT INTO event_outbox
         (id,event_type,event_version,aggregate_type,aggregate_id,correlation_id,
          causation_id,idempotency_key,payload,occurred_at)
       VALUES ($1,$2,1,'message',$3,$4,NULL,$5,$6,$7)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        event.id,
        event.eventType,
        event.subjectId,
        event.correlationId,
        event.idempotencyKey,
        JSON.stringify(event.payload),
        event.occurredAt,
      ],
    );
  }

  async countUserMessagesAfter(conversationId: string, afterIso: string): Promise<number> {
    const result = await this.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM messages WHERE conversation_id=$1 AND role='user' AND created_at > $2::timestamptz",
      [conversationId, afterIso],
    );
    return result.rows[0]?.n ?? 0;
  }

  async getReflectionWindow(
    conversationId: string,
    limit: number,
  ): Promise<{ transcript: TranscriptRow[]; newestAt: string } | null> {
    const result = await this.pool.query<MessageRow>(
      `SELECT id,conversation_id,role,content,public_events,created_at FROM messages
       WHERE conversation_id=$1 AND role IN ('user','agent')
       ORDER BY created_at DESC,id DESC LIMIT $2`,
      [conversationId, limit],
    );
    if (result.rows.length === 0) return null;
    const transcript: TranscriptRow[] = result.rows
      .map((row) => ({
        id: row.id,
        role: row.role as "user" | "agent",
        content: row.content,
        createdAt: iso(row.created_at),
      }))
      .reverse();
    const newest = transcript.at(-1);
    if (newest === undefined) return null;
    return { transcript, newestAt: newest.createdAt };
  }

  async getReflectionPersona(userId: string): Promise<ReflectionPersona | null> {
    const personaResult = await this.pool.query<PersonaRow>(
      `SELECT pv.* FROM persona_profiles pp JOIN persona_versions pv ON pv.id=pp.current_version_id WHERE pp.user_id=$1`,
      [userId],
    );
    const row = personaResult.rows[0];
    if (row === undefined) return null;
    return {
      versionId: row.id,
      version: Number(row.version),
      content: PersonaContentSchema.parse(row.content),
    };
  }

  async saveReflectionResults(input: {
    userId: string;
    memories: ReflectionCandidateInput[];
    patches: ReflectionPatchInput[];
    now: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const memory of input.memories)
        await client.query(
          `INSERT INTO memory_candidates
             (user_id,source_message_id,type,summary,evidence_message_ids,confidence,requires_review,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,true,$7)`,
          [
            input.userId,
            memory.sourceMessageId,
            memory.type,
            memory.summary,
            JSON.stringify(memory.evidenceMessageIds),
            memory.confidence,
            input.now,
          ],
        );
      for (const patch of input.patches)
        await client.query(
          `INSERT INTO persona_patch_candidates
             (user_id,from_version_id,path,old_value,proposed_value,reason,evidence_message_ids,confidence,status,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
          [
            input.userId,
            patch.fromVersionId,
            patch.path,
            JSON.stringify(patch.oldValue ?? null),
            JSON.stringify(patch.proposedValue ?? null),
            patch.reason,
            JSON.stringify(patch.evidenceMessageIds),
            patch.confidence,
            input.now,
          ],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private static readonly EPOCH_FLOOR = "1970-01-01T00:00:00Z";

  async reflectionWatermarkAfter(conversationId: string): Promise<string> {
    const result = await this.pool.query<{ watermark: Date | string }>(
      `SELECT CASE WHEN last_reflected_at < '1970-01-01'::timestamptz
                   THEN '1970-01-01T00:00:00Z'::timestamptz
                   ELSE last_reflected_at END AS watermark
         FROM reflection_runs WHERE conversation_id=$1`,
      [conversationId],
    );
    return result.rows[0] === undefined
      ? PostgresVerticalSliceRepository.EPOCH_FLOOR
      : iso(result.rows[0].watermark);
  }

  async advanceReflectionRun(input: {
    userId: string;
    conversationId: string;
    lastReflectedAt: string;
    now: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO reflection_runs
         (user_id,conversation_id,last_reflected_at,reflected_run_count,created_at,updated_at)
       VALUES ($1,$2,$3,1,$4,$4)
       ON CONFLICT (conversation_id) DO UPDATE
         SET last_reflected_at=GREATEST(reflection_runs.last_reflected_at, EXCLUDED.last_reflected_at),
             reflected_run_count=reflection_runs.reflected_run_count+1,
             updated_at=EXCLUDED.updated_at`,
      [input.userId, input.conversationId, input.lastReflectedAt, input.now],
    );
  }

  async listPendingMemoryCandidates(userId: string): Promise<MemoryCandidateRecord[]> {
    const result = await this.pool.query<MemoryCandidateRow>(
      "SELECT * FROM memory_candidates WHERE user_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 50",
      [userId],
    );
    return result.rows.map((row) =>
      MemoryCandidateRecordSchema.parse({
        id: row.id,
        userId: row.user_id,
        sourceMessageId: row.source_message_id,
        type: row.type,
        summary: row.summary,
        evidenceMessageIds: row.evidence_message_ids,
        confidence: Number(row.confidence),
        requiresReview: row.requires_review,
        status: row.status,
        createdAt: iso(row.created_at),
      }),
    );
  }

  async decideMemoryCandidate(
    id: string,
    userId: string,
    decision: CandidateDecision,
    _now: string,
  ): Promise<DecideResult> {
    const target = await this.pool.query<{ id: string; status: string }>(
      "SELECT id,status FROM memory_candidates WHERE id=$1 AND user_id=$2",
      [id, userId],
    );
    if (target.rows[0] === undefined) return { outcome: "missing" };
    if (target.rows[0].status !== "pending") return { outcome: "not-pending" };
    if (decision === "reject") {
      await this.pool.query("UPDATE memory_candidates SET status='rejected' WHERE id=$1", [id]);
      return { outcome: "rejected" };
    }
    const source = await this.pool.query<MemoryCandidateRow>(
      "SELECT * FROM memory_candidates WHERE id=$1",
      [id],
    );
    const candidate = source.rows[0];
    if (candidate === undefined) return { outcome: "not-pending" };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const promoted = await client.query<{ id: string }>(
        `UPDATE memory_candidates SET status='accepted' WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING id`,
        [id, userId],
      );
      if (promoted.rows[0] === undefined) {
        await client.query("COMMIT");
        return { outcome: "not-pending" };
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO memories (user_id,type,summary,source_event_id,occurred_at,importance,relationship_relevance,topics,enabled)
         VALUES ($1,$2,$3,NULL,$4,$5,0,$6,true) RETURNING id`,
        [
          userId,
          candidate.type,
          candidate.summary,
          candidate.created_at,
          Number(candidate.confidence),
          JSON.stringify([]),
        ],
      );
      const memoryRow = inserted.rows[0];
      if (memoryRow === undefined) {
        await client.query("COMMIT");
        return { outcome: "not-pending" };
      }
      await client.query("COMMIT");
      return { outcome: "promoted", memoryId: memoryRow.id, summary: candidate.summary };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listMemoriesWithoutEmbedding(
    userId: string,
    limit: number,
  ): Promise<Array<{ id: string; summary: string }>> {
    const result = await this.pool.query<{ id: string; summary: string }>(
      "SELECT id,summary FROM memories WHERE user_id=$1 AND enabled=true AND embedding IS NULL ORDER BY occurred_at DESC LIMIT $2",
      [userId, limit],
    );
    return result.rows.map((row) => ({ id: row.id, summary: row.summary }));
  }

  async storeMemoryEmbedding(memoryId: string, embedding: number[]): Promise<void> {
    // pgvector accepts a textual literal only; keep it strict digits/sign/comma.
    const literal = `[${embedding.map((value) => JSON.stringify(value)).join(",")}]`;
    await this.pool.query("UPDATE memories SET embedding=$2::vector WHERE id=$1", [
      memoryId,
      literal,
    ]);
  }

  async listPendingPersonaPatches(userId: string): Promise<PersonaPatchRecord[]> {
    const result = await this.pool.query<PersonaPatchRow>(
      "SELECT * FROM persona_patch_candidates WHERE user_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 50",
      [userId],
    );
    return result.rows.map((row) =>
      PersonaPatchRecordSchema.parse({
        id: row.id,
        userId: row.user_id,
        fromVersionId: row.from_version_id,
        path: row.path,
        oldValue: row.old_value,
        proposedValue: row.proposed_value,
        reason: row.reason,
        evidenceMessageIds: row.evidence_message_ids,
        confidence: Number(row.confidence),
        status: row.status,
        createdAt: iso(row.created_at),
        confirmedAt: row.confirmed_at === null ? null : iso(row.confirmed_at),
      }),
    );
  }

  async decidePersonaPatch(
    id: string,
    userId: string,
    decision: CandidateDecision,
    now: string,
  ): Promise<DecideResult> {
    const nextStatus = decision === "accept" ? "accepted" : "rejected";
    const result = await this.pool.query<{ id: string }>(
      `UPDATE persona_patch_candidates
         SET status=$3,
             confirmed_at=CASE WHEN $3='accepted' THEN $4 ELSE confirmed_at END,
             updated_at=$4
       WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING id`,
      [id, userId, nextStatus, now],
    );
    if (result.rows[0] === undefined) {
      const exists = await this.pool.query<{ id: string }>(
        "SELECT id FROM persona_patch_candidates WHERE id=$1 AND user_id=$2",
        [id, userId],
      );
      return exists.rows[0] === undefined ? { outcome: "missing" } : { outcome: "not-pending" };
    }
    return decision === "accept" ? { outcome: "promoted" } : { outcome: "rejected" };
  }

  private async identity(database: Database, userId: string): Promise<ProductIdentity | null> {
    const userResult = await database.query<UserRow>(
      "SELECT id,email,display_name,created_at FROM users WHERE id=$1",
      [userId],
    );
    if (userResult.rows[0] === undefined) return null;
    const agentResult = await database.query<AgentRow>(
      "SELECT id,user_id,name,status,created_at FROM agents WHERE user_id=$1",
      [userId],
    );
    const personaResult = await database.query<PersonaRow>(
      `SELECT pv.* FROM persona_profiles pp JOIN persona_versions pv ON pv.id=pp.current_version_id WHERE pp.user_id=$1`,
      [userId],
    );
    return ProductIdentitySchema.parse({
      user: mapUser(userResult.rows[0]),
      agent: agentResult.rows[0] === undefined ? null : mapAgent(agentResult.rows[0]),
      persona: personaResult.rows[0] === undefined ? null : mapPersona(personaResult.rows[0]),
    });
  }
  private async mapGuest(database: Database, row: GuestRow): Promise<GuestRecord> {
    const result = await database.query<CorrectionRow>(
      "SELECT * FROM onboarding_corrections WHERE guest_session_id=$1 ORDER BY created_at,id",
      [row.id],
    );
    return {
      id: row.id,
      tokenHash: row.token_hash,
      status: row.status,
      answers: row.answers_json === null ? null : QuickStartAnswersSchema.parse(row.answers_json),
      personaDraft:
        row.persona_draft_json === null ? null : PersonaContentSchema.parse(row.persona_draft_json),
      corrections: result.rows.map(mapCorrection),
      userId: row.user_id,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function mapCode(row: CodeRow): EmailCodeRecord {
  return {
    id: row.id,
    email: row.email,
    codeHash: row.code_hash,
    expiresAt: iso(row.expires_at),
    resendAvailableAt: iso(row.resend_available_at),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    consumedAt: row.consumed_at === null ? null : iso(row.consumed_at),
    createdAt: iso(row.created_at),
  };
}
function mapCorrection(row: CorrectionRow): CorrectionRecord {
  return {
    id: row.id,
    path: row.path,
    previousValue: row.previous_value,
    correctedValue: row.corrected_value,
    createdAt: iso(row.created_at),
  };
}
function mapUser(row: UserRow) {
  return ProductUserSchema.parse({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: iso(row.created_at),
  });
}
function mapAgent(row: AgentRow) {
  return PrimaryAgentSchema.parse({
    id: row.id,
    ownerUserId: row.user_id,
    name: row.name,
    status: row.status,
    createdAt: iso(row.created_at),
  });
}
function mapPersona(row: PersonaRow) {
  return PersonaVersionSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    version: row.version,
    content: row.content,
    changeSummary: row.change_summary,
    confirmedByUser: row.confirmed_by_user,
    createdAt: iso(row.created_at),
  });
}
function mapConversation(row: ConversationRow) {
  return ProductConversationSchema.parse({
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}
function mapMessage(row: MessageRow) {
  const publicEvents = Array.isArray(row.public_events)
    ? row.public_events
    : row.public_events !== null && typeof row.public_events === "object"
      ? [row.public_events]
      : [];
  return ProductMessageSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    publicEvents,
    createdAt: iso(row.created_at),
  });
}
