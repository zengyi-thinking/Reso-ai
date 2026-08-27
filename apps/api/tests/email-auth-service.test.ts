import { describe, expect, it } from "vitest";
import { EmailAuthService } from "../src/auth/email-auth-service.js";
import type { EmailCodeMailer } from "../src/auth/email-mailer.js";
import { SessionService } from "../src/auth/session-service.js";
import { InMemoryProductRepository } from "../src/product/in-memory-repository.js";
import { ProductError } from "../src/product/product-error.js";
import { InMemoryVerticalSliceRepository } from "../src/vertical-slice/in-memory-repository.js";

class CapturingMailer implements EmailCodeMailer {
  readonly deliveries: Array<{ email: string; code: string }> = [];
  async sendCode(email: string, code: string): Promise<void> {
    this.deliveries.push({ email, code });
  }
}

function fixture() {
  let now = new Date("2026-08-27T04:00:00.000Z");
  const vertical = new InMemoryVerticalSliceRepository();
  const sessions = new SessionService(new InMemoryProductRepository(), 86_400_000, () => now);
  const mailer = new CapturingMailer();
  const service = new EmailAuthService(vertical, sessions, mailer, {
    hashSecret: "test-secret-that-never-leaves-the-test",
    now: () => now,
    generateCode: () => "042619",
    ttlMs: 5 * 60_000,
    resendCooldownMs: 60_000,
    maxAttempts: 3,
  });
  return {
    service,
    sessions,
    mailer,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe("email verification authentication", () => {
  it("sends, consumes once, creates a user and issues a resolvable session", async () => {
    const { service, sessions, mailer } = fixture();
    await service.sendCode("hello@example.com");
    expect(mailer.deliveries).toEqual([{ email: "hello@example.com", code: "042619" }]);
    const verified = await service.verifyCode(
      { email: "hello@example.com", code: "042619" },
      "8bcf7eac-f17c-4581-b5fb-5c82b13f6c67",
    );
    expect(await sessions.resolve(verified.sessionToken)).toBe(verified.identity.user.id);
    await expect(
      service.verifyCode(
        { email: "hello@example.com", code: "042619" },
        "8bcf7eac-f17c-4581-b5fb-5c82b13f6c67",
      ),
    ).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
  });

  it("enforces resend cooldown, expiry, and a bounded attempt budget", async () => {
    const { service, advance } = fixture();
    await service.sendCode("hello@example.com");
    await expect(service.sendCode("hello@example.com")).rejects.toBeInstanceOf(ProductError);
    advance(5 * 60_000 + 1);
    await expect(
      service.verifyCode(
        { email: "hello@example.com", code: "042619" },
        "8bcf7eac-f17c-4581-b5fb-5c82b13f6c67",
      ),
    ).rejects.toMatchObject({ code: "AUTH_CODE_EXPIRED" });

    await service.sendCode("other@example.com");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        service.verifyCode(
          { email: "other@example.com", code: "111111" },
          "8bcf7eac-f17c-4581-b5fb-5c82b13f6c67",
        ),
      ).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
    }
    await expect(
      service.verifyCode(
        { email: "other@example.com", code: "042619" },
        "8bcf7eac-f17c-4581-b5fb-5c82b13f6c67",
      ),
    ).rejects.toMatchObject({ code: "AUTH_CODE_LOCKED" });
  });
});
