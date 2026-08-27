import { randomUUID } from "node:crypto";
import type { ConnectionRecord, OutboxEventRecord } from "./entities.js";
import { ProductError } from "./product-error.js";
import type { ProductRepository } from "./repository.js";

export class ConnectionLifecycleService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async establish(connectionId: string, traceId: string): Promise<ConnectionRecord> {
    return this.mutate(connectionId, (current) => {
      if (current.status === "established") return { connection: current, event: null };
      if (current.status !== "pending") {
        throw new ProductError(
          "TEA_PARTY_NOT_AVAILABLE",
          "Connection cannot be established",
          false,
        );
      }
      const updated: ConnectionRecord = {
        ...current,
        status: "established",
        establishedAt: this.now(),
      };
      return this.commit(updated, "relationship.updated", traceId, {
        connectionId,
        status: "established",
      });
    });
  }

  async setProxyConsent(
    connectionId: string,
    userId: string,
    granted: boolean,
    traceId: string,
  ): Promise<ConnectionRecord> {
    return this.mutate(connectionId, (current) => {
      this.assertParticipant(current, userId);
      const alreadyGranted =
        current.userAId === userId ? current.userAProxyConsent : current.userBProxyConsent;
      if (alreadyGranted === granted) return { connection: current, event: null };
      const updated: ConnectionRecord = {
        ...current,
        userAProxyConsent: current.userAId === userId ? granted : current.userAProxyConsent,
        userBProxyConsent: current.userBId === userId ? granted : current.userBProxyConsent,
      };
      return this.commit(updated, granted ? "consent.granted" : "consent.revoked", traceId, {
        connectionId,
        userId,
        scope: "proxy.social",
      });
    });
  }

  async block(
    connectionId: string,
    blockerUserId: string,
    traceId: string,
  ): Promise<ConnectionRecord> {
    return this.mutate(connectionId, (current) => {
      this.assertParticipant(current, blockerUserId);
      if (current.status === "blocked" && current.blockedByUserId === blockerUserId) {
        return { connection: current, event: null };
      }
      const updated: ConnectionRecord = {
        ...current,
        status: "blocked",
        blockedByUserId: blockerUserId,
      };
      return this.commit(updated, "relationship.blocked", traceId, {
        connectionId,
        blockerUserId,
      });
    });
  }

  private async mutate(
    connectionId: string,
    mutate: Parameters<ProductRepository["mutateConnectionWithOutboxEvent"]>[1],
  ): Promise<ConnectionRecord> {
    const connection = await this.repository.mutateConnectionWithOutboxEvent(connectionId, mutate);
    if (connection === null) {
      throw new ProductError("CONNECTION_FORBIDDEN", "Connection not found", false);
    }
    return connection;
  }

  private assertParticipant(connection: ConnectionRecord, userId: string): void {
    if (connection.userAId !== userId && connection.userBId !== userId) {
      throw new ProductError("CONNECTION_FORBIDDEN", "Not a connection participant", false);
    }
  }

  private commit(
    connection: ConnectionRecord,
    eventType: OutboxEventRecord["eventType"],
    traceId: string,
    payload: Record<string, unknown>,
  ): { connection: ConnectionRecord; event: OutboxEventRecord } {
    const actorKey =
      typeof payload["userId"] === "string"
        ? payload["userId"]
        : typeof payload["blockerUserId"] === "string"
          ? payload["blockerUserId"]
          : "system";
    return {
      connection,
      event: {
        id: randomUUID(),
        eventType,
        subjectId: connection.id,
        traceId,
        idempotencyKey: `${eventType}:${connection.id}:${actorKey}:${traceId}`,
        payload,
        occurredAt: this.now(),
      },
    };
  }
}
