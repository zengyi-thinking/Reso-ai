import type { ConnectionMutation, ProductRepository } from "./repository.js";
import type {
  AgentInteractionRecord,
  AssistRequestRecord,
  ConnectionRecord,
  HumanMessageRecord,
  OutboxEventRecord,
  TeaPartyMissionRecord,
  AuditLogRecord,
} from "./entities.js";

export class InMemoryProductRepository implements ProductRepository {
  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly messages = new Map<string, HumanMessageRecord>();
  private readonly messagesByClientId = new Map<string, HumanMessageRecord>();
  private readonly assists = new Map<string, AssistRequestRecord>();
  private readonly assistsByIdempotency = new Map<string, AssistRequestRecord>();
  private readonly missions = new Map<string, TeaPartyMissionRecord>();
  private readonly missionByConnection = new Map<string, TeaPartyMissionRecord>();
  private readonly teaPartyRunLocks = new Set<string>();
  private readonly interactions = new Map<string, AgentInteractionRecord>();
  private readonly outbox = new Map<string, OutboxEventRecord>();
  private readonly auditLog: AuditLogRecord[] = [];
  private readonly sessions = new Map<
    string,
    { userId: string; expiresAt: string; revoked: boolean }
  >();

  constructor(seed: { connections?: ConnectionRecord[]; messages?: HumanMessageRecord[] } = {}) {
    for (const connection of seed.connections ?? [])
      this.connections.set(connection.id, structuredClone(connection));
    for (const message of seed.messages ?? []) {
      this.messages.set(message.id, structuredClone(message));
      this.messagesByClientId.set(
        `${message.senderUserId}:${message.clientMessageId}`,
        structuredClone(message),
      );
    }
  }

