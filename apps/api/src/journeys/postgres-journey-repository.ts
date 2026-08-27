import { randomUUID } from "node:crypto";
import {
  ClaimAgentResponseSchema,
  JourneyAnswerSchema,
  JourneyEvidenceSnapshotSchema,
  PersonalManualCandidateSchema,
  PersonalManualContentSchema,
  PersonalManualSnapshotSchema,
  PersonaVersionSchema,
  type ClaimAgentResponse,
  type JourneyAnswer,
  type JourneyEvidenceSnapshot,
  type PersonalManualSnapshot,
  type PersonaContent,
} from "@reso/contracts";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { ProductError } from "../product/product-error.js";
import type {
  ClaimAgentInput,
  ClaimJourneyOwnershipInput,
  CompleteJourneyInput,
  CompleteJourneyResult,
  CreateJourneyAttemptInput,
  EditManualInput,
  FailManualInput,
  JourneyAttemptRecord,
  JourneyRepository,
  RetryManualInput,
  SaveJourneyAnswerResult,
  SaveManualCandidateInput,
} from "./journey-repository.js";

interface AttemptRow extends QueryResultRow {
  id: string;
  user_id: string | null;
  version: string;
  status: JourneyAttemptRecord["status"];
  client_attempt_id: string;
  anonymous_token_hash: string | null;
  replay_of_journey_id: string | null;
  official: boolean;
  answer_count: number | string;
  started_at: Date | string;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AnswerRow extends QueryResultRow {
  id: string;
  journey_id: string;
  stage_id: string;
  question_id: string;
  choice_id: string;
  response_text: string | null;
  elapsed_ms: number | null;
  client_answer_id: string;
  answer_order: number;
  answered_at: Date | string;
  evidence_json: unknown;
}

interface EvidenceRow extends QueryResultRow {
  id: string;
  journey_id: string;
  journey_version: string;
  evidence_version: number;
  official: boolean;
  evidence_signature: string;
  items_json: unknown;
  created_at: Date | string;
}

interface ManualRow extends QueryResultRow {
  id: string;
  journey_id: string;
  status: PersonalManualSnapshot["status"];
  evidence_signature: string;
  original_content_json: unknown | null;
  current_content_json: unknown | null;
  current_source: PersonalManualSnapshot["currentSource"];
  revision: number;
  retryable: boolean;
  error_code: string | null;
  agent_trace_id: string | null;
  agent_version_id: string | null;
  model_version: string | null;
  persona_version_id: string | null;
  agent_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  generated_at: Date | string | null;
  claimed_at: Date | string | null;
}

export class PostgresJourneyRepository implements JourneyRepository {
  constructor(public readonly pool: Pool) {}

  async createJourneyAttempt(input: CreateJourneyAttemptInput): Promise<JourneyAttemptRecord> {
    try {
      const result = await this.pool.query<AttemptRow>(
        `INSERT INTO journeys (
           id,user_id,version,status,client_attempt_id,anonymous_token_hash,
           replay_of_journey_id,official,started_at,completed_at,created_at,updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *,0::integer AS answer_count`,
        attemptValues(input.attempt),
      );
      return mapAttempt(requiredRow(result.rows[0]));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.findJourneyAttemptByClient(
        input.attempt.userId,
        input.attempt.anonymousTokenHash,
        input.attempt.clientAttemptId,
      );
      if (existing !== null) return existing;
      if (
        input.attempt.official &&
        (error.constraint === "journeys_user_official_version_idx" ||
          error.constraint === "journeys_anonymous_official_version_idx")
      ) {
        const official = await this.findOfficialJourney(
          input.attempt.userId,
          input.attempt.anonymousTokenHash,
          input.attempt.journeyVersion,
        );
        if (official !== null) {
          return this.createJourneyAttempt({
            attempt: {
              ...input.attempt,
              official: false,
              replayOfJourneyId: official.id,
            },
          });
        }
      }
      throw error;
    }
  }

