import type {
  AgentPublicEvent,
  MemoryCandidate,
  MemoryCandidateRecord,
  MemoryContext,
  PersonaContent,
  PersonaPatchRecord,
  PersonaVersion,
  ProductConversation,
  ProductConversationDetail,
  ProductIdentity,
  ProductMessage,
  ProductUser,
  QuickStartAnswers,
} from "@reso/contracts";

export interface EmailCodeRecord {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: string;
  resendAvailableAt: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: string | null;
  createdAt: string;
}

export interface CorrectionRecord {
  id: string;
  path: string;
  previousValue: unknown;
  correctedValue: unknown;
  createdAt: string;
}

export interface GuestRecord {
  id: string;
  tokenHash: string;
  status: "started" | "draft_ready" | "confirmed" | "claimed";
  answers: QuickStartAnswers | null;
  personaDraft: PersonaContent | null;
  corrections: CorrectionRecord[];
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentContextRecord {
  identity: ProductIdentity;
  conversation: ProductConversation;
  persona: PersonaVersion;
  memories: MemoryContext[];
  recentMessages: Array<{ id: string; role: "user" | "agent"; content: string }>;
}

export interface TranscriptRow {
  id: string;
  role: "user" | "agent";
  content: string;
  createdAt: string;
}

export interface ReflectionPersona {
  versionId: string;
  version: number;
  content: PersonaContent;
}

export interface OutboxAppend {
  id: string;
  eventType: string;
  subjectId: string;
  correlationId: string | null;
  idempotencyKey: string;
  payload: unknown;
  occurredAt: string;
}

export type CandidateDecision = "accept" | "reject";

export interface DecideResult {
  outcome: "promoted" | "rejected" | "not-pending" | "missing";
  /** Set when outcome === "promoted": id of the freshly accepted memories row. */
  memoryId?: string;
  /** Set when outcome === "promoted": the accepted summary (for embedding). */
  summary?: string;
}

export interface ReflectionCandidateInput {
  sourceMessageId: string;
  type: MemoryCandidate["type"];
  summary: string;
  evidenceMessageIds: string[];
  confidence: number;
}

export interface ReflectionPatchInput {
  fromVersionId: string;
  path: string;
  oldValue: unknown;
  proposedValue: unknown;
  reason: string;
  evidenceMessageIds: string[];
  confidence: number;
}

export interface VerticalSliceRepository {
  findLatestEmailCode(email: string): Promise<EmailCodeRecord | null>;
  saveEmailCode(record: EmailCodeRecord): Promise<void>;
  updateEmailCode(record: EmailCodeRecord): Promise<void>;
  incrementEmailCodeAttempt(id: string, email: string): Promise<number>;
  consumeEmailCode(id: string, email: string, consumedAt: string): Promise<boolean>;
  findOrCreateUser(email: string, now: string): Promise<{ user: ProductUser; created: boolean }>;
  getIdentity(userId: string): Promise<ProductIdentity | null>;
  createGuest(record: GuestRecord): Promise<void>;
  getGuestByTokenHash(tokenHash: string): Promise<GuestRecord | null>;
  saveGuest(record: GuestRecord): Promise<void>;
  attachGuestToUser(guestId: string, userId: string, now: string): Promise<void>;
  claimGuest(
    guestId: string,
    userId: string,
    agentName: string,
    now: string,
  ): Promise<ProductIdentity>;
  createConversation(userId: string, agentId: string, now: string): Promise<ProductConversation>;
  getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ProductConversationDetail | null>;
  listConversations(userId: string): Promise<ProductConversation[]>;
  findMessageByClientId(userId: string, clientMessageId: string): Promise<ProductMessage | null>;
  saveMessage(message: ProductMessage, clientMessageId?: string): Promise<ProductMessage>;
  getAgentContext(userId: string, conversationId: string): Promise<AgentContextRecord | null>;
  saveMemoryCandidates(
    userId: string,
    sourceMessageId: string,
    candidates: MemoryCandidate[],
    now: string,
  ): Promise<void>;
  savePublicEvents(messageId: string, events: AgentPublicEvent[]): Promise<void>;
  appendOutboxEvent(event: OutboxAppend): Promise<void>;
  countUserMessagesAfter(conversationId: string, afterIso: string): Promise<number>;
  getReflectionWindow(
    conversationId: string,
    limit: number,
  ): Promise<{ transcript: TranscriptRow[]; newestAt: string } | null>;
  getReflectionPersona(userId: string): Promise<ReflectionPersona | null>;
  saveReflectionResults(input: {
    userId: string;
    memories: ReflectionCandidateInput[];
    patches: ReflectionPatchInput[];
    now: string;
  }): Promise<void>;
  reflectionWatermarkAfter(conversationId: string): Promise<string>;
  advanceReflectionRun(input: {
    userId: string;
    conversationId: string;
    lastReflectedAt: string;
    now: string;
  }): Promise<void>;
  listPendingMemoryCandidates(userId: string): Promise<MemoryCandidateRecord[]>;
  decideMemoryCandidate(
    id: string,
    userId: string,
    decision: CandidateDecision,
    now: string,
  ): Promise<DecideResult>;
  listMemoriesWithoutEmbedding(
    userId: string,
    limit: number,
  ): Promise<Array<{ id: string; summary: string }>>;
  storeMemoryEmbedding(memoryId: string, embedding: number[]): Promise<void>;
  listPendingPersonaPatches(userId: string): Promise<PersonaPatchRecord[]>;
  decidePersonaPatch(
    id: string,
    userId: string,
    decision: CandidateDecision,
    now: string,
  ): Promise<DecideResult>;
}