  async getConnection(id: string): Promise<ConnectionRecord | null> {
    return this.clone(this.connections.get(id));
  }
  async saveConnection(connection: ConnectionRecord): Promise<void> {
    this.connections.set(connection.id, structuredClone(connection));
  }
  async mutateConnectionWithOutboxEvent(
    connectionId: string,
    mutate: (current: ConnectionRecord) => ConnectionMutation,
  ): Promise<ConnectionRecord | null> {
    const current = this.connections.get(connectionId);
    if (current === undefined) return null;
    const mutation = mutate(structuredClone(current));
    this.connections.set(connectionId, structuredClone(mutation.connection));
    if (mutation.event !== null && !this.outbox.has(mutation.event.idempotencyKey)) {
      this.outbox.set(mutation.event.idempotencyKey, structuredClone(mutation.event));
    }
    return structuredClone(mutation.connection);
  }
  async getHumanMessage(id: string): Promise<HumanMessageRecord | null> {
    return this.clone(this.messages.get(id));
  }
  async saveHumanMessage(message: HumanMessageRecord): Promise<HumanMessageRecord> {
    const key = `${message.senderUserId}:${message.clientMessageId}`;
    const existing = this.messagesByClientId.get(key);
    if (existing !== undefined) return structuredClone(existing);
    this.messages.set(message.id, structuredClone(message));
    this.messagesByClientId.set(key, structuredClone(message));
    return structuredClone(message);
  }
  async countHumanMessages(connectionId: string): Promise<number> {
    return [...this.messages.values()].filter((message) => message.connectionId === connectionId)
      .length;
  }
  async findAssistRequest(
    requesterUserId: string,
    clientRequestId: string,
  ): Promise<AssistRequestRecord | null> {
    return this.clone(this.assistsByIdempotency.get(`${requesterUserId}:${clientRequestId}`));
  }
  async saveAssistRequest(request: AssistRequestRecord): Promise<AssistRequestRecord> {
    const key = `${request.requesterUserId}:${request.clientRequestId}`;
    const existing = this.assistsByIdempotency.get(key);
    if (existing !== undefined && existing.id !== request.id) return structuredClone(existing);
    this.assists.set(request.id, structuredClone(request));
    this.assistsByIdempotency.set(key, structuredClone(request));
    return structuredClone(request);
  }
  async saveAssistRequestWithEventAndAudit(
    request: AssistRequestRecord,
    event: OutboxEventRecord,
    audit: AuditLogRecord,
  ): Promise<AssistRequestRecord> {
    const saved = await this.saveAssistRequest(request);
    await this.saveOutboxEvent(event);
    await this.saveAuditLog(audit);
    return saved;
  }
  async getAssistRequest(id: string): Promise<AssistRequestRecord | null> {
    return this.clone(this.assists.get(id));
  }
  async createTeaPartyMission(mission: TeaPartyMissionRecord): Promise<TeaPartyMissionRecord> {
    const existing = this.missionByConnection.get(mission.connectionId);
    if (existing !== undefined) return structuredClone(existing);
    this.missions.set(mission.id, structuredClone(mission));
    this.missionByConnection.set(mission.connectionId, structuredClone(mission));
    return structuredClone(mission);
  }
  async getTeaPartyMissionByConnection(
    connectionId: string,
  ): Promise<TeaPartyMissionRecord | null> {
    return this.clone(this.missionByConnection.get(connectionId));
  }
  async acquireTeaPartyRunLock(connectionId: string): Promise<(() => Promise<void>) | null> {
    if (this.teaPartyRunLocks.has(connectionId)) return null;
    this.teaPartyRunLocks.add(connectionId);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      this.teaPartyRunLocks.delete(connectionId);
    };
  }
  async saveTeaPartyMission(mission: TeaPartyMissionRecord): Promise<TeaPartyMissionRecord> {
    this.missions.set(mission.id, structuredClone(mission));
    this.missionByConnection.set(mission.connectionId, structuredClone(mission));
    return structuredClone(mission);
  }
  async saveTeaPartyMissionWithEventAndAudit(
    mission: TeaPartyMissionRecord,
    event: OutboxEventRecord,
    audit: AuditLogRecord,
  ): Promise<TeaPartyMissionRecord> {
    const saved = await this.saveTeaPartyMission(mission);
    await this.saveOutboxEvent(event);
    await this.saveAuditLog(audit);
    return saved;
  }
  async saveInteraction(interaction: AgentInteractionRecord): Promise<AgentInteractionRecord> {
    const key = `${interaction.missionId}:${interaction.turnNo}`;
    const existing = this.interactions.get(key);
    if (existing !== undefined) return structuredClone(existing);
    this.interactions.set(key, structuredClone(interaction));
    return structuredClone(interaction);
  }
  async listInteractions(missionId: string): Promise<AgentInteractionRecord[]> {
    return [...this.interactions.values()]
      .filter((interaction) => interaction.missionId === missionId)
      .sort((left, right) => left.turnNo - right.turnNo)
      .map((interaction) => structuredClone(interaction));
  }
  async saveOutboxEvent(event: OutboxEventRecord): Promise<OutboxEventRecord> {
    const existing = this.outbox.get(event.idempotencyKey);
    if (existing !== undefined) return structuredClone(existing);
    this.outbox.set(event.idempotencyKey, structuredClone(event));
    return structuredClone(event);
  }
  async listOutboxEvents(): Promise<OutboxEventRecord[]> {
    return [...this.outbox.values()].map((event) => structuredClone(event));
  }
  async claimOutboxEvents(
    _workerId: string,
    eventTypes: string[],
    limit: number,
  ): Promise<OutboxEventRecord[]> {
    return [...this.outbox.values()]
      .filter((event) => eventTypes.includes(event.eventType))
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }
  async completeOutboxEvent(
    eventId: string,
    _workerId: string,
    _expectedAttempt: number,
  ): Promise<void> {
    for (const [key, event] of this.outbox) {
      if (event.id === eventId) this.outbox.delete(key);
    }
  }
  async retryOutboxEvent(
    eventId: string,
    _workerId: string,
    _expectedAttempt: number,
    _errorCode: string,
    _availableAt: string,
  ): Promise<void> {
    for (const [key, event] of this.outbox) {
      if (event.id === eventId)
        this.outbox.set(key, { ...event, attempts: (event.attempts ?? 0) + 1 });
    }
  }
  async deadLetterOutboxEvent(
    eventId: string,
    _workerId: string,
    _expectedAttempt: number,
    _errorCode: string,
  ): Promise<void> {
    for (const [key, event] of this.outbox) {
      if (event.id === eventId) this.outbox.set(key, { ...event, attempts: 5 });
    }
  }
  async resolveSession(_tokenHash: string): Promise<string | null> {
    const session = this.sessions.get(_tokenHash);
    return session !== undefined && !session.revoked && new Date(session.expiresAt) > new Date()
      ? session.userId
      : null;
  }
  async createSession(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    this.sessions.set(tokenHash, { userId, expiresAt, revoked: false });
  }
  async revokeSession(tokenHash: string): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session !== undefined) this.sessions.set(tokenHash, { ...session, revoked: true });
  }
  async saveAuditLog(record: AuditLogRecord): Promise<void> {
    this.auditLog.push(structuredClone(record));
  }

  private clone<T>(value: T | undefined): T | null {
    return value === undefined ? null : structuredClone(value);
  }
}
