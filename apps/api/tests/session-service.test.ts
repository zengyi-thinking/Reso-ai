import { describe, expect, it } from "vitest";
import { hashToken, SessionService } from "../src/auth/session-service.js";
import { InMemoryProductRepository } from "../src/product/in-memory-repository.js";

const userId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a01";
const traceId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93e01";

describe("production session primitives", () => {
  it("stores only a token hash and supports revocation", async () => {
    const repository = new InMemoryProductRepository();
    const service = new SessionService(repository, 60_000);
    const session = await service.create(userId, traceId);
    const tokenHash = hashToken(session.token);

    expect(session.token.length).toBeGreaterThanOrEqual(32);
    expect(tokenHash).not.toContain(session.token);
    expect(await repository.resolveSession(tokenHash)).toBe(userId);

    await service.revoke(session.token, userId, traceId);
    expect(await repository.resolveSession(tokenHash)).toBeNull();
  });
});
