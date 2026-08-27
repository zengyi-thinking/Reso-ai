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
  LabTurnSchema,
  PersonaPatchCandidateSchema,
  AnalyzeIncomingRequestSchema,
  AnalyzeAssistResponseSchema,
  LabSessionSchema,
  PolishDraftResponseSchema,
  ProductErrorResponseSchema,
  SocialActRequestSchema,
  SocialActResponseSchema,
  TeaPartyResponseSchema,
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
    expect(AgentStreamEventSchema.parse({ type: "message_delta", text: "重新想了一" }).type).toBe(
      "message_delta",
    );
    expect(AgentStreamEventSchema.safeParse({ type: "message_delta", text: "" }).success).toBe(
      false,
    );
  });

  it("lab turns expose what memory was written this turn", () => {
    const turn = LabTurnSchema.safeParse({
      id: id,
      createdAt: "2026-08-26T10:00:00+00:00",
      input: "不是，我只是讨厌无意义社交。",
      response: "好，这个区别很重要。",
      mode: "companion",
      modeReason: "ordinary sharing or conversation",
      promptVersion: "companion/v3",
      personaVersion: "1.0",
      personaFields: ["values"],
      retrievedMemories: [],
      contextSummary: {
        personaFields: ["values"],
        memoryIds: [],
        recentMessageCount: 0,
        relationshipIncluded: false,
      },
      model: {
        provider: "deterministic",
        model: "reso-relational-v1",
        latencyMs: 0,
        promptTokens: null,
        completionTokens: null,
      },
      memoryCandidateIds: [id],
      memoryWrites: [
        {
          id: id,
          type: "correction",
          summary: "用户明确纠正：并非普遍慢热。",
          requiresReview: true,
        },
      ],
      personaPatchCandidates: [],
      relationshipCandidates: [],
      cadence: "direct",
      publicEvents: [{ type: "message", position: "final", text: "好，这个区别很重要。" }],
      eval: [],
      traceId: id,
      replayOf: null,
    });
    expect(turn.success).toBe(true);
    expect(turn.success && turn.data.memoryWrites[0].type).toBe("correction");
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

  it("freezes the v0.1 assist contract without an auto-send field", () => {
    const request = AnalyzeIncomingRequestSchema.parse({
      requestId: id,
      idempotencyKey: "user-1:req-1",
      requesterUserId: id,
      connectionId: id,
      sourceMessageId: id,
      sourceText: "周末要不要一起喝咖啡？",
      senderUserId: id,
      agentId: id,
      traceId: id,
    });
    const polished = PolishDraftResponseSchema.parse({
      candidates: [{ id: "draft-1", text: "周末有空的话，要不要一起喝杯咖啡？" }],
      traceId: id,
    });

    expect(request.sourceText).toContain("咖啡");
    expect("send" in polished).toBe(false);
    expect("messageId" in polished).toBe(false);
  });

  it("returns the same Assist task state while an idempotent request is still running", () => {
    const response = AnalyzeAssistResponseSchema.parse({
      requestId: id,
      status: "running",
      result: null,
      traceId: id,
    });

    expect(response.status).toBe("running");
    expect(response.result).toBeNull();
  });

  it("caps tea-party turns at eight and requires a disclosure decision", () => {
    const request = SocialActRequestSchema.parse({
      missionId: id,
      connectionId: id,
      turnNo: 8,
      speakerAgentId: id,
      listenerAgentId: id,
      priorMessages: [],
      disclosureLevel: "L2_SOCIAL",
      maxContentLength: 2_000,
      idempotencyKey: "mission:turn:8",
      traceId: id,
    });
    const response = SocialActResponseSchema.parse({
      speakerAgentId: id,
      content: "受控输出",
      disclosure: { decision: "ALLOW", level: "L2_SOCIAL", reasonCode: "allowed" },
      shouldStop: true,
      stopReason: "max_turns",
      traceId: id,
      agentVersionId: null,
    });

    expect(request.turnNo).toBe(8);
    expect(response.disclosure.decision).toBe("ALLOW");
    expect(SocialActRequestSchema.safeParse({ ...request, turnNo: 9 }).success).toBe(false);
  });

  it("defines stable product status and error envelopes", () => {
    expect(
      TeaPartyResponseSchema.parse({
        status: "not_available",
        sessionId: null,
        messages: [],
        summary: null,
        completedAt: null,
        retryable: false,
        traceId: null,
      }).status,
    ).toBe("not_available");
    expect(
      ProductErrorResponseSchema.parse({
        code: "AGENT_TIMEOUT",
        message: "Agent timed out",
        traceId: id,
        retryable: true,
      }).retryable,
    ).toBe(true);
  });
});