  async findJourneyAttemptByClient(
    userId: string | null,
    anonymousTokenHash: string | null,
    clientAttemptId: string,
  ): Promise<JourneyAttemptRecord | null> {
    const result = await this.pool.query<AttemptRow>(
      `${attemptSelect()}
       WHERE j.client_attempt_id=$1
         AND (($2::uuid IS NOT NULL AND j.user_id=$2)
           OR ($2::uuid IS NULL AND j.user_id IS NULL AND j.anonymous_token_hash=$3))
       LIMIT 1`,
      [clientAttemptId, userId, anonymousTokenHash],
    );
    return result.rows[0] === undefined ? null : mapAttempt(result.rows[0]);
  }

  async findOfficialJourney(
    userId: string | null,
    anonymousTokenHash: string | null,
    journeyVersion: JourneyAttemptRecord["journeyVersion"],
  ): Promise<JourneyAttemptRecord | null> {
    const result = await this.pool.query<AttemptRow>(
      `${attemptSelect()}
       WHERE j.version=$1 AND j.official=true
         AND (($2::uuid IS NOT NULL AND j.user_id=$2)
           OR ($2::uuid IS NULL AND j.user_id IS NULL AND j.anonymous_token_hash=$3))
       ORDER BY j.created_at,j.id LIMIT 1`,
      [journeyVersion, userId, anonymousTokenHash],
    );
    return result.rows[0] === undefined ? null : mapAttempt(result.rows[0]);
  }

  async getJourneyAttempt(id: string): Promise<JourneyAttemptRecord | null> {
    const result = await this.pool.query<AttemptRow>(`${attemptSelect()} WHERE j.id=$1`, [id]);
    return result.rows[0] === undefined ? null : mapAttempt(result.rows[0]);
  }

  async listJourneyAnswers(journeyId: string): Promise<JourneyAnswer[]> {
    const result = await this.pool.query<AnswerRow>(
      "SELECT * FROM journey_answers WHERE journey_id=$1 ORDER BY answer_order,id",
      [journeyId],
    );
    return result.rows.map(mapAnswer);
  }

