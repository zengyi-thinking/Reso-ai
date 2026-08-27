import { randomBytes, randomUUID } from "node:crypto";
import type { GuestOnboarding, PersonaContent, QuickStartAnswers } from "@reso/contracts";
import type { IAgentClient } from "../agent-client/agent-client.js";
import { hashOpaqueToken } from "../auth/email-auth-service.js";
import { ProductError } from "../product/product-error.js";
import type { GuestRecord, VerticalSliceRepository } from "./repository.js";

export class OnboardingService {
  constructor(
    private readonly repository: VerticalSliceRepository,
    private readonly agentClient: IAgentClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createGuest(): Promise<{ guestToken: string; onboarding: GuestOnboarding }> {
    const guestToken = randomBytes(32).toString("base64url");
    const timestamp = this.now().toISOString();
    const record: GuestRecord = {
      id: randomUUID(),
      tokenHash: hashOpaqueToken(guestToken),
      status: "started",
      answers: null,
      personaDraft: null,
      corrections: [],
      userId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repository.createGuest(record);
    return { guestToken, onboarding: this.publicGuest(record) };
  }

  async getGuest(guestToken: string): Promise<GuestOnboarding> {
    return this.publicGuest(await this.requireGuest(guestToken));
  }

  async submitQuickStart(guestToken: string, answers: QuickStartAnswers): Promise<GuestOnboarding> {
    const guest = await this.requireGuest(guestToken);
    const result = await this.agentClient.initializeQuickStartPersona({
      requestId: randomUUID(),
      answers,
    });
    const updated: GuestRecord = {
      ...guest,
      answers,
      personaDraft: result.content,
      status: "draft_ready",
      updatedAt: this.now().toISOString(),
    };
    await this.repository.saveGuest(updated);
    return this.publicGuest(updated);
  }

  async confirmDraft(guestToken: string, content: PersonaContent): Promise<GuestOnboarding> {
    const guest = await this.requireGuest(guestToken);
    if (guest.personaDraft === null)
      throw new ProductError("ONBOARDING_INCOMPLETE", "请先完成 Quick Start。", false);
    const now = this.now().toISOString();
    const paths = [
      "values",
      "communicationStyle",
      "socialStyle",
      "relationshipNeeds",
      "boundaries",
    ] as const;
    const corrections = [...guest.corrections];
    for (const path of paths) {
      if (JSON.stringify(guest.personaDraft[path]) !== JSON.stringify(content[path])) {
        corrections.push({
          id: randomUUID(),
          path,
          previousValue: guest.personaDraft[path],
          correctedValue: content[path],
          createdAt: now,
        });
      }
    }
    const updated: GuestRecord = {
      ...guest,
      personaDraft: content,
      corrections,
      status: "confirmed",
      updatedAt: now,
    };
    await this.repository.saveGuest(updated);
    return this.publicGuest(updated);
  }

  async claim(guestToken: string, userId: string, agentName: string) {
    const guest = await this.requireGuest(guestToken);
    if (guest.userId !== userId)
      throw new ProductError("AUTH_REQUIRED", "请先用领取时的邮箱完成验证。", false);
    if (guest.status !== "confirmed" && guest.status !== "claimed")
      throw new ProductError("ONBOARDING_INCOMPLETE", "请先确认你的初步说明书。", false);
    return this.repository.claimGuest(guest.id, userId, agentName, this.now().toISOString());
  }

  private async requireGuest(token: string): Promise<GuestRecord> {
    const guest = await this.repository.getGuestByTokenHash(hashOpaqueToken(token));
    if (guest === null)
      throw new ProductError("GUEST_SESSION_NOT_FOUND", "这段认识旅程已经失效。", false);
    return guest;
  }
  private publicGuest(record: GuestRecord): GuestOnboarding {
    return {
      id: record.id,
      status: record.status,
      answers: record.answers,
      personaDraft: record.personaDraft,
      corrections: structuredClone(record.corrections),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
