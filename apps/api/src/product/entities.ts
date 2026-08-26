import type { AssistStatus, TeaPartyStatus, TeaPartyStopReason } from "@reso/contracts";

export type ConnectionStatus = "pending" | "established" | "closed" | "blocked";

export interface ConnectionRecord {
  id: string;
  userAId: string;
  userBId: string;
  agentAId: string;
  agentBId: string;
  status: ConnectionStatus;
  userAProxyConsent: boolean;
  userBProxyConsent: boolean;
  blockedByUserId: string | null;
  establishedAt: string | null;
}

export interface HumanMessageRecord {
  id: string;
  connectionId: string;
  senderUserId: string;
  content: string;
  clientMessageId: string;
  traceId: string;
  createdAt: string;
}

export interface AssistRequestRecord {
  id: string;
  connectionId: string;
  requesterUserId: string;
  requestType: "analyze" | "polish";
  sourceMessageId: string | null;
  clientRequestId: string;
  status: AssistStatus;
  result: unknown | null;
  traceId: string;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TeaPartyMissionRecord {
  id: string;
  connectionId: string;
  missionType: "post_connection_tea_party";
  initiatorAgentId: string;
  targetAgentId: string;
  status: Exclude<TeaPartyStatus, "not_available" | "permission_required">;
  maxTurns: number;
  currentTurn: number;
  maxModelCalls: number;
  modelCallsUsed: number;
  stopReason: TeaPartyStopReason | null;
  errorCode?: string | null;
  traceId: string;
  retryCount: number;
  summary: unknown | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentInteractionRecord {
  id: string;
  missionId: string;
  turnNo: number;
  speakerAgentId: string;
  content: string;
  visibility: "participants" | "private" | "blocked";
  modelTraceId: string;
  traceId: string;
  createdAt: string;
}

export interface OutboxEventRecord {
  id: string;
  eventType: string;
  subjectId: string;
  traceId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  attempts?: number;
}

export interface AuditLogRecord {
  id: string;
  actorUserId: string | null;
  action: string;
  subjectId: string;
  traceId: string;
  outcome: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
