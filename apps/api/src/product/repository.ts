import type {
  AgentInteractionRecord,
  AssistRequestRecord,
  ConnectionRecord,
  HumanMessageRecord,
  OutboxEventRecord,
  TeaPartyMissionRecord,
  AuditLogRecord,
} from "./entities.js";

export interface ConnectionMutation {
  connection: ConnectionRecord;
  event: OutboxEventRecord | null;
}

export interface ProductRepository {
  getConnection(id: string): Promise<ConnectionRecord | null>;
  saveConnection(connection: ConnectionRecord): Promise<void>;
  mutateConnectionWithOutboxEvent(
    connectionId: string,
    mutate: (current: ConnectionRecord) => ConnectionMutation,
  ): Promise<ConnectionRecord | null>;
  getHumanMessage(id: string): Promise<HumanMessageRecord | null>;
  saveHumanMessage(message: HumanMessageRecord): Promise<HumanMessageRecord>;
  countHumanMessages(connectionId: string): Promise<number>;
  findAssistRequest(
    requesterUserId: string,
    clientRequestId: string,
  ): Promise<AssistRequestRecord | null>;
  saveAssistRequest(request: AssistRequestRecord): Promise<AssistRequestRecord>;
  saveAssistRequestWithEventAndAudit(
    request: AssistRequestRecord,
    event: OutboxEventRecord,
    audit: AuditLogRecord,
  ): Promise<AssistRequestRecord>;
  getAssistRequest(id: string): Promise<AssistRequestRecord | null>;
  createTeaPartyMission(mission: TeaPartyMissionRecord): Promise<TeaPartyMissionRecord>;
  getTeaPartyMissionByConnection(connectionId: string): Promise<TeaPartyMissionRecord | null>;
  acquireTeaPartyRunLock(connectionId: string): Promise<(() => Promise<void>) | null>;
  saveTeaPartyMission(mission: TeaPartyMissionRecord): Promise<TeaPartyMissionRecord>;
  saveTeaPartyMissionWithEventAndAudit(
    mission: TeaPartyMissionRecord,
    event: OutboxEventRecord,
    audit: AuditLogRecord,
  ): Promise<TeaPartyMissionRecord>;
  saveInteraction(interaction: AgentInteractionRecord): Promise<AgentInteractionRecord>;
  listInteractions(missionId: string): Promise<AgentInteractionRecord[]>;
  saveOutboxEvent(event: OutboxEventRecord): Promise<OutboxEventRecord>;
  listOutboxEvents(): Promise<OutboxEventRecord[]>;
  claimOutboxEvents(
    workerId: string,
    eventTypes: string[],
    limit: number,
  ): Promise<OutboxEventRecord[]>;
  completeOutboxEvent(eventId: string, workerId: string, expectedAttempt: number): Promise<void>;
  retryOutboxEvent(
    eventId: string,
    workerId: string,
    expectedAttempt: number,
    errorCode: string,
    availableAt: string,
  ): Promise<void>;
  deadLetterOutboxEvent(
    eventId: string,
    workerId: string,
    expectedAttempt: number,
    errorCode: string,
  ): Promise<void>;
  resolveSession(tokenHash: string): Promise<string | null>;
  createSession(userId: string, tokenHash: string, expiresAt: string): Promise<void>;
  revokeSession(tokenHash: string): Promise<void>;
  saveAuditLog(record: AuditLogRecord): Promise<void>;
}