  async saveJourneyAnswer(answer: JourneyAnswer): Promise<SaveJourneyAnswerResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const attemptResult = await client.query<AttemptRow>(
        `${attemptSelect()} WHERE j.id=$1 FOR UPDATE OF j`,
        [answer.journeyId],
      );
      const attemptRow = attemptResult.rows[0];
      if (attemptRow === undefined) {
        throw new ProductError("JOURNEY_NOT_FOUND", "Journey not found", false);
      }
      if (attemptRow.status === "completed") {
        throw new ProductError("JOURNEY_ALREADY_COMPLETED", "Journey is already completed", false);
      }
      const existing = await client.query<AnswerRow>(
        `SELECT * FROM journey_answers
          WHERE journey_id=$1 AND (client_answer_id=$2 OR question_id=$3)
          ORDER BY CASE WHEN client_answer_id=$2 THEN 0 ELSE 1 END LIMIT 1`,
        [answer.journeyId, answer.clientAnswerId, answer.questionId],
      );
      if (existing.rows[0] !== undefined) {
        await client.query("COMMIT");
        return { answer: mapAnswer(existing.rows[0]), created: false };
      }
      const inserted = await client.query<AnswerRow>(
        `INSERT INTO journey_answers (
           id,journey_id,stage_id,question_id,choice_id,response_text,elapsed_ms,
           client_answer_id,answer_order,answered_at,evidence_json,created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
           (SELECT count(*)+1 FROM journey_answers WHERE journey_id=$2),$9,$10,$9)
         RETURNING *`,
        [
          answer.id,
          answer.journeyId,
          answer.stageId,
          answer.questionId,
          answer.choiceId,
          answer.responseText,
          answer.elapsedMs,
          answer.clientAnswerId,
          answer.answeredAt,
          JSON.stringify(answer.evidence),
        ],
      );
      await client.query("UPDATE journeys SET updated_at=$2 WHERE id=$1", [
        answer.journeyId,
        answer.answeredAt,
      ]);
      await client.query("COMMIT");
      return { answer: mapAnswer(requiredRow(inserted.rows[0])), created: true };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) {
        const existing = await this.pool.query<AnswerRow>(
          `SELECT * FROM journey_answers
            WHERE journey_id=$1 AND (client_answer_id=$2 OR question_id=$3)
            LIMIT 1`,
          [answer.journeyId, answer.clientAnswerId, answer.questionId],
        );
        if (existing.rows[0] !== undefined) {
          return { answer: mapAnswer(existing.rows[0]), created: false };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async completeJourney(input: CompleteJourneyInput): Promise<CompleteJourneyResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const attemptResult = await client.query<AttemptRow>(
        `${attemptSelect()} WHERE j.id=$1 FOR UPDATE OF j`,
        [input.journeyId],
      );
      const attemptRow = attemptResult.rows[0];
      if (attemptRow === undefined) {
        throw new ProductError("JOURNEY_NOT_FOUND", "Journey not found", false);
      }
      if (attemptRow.status === "completed") {
        const completed = await this.completedResult(client, input.journeyId);
        await client.query("COMMIT");
        return completed;
      }
      const answerRows = await client.query<{ question_id: string } & QueryResultRow>(
        "SELECT question_id FROM journey_answers WHERE journey_id=$1",
        [input.journeyId],
      );
      const answered = new Set(answerRows.rows.map(({ question_id }) => question_id));
      if (
        answered.size !== input.expectedQuestionIds.length ||
        input.expectedQuestionIds.some((questionId) => !answered.has(questionId))
      ) {
        throw new ProductError("JOURNEY_INCOMPLETE", "Journey questions are incomplete", false);
      }
      await client.query(
        `INSERT INTO journey_evidence_snapshots (
           id,journey_id,journey_version,evidence_version,official,
           evidence_signature,items_json,created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.evidenceSnapshot.id,
          input.evidenceSnapshot.journeyId,
          input.evidenceSnapshot.journeyVersion,
          input.evidenceSnapshot.evidenceVersion,
          input.evidenceSnapshot.official,
          input.evidenceSnapshot.evidenceSignature,
          JSON.stringify(input.evidenceSnapshot.items),
          input.evidenceSnapshot.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO personal_manual_snapshots (
           id,journey_id,evidence_snapshot_id,status,evidence_signature,current_source,
           revision,retryable,created_at,updated_at
         ) VALUES ($1,$2,$3,'generating',$4,'agent_generated',1,false,$5,$5)`,
        [
          input.manualSnapshot.id,
          input.journeyId,
          input.evidenceSnapshot.id,
          input.evidenceSnapshot.evidenceSignature,
          input.manualSnapshot.createdAt,
        ],
      );
      await insertOutbox(client, input.event);
      await insertAudit(client, input.audit);
      await client.query(
        "UPDATE journeys SET status='completed',completed_at=$2,updated_at=$2 WHERE id=$1",
        [input.journeyId, input.evidenceSnapshot.createdAt],
      );
      await client.query("COMMIT");
      const attempt = mapAttempt({
        ...attemptRow,
        status: "completed",
        completed_at: input.evidenceSnapshot.createdAt,
        updated_at: input.evidenceSnapshot.createdAt,
      });
      return {
        attempt,
        evidenceSnapshot: input.evidenceSnapshot,
        manualSnapshot: input.manualSnapshot,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getJourneyEvidenceSnapshot(journeyId: string): Promise<JourneyEvidenceSnapshot | null> {
    const result = await this.pool.query<EvidenceRow>(
      "SELECT * FROM journey_evidence_snapshots WHERE journey_id=$1",
      [journeyId],
    );
    return result.rows[0] === undefined ? null : mapEvidence(result.rows[0]);
  }

  async getPersonalManual(journeyId: string): Promise<PersonalManualSnapshot | null> {
    const result = await this.pool.query<ManualRow>(
      "SELECT * FROM personal_manual_snapshots WHERE journey_id=$1",
      [journeyId],
    );
    return result.rows[0] === undefined ? null : mapManual(result.rows[0]);
  }

  async getPersonalManualGenerationRequest(journeyId: string, traceId: string) {
    const attempt = await this.getJourneyAttempt(journeyId);
    const evidence = await this.getJourneyEvidenceSnapshot(journeyId);
    const manual = await this.getPersonalManual(journeyId);
    if (attempt === null || evidence === null || manual === null) return null;
    return {
      requestId: manual.id,
      journeyId,
      journeyVersion: attempt.journeyVersion,
      evidenceSnapshotId: evidence.id,
      evidenceSignature: evidence.evidenceSignature,
      evidence: evidence.items,
      traceId,
    };
  }

  async markPersonalManualGenerating(journeyId: string): Promise<PersonalManualSnapshot | null> {
    const result = await this.pool.query<ManualRow>(
      `UPDATE personal_manual_snapshots SET
         status='generating',retryable=false,error_code=NULL,updated_at=now()
       WHERE journey_id=$1 AND status IN ('generating','failed') RETURNING *`,
      [journeyId],
    );
    return result.rows[0] === undefined
      ? this.getPersonalManual(journeyId)
      : mapManual(result.rows[0]);
  }

  async savePersonalManualCandidate(
    input: SaveManualCandidateInput,
  ): Promise<PersonalManualSnapshot> {
    const candidate = PersonalManualCandidateSchema.parse(input.candidate);
    const content = {
      variables: candidate.variables,
      sections: candidate.sections,
      updateSummary: candidate.updateSummary,
    };
    const result = await this.pool.query<ManualRow>(
      `UPDATE personal_manual_snapshots SET
         status='ready',original_content_json=$2,current_content_json=$2,
         current_source='agent_generated',retryable=false,error_code=NULL,
         agent_trace_id=$3,agent_version_id=$4,model_version=$5,
         generated_at=$6,updated_at=$6
       WHERE journey_id=$1 AND status IN ('generating','failed') RETURNING *`,
      [
        input.journeyId,
        JSON.stringify(content),
        candidate.traceId,
        candidate.agentVersionId,
        candidate.modelVersion,
        input.generatedAt,
      ],
    );
    if (result.rows[0] !== undefined) return mapManual(result.rows[0]);
    const existing = await this.getPersonalManual(input.journeyId);
    if (existing === null) {
      throw new ProductError("PERSONAL_MANUAL_NOT_FOUND", "Personal Manual not found", false);
    }
    return existing;
  }

  async failPersonalManual(input: FailManualInput): Promise<PersonalManualSnapshot> {
    const result = await this.pool.query<ManualRow>(
      `UPDATE personal_manual_snapshots SET
         status='failed',retryable=$2,error_code=$3,updated_at=now()
       WHERE journey_id=$1 AND status IN ('generating','failed') RETURNING *`,
      [input.journeyId, input.retryable, input.errorCode],
    );
    if (result.rows[0] !== undefined) return mapManual(result.rows[0]);
    const existing = await this.getPersonalManual(input.journeyId);
    if (existing === null) {
      throw new ProductError("PERSONAL_MANUAL_NOT_FOUND", "Personal Manual not found", false);
    }
    return existing;
  }

  async retryPersonalManual(input: RetryManualInput): Promise<PersonalManualSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<ManualRow>(
        "SELECT * FROM personal_manual_snapshots WHERE journey_id=$1 FOR UPDATE",
        [input.journeyId],
      );
      const row = current.rows[0];
      if (row === undefined) {
        throw new ProductError("PERSONAL_MANUAL_NOT_FOUND", "Personal Manual not found", false);
      }
      const existingEvent = await client.query(
        "SELECT 1 FROM event_outbox WHERE idempotency_key=$1",
        [input.event.idempotencyKey],
      );
      if (existingEvent.rows[0] !== undefined) {
        await client.query("COMMIT");
        return mapManual(row);
      }
      if (row.status === "generating") {
        await client.query("COMMIT");
        return mapManual(row);
      }
      if (row.status !== "failed" || !row.retryable) {
        throw new ProductError("RETRY_NOT_ALLOWED", "Personal Manual cannot be retried", false);
      }
      const updated = await client.query<ManualRow>(
        `UPDATE personal_manual_snapshots SET
           status='generating',retry_count=retry_count+1,retryable=false,
           error_code=NULL,updated_at=$2 WHERE journey_id=$1 RETURNING *`,
        [input.journeyId, input.event.occurredAt],
      );
      await insertOutbox(client, input.event);
      await insertAudit(client, input.audit);
      await client.query("COMMIT");
      return mapManual(requiredRow(updated.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async editPersonalManual(input: EditManualInput): Promise<PersonalManualSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<ManualRow>(
        "SELECT * FROM personal_manual_snapshots WHERE journey_id=$1 FOR UPDATE",
        [input.journeyId],
      );
      const row = current.rows[0];
      if (row === undefined) {
        throw new ProductError("PERSONAL_MANUAL_NOT_FOUND", "Personal Manual not found", false);
      }
      const existingEdit = await client.query<{ revision: number } & QueryResultRow>(
        `SELECT revision FROM personal_manual_edits
          WHERE manual_snapshot_id=$1 AND client_edit_id=$2`,
        [row.id, input.clientEditId],
      );
      if (existingEdit.rows[0] !== undefined) {
        await client.query("COMMIT");
        return mapManual(row);
      }
      if (row.status !== "ready") {
        throw new ProductError(
          "PERSONAL_MANUAL_NOT_READY",
          "Personal Manual is not editable",
          false,
        );
      }
      if (row.revision !== input.expectedRevision) {
        throw new ProductError(
          "PERSONAL_MANUAL_EDIT_CONFLICT",
          "Personal Manual revision changed",
          false,
        );
      }
      const nextRevision = row.revision + 1;
      const content = PersonalManualContentSchema.parse(input.content);
      await client.query(
        `INSERT INTO personal_manual_edits
           (id,manual_snapshot_id,client_edit_id,revision,source,content_json,created_at)
         VALUES ($1,$2,$3,$4,'user_edit',$5,$6)`,
        [
          randomUUID(),
          row.id,
          input.clientEditId,
          nextRevision,
          JSON.stringify(content),
          input.editedAt,
        ],
      );
      const updated = await client.query<ManualRow>(
        `UPDATE personal_manual_snapshots SET
           current_content_json=$2,current_source='user_edit',revision=$3,updated_at=$4
         WHERE id=$1 RETURNING *`,
        [row.id, JSON.stringify(content), nextRevision, input.editedAt],
      );
      await insertAudit(client, input.audit);
      await client.query("COMMIT");
      return mapManual(requiredRow(updated.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimJourneyOwnership(input: ClaimJourneyOwnershipInput): Promise<JourneyAttemptRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<AttemptRow>(
        `${attemptSelect()} WHERE j.id=$1 FOR UPDATE OF j`,
        [input.journeyId],
      );
      const row = current.rows[0];
      if (row === undefined)
        throw new ProductError("JOURNEY_NOT_FOUND", "Journey not found", false);
      if (row.user_id !== null) {
        if (row.user_id !== input.userId) {
          throw new ProductError("JOURNEY_FORBIDDEN", "Journey belongs to another user", false);
        }
        await client.query("COMMIT");
        return mapAttempt(row);
      }
      if (row.anonymous_token_hash !== input.anonymousTokenHash) {
        throw new ProductError("JOURNEY_FORBIDDEN", "Invalid Journey credential", false);
      }
      const existingOfficial = await client.query<{ id: string } & QueryResultRow>(
        `SELECT id FROM journeys
          WHERE user_id=$1 AND version=$2 AND official=true AND id<>$3
          ORDER BY created_at,id LIMIT 1 FOR UPDATE`,
        [input.userId, row.version, input.journeyId],
      );
      const priorOfficialId = existingOfficial.rows[0]?.id ?? null;
      const updated = await client.query<AttemptRow>(
        `WITH updated AS (
           UPDATE journeys SET
             user_id=$2,
             anonymous_token_hash=NULL,
             official=CASE WHEN $4::uuid IS NULL THEN official ELSE false END,
             replay_of_journey_id=COALESCE($4,replay_of_journey_id),
             updated_at=$3
           WHERE id=$1 RETURNING *
         )
         SELECT u.*,
           (SELECT count(*)::integer FROM journey_answers a WHERE a.journey_id=u.id) AS answer_count
         FROM updated u`,
        [input.journeyId, input.userId, input.claimedAt, priorOfficialId],
      );
      if (priorOfficialId !== null) {
        await client.query(
          "UPDATE journey_evidence_snapshots SET official=false WHERE journey_id=$1",
          [input.journeyId],
        );
      }
      await insertAudit(client, input.audit);
      await client.query("COMMIT");
      return mapAttempt(requiredRow(updated.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error) && error.constraint === "journeys_user_official_version_idx") {
        return this.claimJourneyOwnership(input);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async claimAgent(input: ClaimAgentInput): Promise<ClaimAgentResponse> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const journeyResult = await client.query<AttemptRow>(
        `${attemptSelect()} WHERE j.id=$1 FOR UPDATE OF j`,
        [input.journeyId],
      );
      const journey = journeyResult.rows[0];
      if (journey === undefined)
        throw new ProductError("JOURNEY_NOT_FOUND", "Journey not found", false);
      if (journey.user_id !== input.userId) {
        throw new ProductError("JOURNEY_FORBIDDEN", "Journey belongs to another user", false);
      }
      const manualResult = await client.query<ManualRow>(
        "SELECT * FROM personal_manual_snapshots WHERE journey_id=$1 FOR UPDATE",
        [input.journeyId],
      );
      const manualRow = manualResult.rows[0];
      if (manualRow === undefined) {
        throw new ProductError("PERSONAL_MANUAL_NOT_FOUND", "Personal Manual not found", false);
      }
      if (manualRow.status === "claimed") {
        const response = await this.claimedResponse(client, input.userId, manualRow);
        await client.query("COMMIT");
        return response;
      }
      if (manualRow.status !== "ready" || manualRow.current_content_json === null) {
        throw new ProductError("PERSONAL_MANUAL_NOT_READY", "Personal Manual is not ready", false);
      }
      const existingProfile = await client.query<
        { id: string; current_version_id: string | null } & QueryResultRow
      >("SELECT id,current_version_id FROM persona_profiles WHERE user_id=$1 FOR UPDATE", [
        input.userId,
      ]);
      const profile = existingProfile.rows[0];
      if (profile !== undefined && profile.current_version_id !== null) {
        throw new ProductError(
          "PERSONA_ALREADY_EXISTS",
          "User already has a formal Persona",
          false,
        );
      }
      const profileId = profile?.id ?? randomUUID();
      if (profile === undefined) {
        await client.query(
          "INSERT INTO persona_profiles (id,user_id,current_version_id,created_at,updated_at) VALUES ($1,$2,NULL,$3,$3)",
          [profileId, input.userId, input.claimedAt],
        );
      }
      const manualContent = PersonalManualContentSchema.parse(manualRow.current_content_json);
      const personaContent: PersonaContent = {
        identity: { personalManualSnapshotId: manualRow.id, personalManual: manualContent },
        values: [],
        socialStyle: {},
        communicationStyle: {},
        relationshipNeeds: [],
        boundaries: [],
        interests: [],
        currentGoals: [],
        confirmedPatterns: [],
        uncertainHypotheses: [],
      };
      const personaVersionId = randomUUID();
      await client.query(
        `INSERT INTO persona_versions (
           id,profile_id,version,content,change_summary,confirmed_by_user,
           source_manual_snapshot_id,created_at
         ) VALUES ($1,$2,1,$3,$4,true,$5,$6)`,
        [
          personaVersionId,
          profileId,
          JSON.stringify(personaContent),
          "Claimed from the current Personal Manual",
          manualRow.id,
          input.claimedAt,
        ],
      );
      await client.query(
        "UPDATE persona_profiles SET current_version_id=$2,updated_at=$3 WHERE id=$1",
        [profileId, personaVersionId, input.claimedAt],
      );
      const agentResult = await client.query<
        {
          id: string;
          user_id: string;
          name: "Reso Agent";
          status: "active" | "paused" | "retired";
          created_at: Date | string;
        } & QueryResultRow
      >(
        `INSERT INTO agents (id,user_id,name,status,created_at,updated_at)
         VALUES ($1,$2,'Reso Agent','active',$3,$3)
         ON CONFLICT (user_id) DO UPDATE SET updated_at=agents.updated_at
         RETURNING id,user_id,name,status,created_at`,
        [randomUUID(), input.userId, input.claimedAt],
      );
      const agent = requiredRow(agentResult.rows[0]);
      const updatedManual = await client.query<ManualRow>(
        `UPDATE personal_manual_snapshots SET
           status='claimed',persona_version_id=$2,agent_id=$3,claimed_at=$4,updated_at=$4
         WHERE id=$1 RETURNING *`,
        [manualRow.id, personaVersionId, agent.id, input.claimedAt],
      );
      await client.query(
        `INSERT INTO event_outbox (
           id,event_type,event_version,aggregate_type,aggregate_id,correlation_id,
           causation_id,idempotency_key,payload,occurred_at
         ) VALUES ($1,'persona.created',1,'persona',$2,$3,NULL,$4,$5,$6)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          randomUUID(),
          personaVersionId,
          input.audit.traceId,
          `persona.created:${manualRow.id}`,
          JSON.stringify({
            userId: input.userId,
            profileId,
            personaVersionId,
            agentId: agent.id,
            personalManualSnapshotId: manualRow.id,
          }),
          input.claimedAt,
        ],
      );
      await insertAudit(client, input.audit);
      const response = ClaimAgentResponseSchema.parse({
        personalManual: mapManual(requiredRow(updatedManual.rows[0])),
        personaVersion: PersonaVersionSchema.parse({
          id: personaVersionId,
          profileId,
          version: 1,
          content: personaContent,
          changeSummary: "Claimed from the current Personal Manual",
          confirmedByUser: true,
          createdAt: input.claimedAt,
        }),
        agent: {
          id: agent.id,
          userId: agent.user_id,
          name: agent.name,
          status: agent.status,
          createdAt: requiredIso(agent.created_at),
        },
        nextPath: "/agent",
      });
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async completedResult(
    database: PoolClient,
    journeyId: string,
  ): Promise<CompleteJourneyResult> {
    const attemptResult = await database.query<AttemptRow>(`${attemptSelect()} WHERE j.id=$1`, [
      journeyId,
    ]);
    const evidenceResult = await database.query<EvidenceRow>(
      "SELECT * FROM journey_evidence_snapshots WHERE journey_id=$1",
      [journeyId],
    );
    const manualResult = await database.query<ManualRow>(
      "SELECT * FROM personal_manual_snapshots WHERE journey_id=$1",
      [journeyId],
    );
    return {
      attempt: mapAttempt(requiredRow(attemptResult.rows[0])),
      evidenceSnapshot: mapEvidence(requiredRow(evidenceResult.rows[0])),
      manualSnapshot: mapManual(requiredRow(manualResult.rows[0])),
    };
  }

  private async claimedResponse(
    database: PoolClient,
    userId: string,
    manualRow: ManualRow,
  ): Promise<ClaimAgentResponse> {
    if (manualRow.persona_version_id === null || manualRow.agent_id === null) {
      throw new Error("Claimed Personal Manual is missing formal links");
    }
    const personaResult = await database.query<
      {
        id: string;
        profile_id: string;
        version: number;
        content: unknown;
        change_summary: string;
        confirmed_by_user: boolean;
        created_at: Date | string;
      } & QueryResultRow
    >("SELECT * FROM persona_versions WHERE id=$1", [manualRow.persona_version_id]);
    const agentResult = await database.query<
      {
        id: string;
        user_id: string;
        name: string;
        status: string;
        created_at: Date | string;
      } & QueryResultRow
    >("SELECT id,user_id,name,status,created_at FROM agents WHERE id=$1", [manualRow.agent_id]);
    const persona = requiredRow(personaResult.rows[0]);
    const agent = requiredRow(agentResult.rows[0]);
    return ClaimAgentResponseSchema.parse({
      personalManual: mapManual(manualRow),
      personaVersion: {
        id: persona.id,
        profileId: persona.profile_id,
        version: persona.version,
        content: persona.content,
        changeSummary: persona.change_summary,
        confirmedByUser: persona.confirmed_by_user,
        createdAt: requiredIso(persona.created_at),
      },
      agent: {
        id: agent.id,
        userId,
        name: agent.name,
        status: agent.status,
        createdAt: requiredIso(agent.created_at),
      },
      nextPath: "/agent",
    });
  }
}

function attemptSelect(): string {
  return `SELECT j.*,
    (SELECT count(*)::integer FROM journey_answers a WHERE a.journey_id=j.id) AS answer_count
    FROM journeys j`;
}

function attemptValues(attempt: JourneyAttemptRecord): unknown[] {
  return [
    attempt.id,
    attempt.userId,
    attempt.journeyVersion,
    attempt.status,
    attempt.clientAttemptId,
    attempt.anonymousTokenHash,
    attempt.replayOfJourneyId,
    attempt.official,
    attempt.startedAt,
    attempt.completedAt,
    attempt.createdAt,
    attempt.updatedAt,
  ];
}

function mapAttempt(row: AttemptRow): JourneyAttemptRecord {
  return {
    id: row.id,
    userId: row.user_id,
    journeyVersion:
      row.version === "mountain-v1" ? row.version : invalidJourneyVersion(row.version),
    status: row.status,
    clientAttemptId: row.client_attempt_id,
    anonymousTokenHash: row.anonymous_token_hash,
    replayOfJourneyId: row.replay_of_journey_id,
    official: row.official,
    answerCount: Number(row.answer_count),
    requiredAnswerCount: 7,
    startedAt: requiredIso(row.started_at),
    completedAt: optionalIso(row.completed_at),
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at),
  };
}

function mapAnswer(row: AnswerRow): JourneyAnswer {
  return JourneyAnswerSchema.parse({
    id: row.id,
    journeyId: row.journey_id,
    stageId: row.stage_id,
    questionId: row.question_id,
    choiceId: row.choice_id,
    responseText: row.response_text,
    elapsedMs: row.elapsed_ms,
    clientAnswerId: row.client_answer_id,
    answerOrder: row.answer_order,
    answeredAt: requiredIso(row.answered_at),
    evidence: row.evidence_json,
  });
}

function mapEvidence(row: EvidenceRow): JourneyEvidenceSnapshot {
  return JourneyEvidenceSnapshotSchema.parse({
    id: row.id,
    journeyId: row.journey_id,
    journeyVersion: row.journey_version,
    evidenceVersion: row.evidence_version,
    official: row.official,
    evidenceSignature: row.evidence_signature,
    items: row.items_json,
    createdAt: requiredIso(row.created_at),
  });
}

function mapManual(row: ManualRow): PersonalManualSnapshot {
  return PersonalManualSnapshotSchema.parse({
    id: row.id,
    journeyId: row.journey_id,
    status: row.status,
    evidenceSignature: row.evidence_signature,
    originalContent: row.original_content_json,
    currentContent: row.current_content_json,
    revision: row.revision,
    currentSource: row.current_source,
    retryable: row.retryable,
    errorCode: row.error_code,
    agentTraceId: row.agent_trace_id,
    agentVersionId: row.agent_version_id,
    modelVersion: row.model_version,
    personaVersionId: row.persona_version_id,
    agentId: row.agent_id,
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at),
    generatedAt: optionalIso(row.generated_at),
    claimedAt: optionalIso(row.claimed_at),
  });
}

async function insertOutbox(
  database: PoolClient,
  event: CompleteJourneyInput["event"],
): Promise<void> {
  await database.query(
    `INSERT INTO event_outbox (
       id,event_type,event_version,aggregate_type,aggregate_id,correlation_id,
       causation_id,idempotency_key,payload,occurred_at
     ) VALUES ($1,$2,1,'journey',$3,$4,NULL,$5,$6,$7)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      event.id,
      event.eventType,
      event.subjectId,
      event.traceId,
      event.idempotencyKey,
      JSON.stringify(event.payload),
      event.occurredAt,
    ],
  );
}

async function insertAudit(
  database: PoolClient,
  audit: CompleteJourneyInput["audit"],
): Promise<void> {
  await database.query(
    `INSERT INTO product_audit_log
       (id,actor_user_id,action,subject_id,trace_id,outcome,metadata,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      audit.id,
      audit.actorUserId,
      audit.action,
      audit.subjectId,
      audit.traceId,
      audit.outcome,
      JSON.stringify(audit.metadata),
      audit.createdAt,
    ],
  );
}

function invalidJourneyVersion(version: string): never {
  throw new Error(`Unsupported Journey version in database: ${version}`);
}

function requiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value: Date | string | null): string | null {
  return value === null ? null : requiredIso(value);
}

function requiredRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error("Expected PostgreSQL to return a row");
  return row;
}

function isUniqueViolation(error: unknown): error is { code: "23505"; constraint?: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
