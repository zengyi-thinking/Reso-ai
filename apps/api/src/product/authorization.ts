import type { ConnectionRecord } from "./entities.js";
import { ProductError } from "./product-error.js";

export function assertConnectionParticipant(connection: ConnectionRecord, userId: string): void {
  if (connection.userAId !== userId && connection.userBId !== userId) {
    throw new ProductError(
      "CONNECTION_FORBIDDEN",
      "You are not a participant in this connection",
      false,
    );
  }
}

export function otherParticipant(connection: ConnectionRecord, userId: string): string {
  assertConnectionParticipant(connection, userId);
  return connection.userAId === userId ? connection.userBId : connection.userAId;
}

export function agentForUser(connection: ConnectionRecord, userId: string): string {
  assertConnectionParticipant(connection, userId);
  return connection.userAId === userId ? connection.agentAId : connection.agentBId;
}
