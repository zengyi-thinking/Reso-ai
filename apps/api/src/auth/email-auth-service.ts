import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { EmailVerifyCodeResponseSchema } from "@reso/contracts";
import type { z } from "zod";
import { ProductError } from "../product/product-error.js";
import type { VerticalSliceRepository } from "../vertical-slice/repository.js";
import type { SessionService } from "./session-service.js";
import type { EmailCodeMailer } from "./email-mailer.js";

export interface EmailAuthOptions {
  ttlMs?: number;
  resendCooldownMs?: number;
  maxAttempts?: number;
  hashSecret: string;
  now?: () => Date;
  generateCode?: () => string;
}

export class EmailAuthService {
  private readonly ttlMs: number;
  private readonly resendCooldownMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;
  private readonly generateCode: () => string;

  constructor(
    private readonly repository: VerticalSliceRepository,
    private readonly sessions: SessionService,
    private readonly mailer: EmailCodeMailer,
    private readonly options: EmailAuthOptions,
  ) {
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.resendCooldownMs = options.resendCooldownMs ?? 60_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.now = options.now ?? (() => new Date());
    this.generateCode =
      options.generateCode ?? (() => randomInt(0, 1_000_000).toString().padStart(6, "0"));
  }

  async sendCode(email: string): Promise<{ expiresAt: string; resendAfterSeconds: number }> {
    const now = this.now();
    const latest = await this.repository.findLatestEmailCode(email);
    if (latest !== null && latest.consumedAt === null && new Date(latest.resendAvailableAt) > now) {
      throw new ProductError("RATE_LIMITED", "验证码发送得有点快，请稍后再试。", true);
    }
    const code = this.generateCode();
    const expiresAt = new Date(now.getTime() + this.ttlMs).toISOString();
    await this.repository.saveEmailCode({
      id: randomUUID(),
      email,
      codeHash: this.hash(email, code),
      expiresAt,
      resendAvailableAt: new Date(now.getTime() + this.resendCooldownMs).toISOString(),
      attempts: 0,
      maxAttempts: this.maxAttempts,
      consumedAt: null,
      createdAt: now.toISOString(),
    });
    try {
      await this.mailer.sendCode(email, code, Math.ceil(this.ttlMs / 60_000));
    } catch (error) {
      await this.repository.updateEmailCode({
        ...(await this.requireLatest(email)),
        consumedAt: now.toISOString(),
      });
      throw error;
    }
    return { expiresAt, resendAfterSeconds: Math.ceil(this.resendCooldownMs / 1_000) };
  }

  async verifyCode(
    input: { email: string; code: string; guestToken?: string | undefined },
    traceId: string,
  ): Promise<z.infer<typeof EmailVerifyCodeResponseSchema>> {
    const now = this.now();
    const record = await this.repository.findLatestEmailCode(input.email);
    if (record === null || record.consumedAt !== null)
      throw new ProductError("AUTH_CODE_INVALID", "验证码不正确或已使用。", false);
    if (new Date(record.expiresAt) <= now)
      throw new ProductError("AUTH_CODE_EXPIRED", "验证码已过期，请重新获取。", false);
    if (record.attempts >= record.maxAttempts)
      throw new ProductError("AUTH_CODE_LOCKED", "尝试次数过多，请重新获取验证码。", false);
    let guestId: string | null = null;
    if (input.guestToken !== undefined) {
      const guest = await this.repository.getGuestByTokenHash(hashOpaqueToken(input.guestToken));
      if (guest === null)
        throw new ProductError("GUEST_SESSION_NOT_FOUND", "这段认识旅程已经失效。", false);
      guestId = guest.id;
    }
    if (!this.matches(input.email, input.code, record.codeHash)) {
      await this.repository.incrementEmailCodeAttempt(record.id, input.email);
      throw new ProductError("AUTH_CODE_INVALID", "验证码不正确或已使用。", false);
    }
    const consumed = await this.repository.consumeEmailCode(
      record.id,
      input.email,
      now.toISOString(),
    );
    if (!consumed) throw new ProductError("AUTH_CODE_INVALID", "验证码不正确或已使用。", false);
    const { user } = await this.repository.findOrCreateUser(input.email, now.toISOString());
    let migratedGuest = false;
    if (guestId !== null) {
      await this.repository.attachGuestToUser(guestId, user.id, now.toISOString());
      migratedGuest = true;
    }
    const session = await this.sessions.create(user.id, traceId);
    const identity = await this.repository.getIdentity(user.id);
    if (identity === null) throw new Error("User identity was not persisted");
    return { sessionToken: session.token, expiresAt: session.expiresAt, identity, migratedGuest };
  }

  private hash(email: string, code: string): string {
    return createHash("sha256").update(`${this.options.hashSecret}:${email}:${code}`).digest("hex");
  }
  private matches(email: string, code: string, expected: string): boolean {
    const actual = Buffer.from(this.hash(email, code), "hex");
    const target = Buffer.from(expected, "hex");
    return actual.length === target.length && timingSafeEqual(actual, target);
  }
  private async requireLatest(email: string) {
    const record = await this.repository.findLatestEmailCode(email);
    if (record === null) throw new Error("Email verification challenge was not persisted");
    return record;
  }
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
