import { createHash, randomUUID } from "node:crypto";
import type {
  AgentReflectionRequest,
  AgentReflectionResponse,
  AgentTurnRequest,
  AgentTurnResponse,
  PersonaInitializeRequest,
  PersonaPatchCandidate,
  PersonaVersion,
  SocialMission,
  SocialMissionResult,
  AnalyzeIncomingRequest,
  AnalyzeIncomingResponse,
  PolishDraftRequest,
  PolishDraftResponse,
  SocialActRequest,
  SocialActResponse,
  SocialEvaluateRequest,
  SocialEvaluateResponse,
} from "@reso/contracts";
import { AgentClientError, type IAgentClient } from "./agent-client.js";

export type MockAgentFailureMode = "none" | "timeout" | "unavailable" | "invalid_schema";

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

export class MockAgentClient implements IAgentClient {
  constructor(private readonly failureMode: MockAgentFailureMode = "none") {}

  async analyzeIncoming(request: AnalyzeIncomingRequest): Promise<AnalyzeIncomingResponse> {
    this.assertAvailable();
    return Promise.resolve({
      interpretation: "对方可能在发出一个轻量邀请，同时希望不给你压力。",
      replyRoutes: [
        {
          id: stableUuid(`${request.idempotencyKey}:route`),
          label: "顺着聊下去",
          suggestedReply: "听起来不错，你准备去哪里？",
        },
      ],
      traceId: request.traceId,
    });
  }

  async polishDraft(request: PolishDraftRequest): Promise<PolishDraftResponse> {
    this.assertAvailable();
    return Promise.resolve({
      candidates: [
        {
          id: stableUuid(`${request.idempotencyKey}:draft`),
          text: `想温和一点表达的话，可以说：${request.draft}`,
        },
      ],
      traceId: request.traceId,
    });
  }

  async actSocially(request: SocialActRequest): Promise<SocialActResponse> {
    this.assertAvailable();
    const messages = [
      "我家主人最近更喜欢不赶时间的周末活动。",
      "巧了，我家主人也偏爱散步或安静的咖啡馆。",
      "他们也许可以先聊聊各自最喜欢的散步路线。",
      "这种低压力的话题很适合作为开场。",
      "我还发现他们都重视真诚但不过度打扰的交流。",
      "那就把选择留给他们本人，我们只提供一个轻松的线索。",
      "我同意，真人关系应该由他们自己推进。",
      "茶话会到这里刚好，接下来交还给他们。",
    ];
    return Promise.resolve({
      speakerAgentId: request.speakerAgentId,
      content: messages[request.turnNo - 1] ?? messages[0]!,
      disclosure: { decision: "ALLOW", level: "L2_SOCIAL", reasonCode: "mock-safe-fixture" },
      shouldStop: request.turnNo >= 8,
      stopReason: request.turnNo >= 8 ? "max_turns" : null,
      traceId: request.traceId,
      agentVersionId: null,
    });
  }

  async evaluateSocial(request: SocialEvaluateRequest): Promise<SocialEvaluateResponse> {
    this.assertAvailable();
    return Promise.resolve({
      summary: {
        headline: "你们都偏好低压力的相处方式",
        conversationStarter: "可以聊聊各自最喜欢的散步路线",
      },
      traceId: request.traceId,
    });
  }

  async turn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
    const isCorrection = /不是|不对|并非|not really/i.test(request.message);

    return Promise.resolve({
      requestId: request.requestId,
      message: isCorrection
        ? "谢谢你纠正我。我会把这次纠正作为高优先级记忆，而不是直接给你贴标签。"
        : "听起来你今天需要一点轻松的空间。我们可以先不分析，只慢一点聊。",
      mode: isCorrection ? "mirror" : (request.requestedMode ?? "companion"),
      memoryCandidates: [
        {
          type: isCorrection ? "correction" : "episodic",
          summary: isCorrection
            ? "User explicitly corrected a prior interpretation."
            : "User shared that they felt tired today.",
          evidenceMessageIds: [],
          confidence: isCorrection ? 0.95 : 0.7,
          requiresReview: isCorrection,
        },
      ],
      personaPatchCandidates: [],
      relationshipCandidates: [],
      traceId: randomUUID(),
    });
  }

  async reflect(_request: AgentReflectionRequest): Promise<AgentReflectionResponse> {
    return Promise.resolve({ memoryCandidates: [], personaPatchCandidates: [] });
  }

  async initializePersona(request: PersonaInitializeRequest): Promise<PersonaVersion> {
    return Promise.resolve({
      id: randomUUID(),
      profileId: request.userId,
      version: 1,
      content: {
        identity: {},
        values: [],
        socialStyle: {},
        communicationStyle: {},
        relationshipNeeds: [],
        boundaries: [],
        interests: [],
        currentGoals: [],
        confirmedPatterns: [],
        uncertainHypotheses: ["Journey draft requires user review."],
      },
      changeSummary: "Initialized from Journey answers",
      confirmedByUser: false,
      createdAt: new Date().toISOString(),
    });
  }

  async suggestPersonaPatch(_request: AgentReflectionRequest): Promise<PersonaPatchCandidate[]> {
    return Promise.resolve([]);
  }

  async runSocialAction(request: SocialMission): Promise<SocialMissionResult> {
    return Promise.resolve({
      missionId: request.missionId,
      summary: "Mock social action completed without contacting a real user.",
      interestingPoints: [],
      sharedTopics: [],
      conflicts: [],
      openQuestions: [],
      recommendationCandidate: false,
      confidence: 0,
      turnsUsed: 0,
      stopReason: "mock-provider",
    });
  }

  async evaluateSocialInteraction(request: SocialMissionResult): Promise<SocialMissionResult> {
    return Promise.resolve(request);
  }

  private assertAvailable(): void {
    if (this.failureMode === "timeout") {
      throw new AgentClientError("AGENT_TIMEOUT", "Mock Agent timed out", true);
    }
    if (this.failureMode === "unavailable") {
      throw new AgentClientError("AGENT_UNAVAILABLE", "Mock Agent is unavailable", true);
    }
    if (this.failureMode === "invalid_schema") {
      throw new AgentClientError(
        "AGENT_INVALID_RESPONSE",
        "Mock Agent returned invalid schema",
        false,
      );
    }
  }
}
