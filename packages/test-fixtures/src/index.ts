import type { AgentTurnRequest } from "@reso/contracts";

export * from "./user-alice.js";

export const fixtureId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12";

export function createAgentTurnRequest(
  overrides: Partial<AgentTurnRequest> = {},
): AgentTurnRequest {
  return {
    requestId: fixtureId,
    userId: fixtureId,
    agentId: fixtureId,
    conversationId: fixtureId,
    message: "今天有点累。",
    personaVersionId: null,
    ...overrides,
  };
}
