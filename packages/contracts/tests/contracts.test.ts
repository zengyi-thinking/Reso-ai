import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AgentTurnRequestSchema,
  AgentTurnResponseSchema,
  AgentPublicOutputSchema,
  AgentStreamEventSchema,
  DisclosureDecisionSchema,
  EventEnvelopeSchema,
  PersonaPatchCandidateSchema,
  LabSessionSchema,
} from "../src/index.js";

const id = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12";
const fixtureDirectory = fileURLToPath(new URL("../fixtures/", import.meta.url));

function readFixture(name: string): { request: unknown; response: unknown } {
  return JSON.parse(readFileSync(`${fixtureDirectory}/${name}`, "utf8")) as {
    request: unknown;
    response: unknown;
  };
}

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

  it("accepts the shared valid AgentTurn golden fixture", () => {
    const fixture = readFixture("agent-turn.valid.json");
    expect(AgentTurnRequestSchema.safeParse(fixture.request).success).toBe(true);
    expect(AgentTurnResponseSchema.safeParse(fixture.response).success).toBe(true);
  });

  it("rejects the shared invalid AgentTurn golden fixture", () => {
    const fixture = readFixture("agent-turn.invalid.json");
    expect(AgentTurnRequestSchema.safeParse(fixture.request).success).toBe(false);
    expect(AgentTurnResponseSchema.safeParse(fixture.response).success).toBe(false);
  });

  it("keeps Lab model metadata and trace free of private reasoning fields", () => {
    const lab = LabSessionSchema.safeParse({
      id,
      user: { id, slug: "user-alice", displayName: "Alice", personaVersion: "1.0" },
      provider: "deterministic",
      createdAt: "2026-08-26T08:00:00+08:00",
      persona: {
        version: "1.0",
        content: {},
      },
      pendingPatches: [],
      memories: [],
      turns: [],
    });

    expect(lab.success).toBe(true);
    expect("chainOfThought" in (lab.success ? lab.data : {})).toBe(false);
  });

  it("accepts the three public breathing event types", () => {
    const output = AgentPublicOutputSchema.parse({
      cadence: "reflective",
      events: [
        { type: "status", phase: "recalling", text: "想起了一件和你有关的事…" },
        {
          type: "public_reflection",
          text: "你之前提到过，关系不确定时会想马上确认。",
          evidenceRefs: ["memory:0"],
        },
        { type: "message", position: "final", text: "所以这次可以先观察两三次互动。" },
      ],
    });

    expect(output.events.map((event) => event.type)).toEqual([
      "status",
      "public_reflection",
      "message",
    ]);
    expect(AgentStreamEventSchema.parse({ type: "complete", turnId: id, traceId: id }).type).toBe(
      "complete",
    );
  });

  it("rejects public output without a final position or with invalid evidence", () => {
    expect(
      AgentPublicOutputSchema.safeParse({
        cadence: "reflective",
        events: [
          {
            type: "public_reflection",
            text: "我记得你的隐藏信息。",
            evidenceRefs: ["private:reasoning"],
          },
          { type: "message", position: "tentative", text: "也许是这样。" },
        ],
      }).success,
    ).toBe(false);
  });
});
