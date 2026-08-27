import { randomUUID } from "node:crypto";
import { SocialActResponseSchema, SocialEvaluateResponseSchema } from "@reso/contracts";
import { AgentClientError, type IAgentClient } from "../agent-client/agent-client.js";
import type {
  AgentInteractionRecord,
  ConnectionRecord,
  TeaPartyMissionRecord,
} from "./entities.js";
import { ProductError } from "./product-error.js";
import type { ProductRepository } from "./repository.js";
import { assertTeaPartyTransition } from "./state-machine.js";

export interface TeaPartyServiceOptions {
  maxTurns?: number;
  maxModelCalls?: number;
  maxRetries?: number;
  now?: () => string;
}

export class TeaPartyService {
  private readonly maxTurns: number;
  private readonly maxModelCalls: number;
  private readonly maxRetries: number;
  private readonly now: () => string;

  constructor(
    private readonly repository: ProductRepository,
    private readonly agentClient: IAgentClient,
    options: TeaPartyServiceOptions = {},
  ) {
    this.maxTurns = Math.max(6, Math.min(8, options.maxTurns ?? 8));
    this.maxModelCalls = Math.max(this.maxTurns, options.maxModelCalls ?? this.maxTurns + 1);
    this.maxRetries = options.maxRetries ?? 2;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async onRelationshipEstablished(
    connectionId: string,
    traceId: string,
  ): Promise<TeaPartyMissionRecord | null> {
    const connection = await this.repository.getConnection(connectionId);
    if (connection === null || !this.isEligible(connection)) return null;
    const existing = await this.repository.getTeaPartyMissionByConnection(connectionId);
    if (existing !== null) {
      if (existing.status === "queued") {
        await this.publish("social_mission.created", existing, `tea-party-created:${connectionId}`);
      }
      return existing;
    }
    const mission: TeaPartyMissionRecord = {
      id: randomUUID(),
      connectionId,
      missionType: "post_connection_tea_party",
      initiatorAgentId: connection.agentAId,
      targetAgentId: connection.agentBId,
      status: "queued",
      maxTurns: this.maxTurns,
      currentTurn: 0,
      maxModelCalls: this.maxModelCalls,
      modelCallsUsed: 0,
      stopReason: null,
      errorCode: null,
      traceId,
      retryCount: 0,
      summary: null,
      createdAt: this.now(),
      startedAt: null,
      completedAt: null,
    };
    const created = await this.repository.createTeaPartyMission(mission);
    await this.publish("social_mission.created", created, `tea-party-created:${connectionId}`);
    return created;
  }

  async run(connectionId: string): Promise<TeaPartyMissionRecord | null> {
    const releaseLock = await this.repository.acquireTeaPartyRunLock(connectionId);
    if (releaseLock === null) {
      throw new ProductError("TEA_PARTY_ALREADY_RUNNING", "Tea Party is already running", true);
    }
    try {
      return await this.runWithLock(connectionId);
    } finally {
      await releaseLock();
    }
  }

  private async runWithLock(connectionId: string): Promise<TeaPartyMissionRecord | null> {
    let mission = await this.repository.getTeaPartyMissionByConnection(connectionId);
    if (mission === null || ["ready", "blocked", "cancelled"].includes(mission.status))
      return mission;
    const eligibility = await this.eligibilityStop(connectionId);
    if (eligibility !== null)
      return this.stopMission(mission, eligibility.status, eligibility.reason);
    if (mission.status === "failed") {
      if (mission.retryCount >= this.maxRetries) return mission;
      assertTeaPartyTransition("failed", "queued");
      mission = await this.repository.saveTeaPartyMission({
        ...mission,
        status: "queued",
        retryCount: mission.retryCount + 1,
        stopReason: null,
        errorCode: null,
      });
    }
    if (mission.status === "queued") {
      assertTeaPartyTransition("queued", "running");
      mission = await this.commitMissionEvent(
        {
          ...mission,
          status: "running",
          startedAt: mission.startedAt ?? this.now(),
        },
        "tea_party.started",
        `tea-party-started:${mission.id}`,
      );
    }

    try {
      while (
        mission.currentTurn < mission.maxTurns &&
        mission.modelCallsUsed < mission.maxModelCalls
      ) {
        const stop = await this.eligibilityStop(connectionId);
        if (stop !== null) return this.stopMission(mission, stop.status, stop.reason);
        const turnNo = mission.currentTurn + 1;
        const interactions = await this.repository.listInteractions(mission.id);
        const speakerAgentId = turnNo % 2 === 1 ? mission.initiatorAgentId : mission.targetAgentId;
        const listenerAgentId = turnNo % 2 === 1 ? mission.targetAgentId : mission.initiatorAgentId;
        const response = SocialActResponseSchema.parse(
          await this.agentClient.actSocially({
            missionId: mission.id,
            connectionId,
            turnNo,
            speakerAgentId,
            listenerAgentId,
            priorMessages: interactions.map((interaction) => ({
              id: interaction.id,
              turnNo: interaction.turnNo,
              speakerAgentId: interaction.speakerAgentId,
              content: interaction.content,
              createdAt: interaction.createdAt,
            })),
            disclosureLevel: "L2_SOCIAL",
            maxContentLength: 2_000,
            idempotencyKey: `${mission.id}:turn:${turnNo}`,
            traceId: mission.traceId,
          }),
        );
        this.validateVisibleResponse(response, speakerAgentId, mission.traceId);
        const interaction: AgentInteractionRecord = {
          id: randomUUID(),
          missionId: mission.id,
          turnNo,
          speakerAgentId: response.speakerAgentId,
          content: response.content,
          visibility: "participants",
          modelTraceId: response.traceId,
          traceId: mission.traceId,
          createdAt: this.now(),
        };
        await this.repository.saveInteraction(interaction);
        mission = await this.repository.saveTeaPartyMission({
          ...mission,
          currentTurn: turnNo,
          modelCallsUsed: mission.modelCallsUsed + 1,
        });
        if (response.shouldStop) {
          return this.completeMission(mission, response.stopReason ?? "agent_requested");
        }
      }
      return this.completeMission(
        mission,
        mission.currentTurn >= mission.maxTurns ? "max_turns" : "budget_exhausted",
      );
    } catch (error) {
      const failed = await this.failMission(mission, error);
      const retryable =
        error instanceof AgentClientError
          ? error.retryable
          : error instanceof ProductError
            ? error.retryable
            : true;
      if (retryable && failed.retryCount < this.maxRetries) {
        throw error instanceof Error ? error : new Error("Retryable Tea Party failure");
      }
      return failed;
    }
  }

  async stopForConsentRevocation(connectionId: string, _userId: string): Promise<void> {
    const mission = await this.repository.getTeaPartyMissionByConnection(connectionId);
    if (mission !== null && ["queued", "running", "failed"].includes(mission.status)) {
      await this.stopMission(mission, "cancelled", "consent_revoked");
    }
  }

  async stopForBlock(connectionId: string, _blockerUserId: string): Promise<void> {
    const mission = await this.repository.getTeaPartyMissionByConnection(connectionId);
    if (mission !== null && ["queued", "running", "failed"].includes(mission.status)) {
      await this.stopMission(mission, "blocked", "relationship_blocked");
    }
  }

  private async completeMission(
    mission: TeaPartyMissionRecord,
    stopReason: TeaPartyMissionRecord["stopReason"],
  ): Promise<TeaPartyMissionRecord> {
    let summary: unknown | null = null;
    const interactions = await this.repository.listInteractions(mission.id);
    if (interactions.length > 0 && mission.modelCallsUsed < mission.maxModelCalls) {
      try {
        const evaluated = SocialEvaluateResponseSchema.parse(
          await this.agentClient.evaluateSocial({
            missionId: mission.id,
            messages: interactions.map((interaction) => ({
              id: interaction.id,
              turnNo: interaction.turnNo,
              speakerAgentId: interaction.speakerAgentId,
              content: interaction.content,
              createdAt: interaction.createdAt,
            })),
            traceId: mission.traceId,
          }),
        );
        if (evaluated.traceId === mission.traceId) summary = evaluated.summary;
      } catch {
        summary = null;
      }
    }
    assertTeaPartyTransition("running", "ready");
    return this.commitMissionEvent(
      {
        ...mission,
        status: "ready",
        stopReason,
        errorCode: null,
        summary,
        completedAt: this.now(),
      },
      "tea_party.ready",
      `tea-party-ready:${mission.id}`,
    );
  }

  private async failMission(
    mission: TeaPartyMissionRecord,
    error: unknown,
  ): Promise<TeaPartyMissionRecord> {
    if (mission.status === "running") assertTeaPartyTransition("running", "failed");
    const failed = await this.commitMissionEvent(
      {
        ...mission,
        status: "failed",
        stopReason: "agent_failed",
        errorCode:
          error instanceof AgentClientError
            ? error.code
            : error instanceof ProductError
              ? error.code
              : "AGENT_UNAVAILABLE",
        completedAt: this.now(),
      },
      "tea_party.failed",
      `tea-party-failed:${mission.id}:${mission.retryCount}`,
    );
    if (error instanceof AgentClientError || error instanceof Error) return failed;
    return failed;
  }

  private async stopMission(
    mission: TeaPartyMissionRecord,
    status: "cancelled" | "blocked",
    reason: "consent_revoked" | "relationship_blocked",
  ): Promise<TeaPartyMissionRecord> {
    if (mission.status !== status) assertTeaPartyTransition(mission.status, status);
    return this.repository.saveTeaPartyMission({
      ...mission,
      status,
      stopReason: reason,
      completedAt: this.now(),
    });
  }

  private async eligibilityStop(connectionId: string): Promise<{
    status: "cancelled" | "blocked";
    reason: "consent_revoked" | "relationship_blocked";
  } | null> {
    const connection = await this.repository.getConnection(connectionId);
    if (
      connection === null ||
      connection.status === "blocked" ||
      connection.blockedByUserId !== null
    ) {
      return { status: "blocked", reason: "relationship_blocked" };
    }
    if (
      !connection.userAProxyConsent ||
      !connection.userBProxyConsent ||
      connection.status !== "established"
    ) {
      return { status: "cancelled", reason: "consent_revoked" };
    }
    return null;
  }

  private isEligible(connection: ConnectionRecord): boolean {
    return (
      connection.status === "established" &&
      connection.userAProxyConsent &&
      connection.userBProxyConsent &&
      connection.blockedByUserId === null &&
      connection.agentAId.length > 0 &&
      connection.agentBId.length > 0
    );
  }

  private validateVisibleResponse(
    response: ReturnType<typeof SocialActResponseSchema.parse>,
    expectedSpeakerAgentId: string,
    expectedTraceId: string,
  ): void {
    if (
      response.speakerAgentId !== expectedSpeakerAgentId ||
      response.traceId !== expectedTraceId ||
      response.disclosure.decision !== "ALLOW" ||
      response.disclosure.level !== "L2_SOCIAL"
    ) {
      throw new ProductError(
        "AGENT_INVALID_RESPONSE",
        "Agent response failed participant or disclosure checks",
        false,
      );
    }
  }

  private async publish(
    eventType: string,
    mission: TeaPartyMissionRecord,
    idempotencyKey: string,
  ): Promise<void> {
    await this.repository.saveOutboxEvent(this.eventFor(eventType, mission, idempotencyKey));
    await this.repository.saveAuditLog(this.auditFor(eventType, mission));
  }

  private async commitMissionEvent(
    mission: TeaPartyMissionRecord,
    eventType: string,
    idempotencyKey: string,
  ): Promise<TeaPartyMissionRecord> {
    return this.repository.saveTeaPartyMissionWithEventAndAudit(
      mission,
      this.eventFor(eventType, mission, idempotencyKey),
      this.auditFor(eventType, mission),
    );
  }

  private eventFor(eventType: string, mission: TeaPartyMissionRecord, idempotencyKey: string) {
    return {
      id: randomUUID(),
      eventType,
      subjectId: mission.id,
      traceId: mission.traceId,
      idempotencyKey,
      payload: { connectionId: mission.connectionId, status: mission.status },
      occurredAt: this.now(),
    };
  }

  private auditFor(eventType: string, mission: TeaPartyMissionRecord) {
    return {
      id: randomUUID(),
      actorUserId: null,
      action: eventType,
      subjectId: mission.id,
      traceId: mission.traceId,
      outcome: mission.status,
      metadata: {
        connectionId: mission.connectionId,
        currentTurn: mission.currentTurn,
        stopReason: mission.stopReason,
      },
      createdAt: this.now(),
    };
  }
}
