import { randomUUID } from "node:crypto";
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
} from "@reso/contracts";
import type { IAgentClient } from "./agent-client.js";

export class MockAgentClient implements IAgentClient {
  async turn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
    const isCorrection = /不是|不对|并非|not really/i.test(request.message);
    const message = isCorrection
      ? "谢谢你纠正我。我会把这次纠正作为高优先级记忆，而不是直接给你贴标签。"
      : "听起来你今天需要一点轻松的空间。我们可以先不分析，只慢一点聊。";

    return Promise.resolve({
      requestId: request.requestId,
      message,
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
      cadence: "direct",
      publicEvents: [{ type: "message", position: "final", text: message }],
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
}
