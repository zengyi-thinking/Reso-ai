import { randomUUID } from "node:crypto";
import { assertConnectionParticipant } from "./authorization.js";
import { ProductError } from "./product-error.js";
import type { ProductRepository } from "./repository.js";

export class HumanChatService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async send(input: {
    connectionId: string;
    senderUserId: string;
    content: string;
    clientMessageId: string;
    traceId: string;
  }) {
    const connection = await this.repository.getConnection(input.connectionId);
    if (connection === null)
      throw new ProductError("CONNECTION_FORBIDDEN", "Connection not found", false);
    assertConnectionParticipant(connection, input.senderUserId);
    if (connection.status !== "established") {
      throw new ProductError("CONNECTION_FORBIDDEN", "Human chat is not open", false);
    }
    const message = await this.repository.saveHumanMessage({
      id: randomUUID(),
      connectionId: input.connectionId,
      senderUserId: input.senderUserId,
      content: input.content,
      clientMessageId: input.clientMessageId,
      traceId: input.traceId,
      createdAt: this.now(),
    });
    await this.repository.saveAuditLog({
      id: randomUUID(),
      actorUserId: input.senderUserId,
      action: "human_message.send",
      subjectId: message.id,
      traceId: input.traceId,
      outcome: "created",
      metadata: { connectionId: input.connectionId },
      createdAt: this.now(),
    });
    return message;
  }
}
