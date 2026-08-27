import { randomUUID } from "node:crypto";
import type {
  MemoryCandidate,
  MemoryCandidateRecord,
  MemoryContext,
  PersonaPatchRecord,
  PersonaVersion,
  PrimaryAgent,
  ProductConversation,
  ProductConversationDetail,
  ProductIdentity,
  ProductMessage,
  ProductUser,
} from "@reso/contracts";
import type {
  AgentContextRecord,
  CandidateDecision,
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

export class InMemoryVerticalSliceRepository implements VerticalSliceRepository {
  private readonly codes = new Map<string, EmailCodeRecord[]>();
  private readonly users = new Map<string, ProductUser>();
  private readonly userByEmail = new Map<string, string>();
  private readonly guests = new Map<string, GuestRecord>();
  private readonly guestByToken = new Map<string, string>();
  private readonly agents = new Map<string, PrimaryAgent>();
  private readonly agentByUser = new Map<string, string>();
  private readonly personas = new Map<string, PersonaVersion>();
  private readonly personaByUser = new Map<string, string>();
  private readonly conversations = new Map<string, ProductConversation>();
  private readonly messages = new Map<string, ProductMessage>();
  private readonly messageClientIds = new Map<string, string>();
  private readonly candidateRows: MemoryCandidateRecord[] = [];
  private readonly acceptedMemories = new Map<string, MemoryContext>();
  private readonly embeddings = new Map<string, number[]>();
  private readonly patchRows: PersonaPatchRecord[] = [];
  private readonly watermarks = new Map<string, string>();
  /** Test/inspection surface for emitted outbox events. */
  readonly outboxEvents: OutboxAppend[] = [];

  async findLatestEmailCode(email: string): Promise<EmailCodeRecord | null> {
    return this.clone(this.codes.get(email)?.at(-1));
  }
  async saveEmailCode(record: EmailCodeRecord): Promise<void> {
    this.codes.set(record.email, [
      ...(this.codes.get(record.email) ?? []),
      structuredClone(record),
    ]);
  }
  async updateEmailCode(record: EmailCodeRecord): Promise<void> {
    const list = this.codes.get(record.email) ?? [];
    this.codes.set(
      record.email,
      list.map((item) => (item.id === record.id ? structuredClone(record) : item)),
    );
  }
  async incrementEmailCodeAttempt(id: string, email: string): Promise<number> {
    const list = this.codes.get(email) ?? [];
    let attempts = 0;
    this.codes.set(
      email,
      list.map((item) => {
        if (item.id !== id || item.consumedAt !== null) return item;
        attempts = item.attempts + 1;
        return { ...item, attempts };
      }),
    );
    return attempts;
  }
  async consumeEmailCode(id: string, email: string, consumedAt: string): Promise<boolean> {
    const list = this.codes.get(email) ?? [];
    let consumed = false;
    this.codes.set(
      email,
      list.map((item) => {
        if (item.id !== id || item.consumedAt !== null || item.attempts >= item.maxAttempts)
          return item;
        consumed = true;
        return { ...item, consumedAt };
      }),
    );
    return consumed;
  }
  async findOrCreateUser(
    email: string,
    now: string,
  ): Promise<{ user: ProductUser; created: boolean }> {
    const existingId = this.userByEmail.get(email);
    if (existingId !== undefined)
      return { user: structuredClone(this.users.get(existingId)!), created: false };
    const user: ProductUser = { id: randomUUID(), email, displayName: null, createdAt: now };
    this.users.set(user.id, user);
    this.userByEmail.set(email, user.id);
    return { user: structuredClone(user), created: true };
  }
  async getIdentity(userId: string): Promise<ProductIdentity | null> {
    const user = this.users.get(userId);
    if (user === undefined) return null;
    const agentId = this.agentByUser.get(userId);
    const personaId = this.personaByUser.get(userId);
    return {
      user: structuredClone(user),
      agent: agentId === undefined ? null : structuredClone(this.agents.get(agentId)!),
      persona: personaId === undefined ? null : structuredClone(this.personas.get(personaId)!),
    };
  }
  async createGuest(record: GuestRecord): Promise<void> {
    this.guests.set(record.id, structuredClone(record));
    this.guestByToken.set(record.tokenHash, record.id);
  }
  async getGuestByTokenHash(tokenHash: string): Promise<GuestRecord | null> {
    const id = this.guestByToken.get(tokenHash);
    return id === undefined ? null : this.clone(this.guests.get(id));
  }
  async saveGuest(record: GuestRecord): Promise<void> {
    this.guests.set(record.id, structuredClone(record));
  }
  async attachGuestToUser(guestId: string, userId: string, now: string): Promise<void> {
    const guest = this.guests.get(guestId);
    if (guest !== undefined) this.guests.set(guestId, { ...guest, userId, updatedAt: now });
  }
  async claimGuest(
    guestId: string,
    userId: string,
    agentName: string,
    now: string,
  ): Promise<ProductIdentity> {
    const existing = await this.getIdentity(userId);
    if (existing === null) throw new Error("User does not exist");
    if (existing.agent !== null && existing.persona !== null) return existing;
    const guest = this.guests.get(guestId);
    if (guest?.personaDraft == null) throw new Error("Persona draft missing");
    const persona: PersonaVersion = {
      id: randomUUID(),
      profileId: randomUUID(),
      version: 1,
      content: structuredClone(guest.personaDraft),
      changeSummary: "Quick Start draft confirmed by user",
      confirmedByUser: true,
      createdAt: now,
    };
    const agent: PrimaryAgent = {
      id: randomUUID(),
      ownerUserId: userId,
      name: agentName,
      status: "active",
      createdAt: now,
    };
    this.personas.set(persona.id, persona);
    this.personaByUser.set(userId, persona.id);
    this.agents.set(agent.id, agent);
    this.agentByUser.set(userId, agent.id);
    this.guests.set(guestId, { ...guest, userId, status: "claimed", updatedAt: now });
    return {
      user: existing.user,
      agent: structuredClone(agent),
      persona: structuredClone(persona),
    };
  }
  async createConversation(
    userId: string,
    agentId: string,
    now: string,
  ): Promise<ProductConversation> {
    const value = { id: randomUUID(), userId, agentId, createdAt: now, updatedAt: now };
    this.conversations.set(value.id, value);
    return structuredClone(value);
  }
  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ProductConversationDetail | null> {
    const conversation = this.conversations.get(conversationId);
    if (conversation === undefined || conversation.userId !== userId) return null;
    return {
      conversation: structuredClone(conversation),
      messages: [...this.messages.values()]
        .filter((item) => item.conversationId === conversationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((item) => structuredClone(item)),
    };
  }
  async listConversations(userId: string): Promise<ProductConversation[]> {
    return [...this.conversations.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((item) => structuredClone(item));
  }
  async findMessageByClientId(
    userId: string,
    clientMessageId: string,
  ): Promise<ProductMessage | null> {
    const id = this.messageClientIds.get(`${userId}:${clientMessageId}`);
    return id === undefined ? null : this.clone(this.messages.get(id));
  }
  async saveMessage(message: ProductMessage, clientMessageId?: string): Promise<ProductMessage> {
    const conversation = this.conversations.get(message.conversationId);
    if (clientMessageId !== undefined && conversation !== undefined)
      this.messageClientIds.set(`${conversation.userId}:${clientMessageId}`, message.id);
    this.messages.set(message.id, structuredClone(message));
    if (conversation !== undefined)
      this.conversations.set(conversation.id, { ...conversation, updatedAt: message.createdAt });
    return structuredClone(message);
  }
  async getAgentContext(
    userId: string,
    conversationId: string,
  ): Promise<AgentContextRecord | null> {
    const detail = await this.getConversation(userId, conversationId);
    const identity = await this.getIdentity(userId);
    if (
      detail === null ||
      identity === null ||
      identity.agent === null ||
      identity.persona === null
    )
      return null;
    return {
      identity,
      conversation: detail.conversation,
      persona: identity.persona,
      memories: [...this.acceptedMemories.values()].filter(
        (memory) => memory.userId === identity.user.id && memory.enabled,
      ),
      recentMessages: detail.messages
        .slice(-12)
        .map(({ id, role, content }) => ({ id, role, content })),
    };
  }
  async saveMemoryCandidates(
    userId: string,
    sourceMessageId: string,
    candidates: MemoryCandidate[],
    now: string,
  ): Promise<void> {
    candidates.forEach((candidate) => {
      this.candidateRows.push({
        id: randomUUID(),
        userId,
        sourceMessageId,
        type: candidate.type,
        summary: candidate.summary,
        evidenceMessageIds: [...candidate.evidenceMessageIds],
        confidence: candidate.confidence,
        requiresReview: candidate.requiresReview,
        status: "pending",
        createdAt: now,
      });
    });
  }
  async appendOutboxEvent(event: OutboxAppend): Promise<void> {
    this.outboxEvents.push(structuredClone(event));
  }
  async countUserMessagesAfter(conversationId: string, afterIso: string): Promise<number> {
    return [...this.messages.values()].filter(
      (message) =>
        message.conversationId === conversationId &&
        message.role === "user" &&
        message.createdAt > afterIso,
    ).length;
  }
  async getReflectionWindow(
    conversationId: string,
    limit: number,
  ): Promise<{ transcript: TranscriptRow[]; newestAt: string } | null> {
    const rows = [...this.messages.values()]
      .filter((message) => message.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-limit)
      .map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt }));
    const newest = rows.at(-1);
    if (newest === undefined) return null;
    return { transcript: rows, newestAt: newest.createdAt };
  }
  async getReflectionPersona(userId: string): Promise<ReflectionPersona | null> {
    const personaId = this.personaByUser.get(userId);
    if (personaId === undefined) return null;
    const persona = this.personas.get(personaId);
    if (persona === undefined) return null;
    return { versionId: persona.id, version: persona.version, content: persona.content };
  }
  async saveReflectionResults(input: {
    userId: string;
    memories: ReflectionCandidateInput[];
    patches: ReflectionPatchInput[];
    now: string;
  }): Promise<void> {
    for (const memory of input.memories)
      this.candidateRows.push({
        id: randomUUID(),
        userId: input.userId,
        sourceMessageId: memory.sourceMessageId,
        type: memory.type,
        summary: memory.summary,
        evidenceMessageIds: [...memory.evidenceMessageIds],
        confidence: memory.confidence,
        requiresReview: true,
        status: "pending",
        createdAt: input.now,
      });
    const latestPersona = await this.getReflectionPersona(input.userId);
    for (const patch of input.patches) {
      if (latestPersona === null || patch.fromVersionId !== latestPersona.versionId) continue;
      this.patchRows.push({
        id: randomUUID(),
        userId: input.userId,
        fromVersionId: patch.fromVersionId,
        path: patch.path,
        oldValue: patch.oldValue ?? null,
        proposedValue: patch.proposedValue ?? null,
        reason: patch.reason,
        evidenceMessageIds: [...patch.evidenceMessageIds],
        confidence: patch.confidence,
        status: "pending",
        createdAt: input.now,
        confirmedAt: null,
      });
    }
  }
  async reflectionWatermarkAfter(conversationId: string): Promise<string> {
    return this.watermarks.get(conversationId) ?? "1970-01-01T00:00:00Z";
  }
  async advanceReflectionRun(input: {
    userId: string;
    conversationId: string;
    lastReflectedAt: string;
    now: string;
  }): Promise<void> {
    const current = await this.reflectionWatermarkAfter(input.conversationId);
    this.watermarks.set(
      input.conversationId,
      current > input.lastReflectedAt ? current : input.lastReflectedAt,
    );
  }
  async listPendingMemoryCandidates(userId: string): Promise<MemoryCandidateRecord[]> {
    return structuredClone(
      this.candidateRows.filter((row) => row.userId === userId && row.status === "pending"),
    );
  }
  async decideMemoryCandidate(
    id: string,
    userId: string,
    decision: CandidateDecision,
    _now: string,
  ): Promise<DecideResult> {
    const row = this.candidateRows.find((item) => item.id === id && item.userId === userId);
    if (row === undefined) return { outcome: "missing" };
    if (row.status !== "pending") return { outcome: "not-pending" };
    if (decision === "reject") {
      row.status = "rejected";
      return { outcome: "rejected" };
    }
    row.status = "accepted";
    const memoryId = randomUUID();
    this.acceptedMemories.set(memoryId, {
      id: memoryId,
      userId,
      type: row.type,
      summary: row.summary,
      sourceEventId: null,
      occurredAt: row.createdAt,
      createdAt: _now,
      importance: row.confidence,
      relationshipRelevance: 0,
      topics: [],
      enabled: true,
      conflictsWith: [],
    });
    return { outcome: "promoted", memoryId, summary: row.summary };
  }
  async listMemoriesWithoutEmbedding(
    userId: string,
    limit: number,
  ): Promise<Array<{ id: string; summary: string }>> {
    return [...this.acceptedMemories.values()]
      .filter(
        (memory) => memory.userId === userId && memory.enabled && !this.embeddings.has(memory.id),
      )
      .slice(0, limit)
      .map(({ id, summary }) => ({ id, summary }));
  }
  async storeMemoryEmbedding(memoryId: string, embedding: number[]): Promise<void> {
    this.embeddings.set(memoryId, structuredClone(embedding));
  }
  async listPendingPersonaPatches(userId: string): Promise<PersonaPatchRecord[]> {
    return structuredClone(
      this.patchRows.filter((row) => row.userId === userId && row.status === "pending"),
    );
  }
  async decidePersonaPatch(
    id: string,
    userId: string,
    decision: CandidateDecision,
    now: string,
  ): Promise<DecideResult> {
    const row = this.patchRows.find((item) => item.id === id && item.userId === userId);
    if (row === undefined) return { outcome: "missing" };
    if (row.status !== "pending") return { outcome: "not-pending" };
    if (decision === "reject") {
      row.status = "rejected";
      return { outcome: "rejected" };
    }
    row.status = "accepted";
    row.confirmedAt = now;
    return { outcome: "promoted" };
  }
  async savePublicEvents(messageId: string, events: ProductMessage["publicEvents"]): Promise<void> {
    const message = this.messages.get(messageId);
    if (message !== undefined)
      this.messages.set(messageId, { ...message, publicEvents: structuredClone(events) });
  }
  private clone<T>(value: T | undefined): T | null {
    return value === undefined ? null : structuredClone(value);
  }
}
