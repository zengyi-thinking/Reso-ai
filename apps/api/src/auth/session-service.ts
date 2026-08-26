import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ProductRepository } from "../product/repository.js";

export class SessionService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly ttlMs = 7 * 24 * 60 * 60 * 1_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(userId: string, traceId: string): Promise<{ token: string; expiresAt: string }> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(this.now().getTime() + this.ttlMs).toISOString();
    await this.repository.createSession(userId, tokenHash, expiresAt);
    await this.repository.saveAuditLog({
      id: randomUUID(),
      actorUserId: userId,
      action: "session.create",
      subjectId: userId,
      traceId,
      outcome: "created",
      metadata: { expiresAt },
      createdAt: this.now().toISOString(),
    });
    return { token, expiresAt };
  }

  async revoke(token: string, userId: string, traceId: string): Promise<void> {
    await this.repository.revokeSession(hashToken(token));
    await this.repository.saveAuditLog({
      id: randomUUID(),
      actorUserId: userId,
      action: "session.revoke",
      subjectId: userId,
      traceId,
      outcome: "revoked",
      metadata: {},
      createdAt: this.now().toISOString(),
    });
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
