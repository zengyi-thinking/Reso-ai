import { TeaPartyResponseSchema, type TeaPartyResponse } from "@reso/contracts";
import { assertConnectionParticipant } from "./authorization.js";
import { ProductError } from "./product-error.js";
import type { ProductRepository } from "./repository.js";
import type { TeaPartyService } from "./tea-party-service.js";

export class TeaPartyQueryService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly teaPartyService: TeaPartyService,
    private readonly maxRetries = 2,
  ) {}

  async get(connectionId: string, viewerUserId: string): Promise<TeaPartyResponse> {
    const connection = await this.repository.getConnection(connectionId);
    if (connection === null)
      throw new ProductError("CONNECTION_FORBIDDEN", "Connection not found", false);
    assertConnectionParticipant(connection, viewerUserId);
    if (connection.status === "pending" || connection.status === "closed") {
      return this.empty("not_available");
    }
    if (connection.status === "blocked" || connection.blockedByUserId !== null) {
      return this.empty("blocked");
    }
    if (!connection.userAProxyConsent || !connection.userBProxyConsent) {
      return this.empty("permission_required");
    }
    const mission = await this.repository.getTeaPartyMissionByConnection(connectionId);
    if (mission === null) return this.empty("queued");
    const interactions = await this.repository.listInteractions(mission.id);
    const messages =
      mission.status === "ready"
        ? interactions.map((interaction) => ({
            id: interaction.id,
            turnNo: interaction.turnNo,
            speakerAgentId: interaction.speakerAgentId,
            speakerLabel:
              interaction.speakerAgentId ===
              (connection.userAId === viewerUserId ? connection.agentAId : connection.agentBId)
                ? ("my_agent" as const)
                : ("their_agent" as const),
            content: interaction.content,
            createdAt: interaction.createdAt,
          }))
        : [];
    return TeaPartyResponseSchema.parse({
      status: mission.status,
      sessionId: mission.id,
      messages,
      summary: mission.status === "ready" ? mission.summary : null,
      completedAt: mission.status === "ready" ? mission.completedAt : null,
      retryable: mission.status === "failed" && mission.retryCount < this.maxRetries,
      traceId: mission.traceId,
    });
  }

  async retry(connectionId: string, viewerUserId: string): Promise<TeaPartyResponse> {
    const current = await this.get(connectionId, viewerUserId);
    if (current.status !== "failed" || !current.retryable) {
      throw new ProductError("RETRY_NOT_ALLOWED", "Tea Party is not in a retryable state", false);
    }
    await this.teaPartyService.run(connectionId);
    return this.get(connectionId, viewerUserId);
  }

  async listNotifications(viewerUserId: string) {
    const events = await this.repository.listOutboxEvents();
    const visible = [];
    for (const event of events) {
      if (event.eventType !== "tea_party.ready" && event.eventType !== "tea_party.failed") continue;
      const connectionId = event.payload.connectionId;
      if (typeof connectionId !== "string") continue;
      const connection = await this.repository.getConnection(connectionId);
      if (connection === null) continue;
      if (connection.userAId !== viewerUserId && connection.userBId !== viewerUserId) continue;
      if (
        connection.status === "blocked" ||
        connection.blockedByUserId !== null ||
        !connection.userAProxyConsent ||
        !connection.userBProxyConsent
      ) {
        continue;
      }
      visible.push({
        id: event.id,
        type: event.eventType,
        connectionId,
        traceId: event.traceId,
        occurredAt: event.occurredAt,
      });
    }
    return visible;
  }

  private empty(
    status: "not_available" | "permission_required" | "queued" | "blocked",
  ): TeaPartyResponse {
    return TeaPartyResponseSchema.parse({
      status,
      sessionId: null,
      messages: [],
      summary: null,
      completedAt: null,
      retryable: false,
      traceId: null,
    });
  }
}
