import { describe, expect, it } from "vitest";
import {
  AgentTurnRequestSchema,
  DisclosureDecisionSchema,
  EventEnvelopeSchema,
  PersonaPatchCandidateSchema,
} from "../src/index.js";

const id = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12";

describe("Reso.AI contracts", () => {
  it("accepts a valid agent turn without exposing provider details", () => {
    const parsed = AgentTurnRequestSchema.parse({
      requestId: id,
      userId: id,
      agentId: id,
      conversationId: id,
      message: "今天有点累。",
      personaVersionId: null,
    });

    expect(parsed.message).toBe("今天有点累。");
    expect("model" in parsed).toBe(false);
    expect("prompt" in parsed).toBe(false);
  });

  it("requires persona changes to remain candidates", () => {
    const result = PersonaPatchCandidateSchema.safeParse({
      id,
      userId: id,
      fromVersionId: id,
      path: "/confirmedPatterns/0",
      oldValue: "慢热",
      proposedValue: "对低价值社交主动性低",
      reason: "用户明确纠正",
      evidenceIds: [id],
      confidence: 0.76,
      status: "accepted",
      createdAt: "2026-08-26T08:00:00+08:00",
      confirmedAt: null,
    });

    expect(result.success).toBe(true);
  });

  it("keeps consent revocation in the event vocabulary", () => {
    const event = EventEnvelopeSchema.parse({
      id,
      type: "consent.revoked",
      version: 1,
      occurredAt: "2026-08-26T08:00:00+08:00",
      producer: "api",
      correlationId: id,
      causationId: null,
      subjectId: id,
      payload: { scope: "proxy.social" },
    });

    expect(event.type).toBe("consent.revoked");
  });

  it("supports ask-user disclosure decisions", () => {
    expect(
      DisclosureDecisionSchema.parse({
        decision: "ASK_USER",
        level: "L3_RELATIONSHIP",
        reasonCode: "explicit-consent-required",
      }).decision,
    ).toBe("ASK_USER");
  });
});
