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
  PersonalManualCandidate,
  PersonalManualGenerationRequest,
  PersonalManualVariableId,
  PersonalManualSectionId,
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

  async generatePersonalManual(
    request: PersonalManualGenerationRequest,
  ): Promise<PersonalManualCandidate> {
    this.assertAvailable();
    const variableDefinitions = [
      ["crisisInstinct", "危机中的行动起点"],
      ["involuntaryReaction", "压力下的自然反应"],
      ["incompatiblePattern", "需要谨慎相处的模式"],
      ["possibleMisreading", "可能出现的相互误读"],
      ["negativeFeeling", "冲突中容易出现的感受"],
      ["relationshipRedLine", "关系中的重要边界"],
      ["repairAction", "更容易接住的修复行动"],
      ["recoveryNeed", "恢复连接时的需要"],
      ["lifeVision", "当前显现的人生方向"],
    ] satisfies ReadonlyArray<readonly [PersonalManualVariableId, string]>;
    const sectionDefinitions = [
      ["deepNeed", "表层标签与深层关系需求"],
      ["defense", "极限压力下的防御本能"],
      ["incompatible", "冲突与需要避开的模式"],
      ["repair", "合适的冲突修复与支持蓝图"],
      ["vision", "人生愿景与关系方向"],
    ] satisfies ReadonlyArray<readonly [PersonalManualSectionId, string]>;
    const variables = variableDefinitions.map(([id, name], index) => {
      const item = request.evidence[index % request.evidence.length];
      if (item === undefined) throw new Error("Mock Personal Manual requires Journey evidence");
      const confidence: "low" | "medium" = item.choiceId === "free-response" ? "low" : "medium";
      return {
        id,
        name,
        description: `${item.summary}。这是基于当前旅程证据的可修正理解，不是固定人格结论。`,
        confidence,
        evidenceRefs: [item.evidenceRef],
      };
    });
    const sections = sectionDefinitions.map(([id, title], index) => {
      const first = request.evidence[index % request.evidence.length];
      const second = request.evidence[(index + 1) % request.evidence.length];
      if (first === undefined || second === undefined) {
        throw new Error("Mock Personal Manual requires Journey evidence");
      }
      const confidence = "medium" as const;
      return {
        id,
        title,
        content: `${first.summary}；同时，${second.summary}。后续真实经历可以继续补充或纠正这一理解。`,
        confidence,
        evidenceRefs: [first.evidenceRef, second.evidenceRef],
      };
    });
    return Promise.resolve({
      variables,
      sections,
      updateSummary: `根据 ${request.evidence.length} 条 Journey Evidence 生成首版个人说明书。`,
      traceId: request.traceId,
      agentVersionId: null,
      modelVersion: "mock-personal-manual-v1",
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
