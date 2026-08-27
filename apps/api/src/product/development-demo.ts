import type { FastifyRequest } from "fastify";
import { AgentClientError, type IAgentClient } from "../agent-client/agent-client.js";
import { InMemoryProductRepository } from "./in-memory-repository.js";
import { TeaPartyService } from "./tea-party-service.js";

export const demoIds = {
  userA: "0198d4f3-2f34-7c52-95cc-7ff4f6f93a01",
  userB: "0198d4f3-2f34-7c52-95cc-7ff4f6f93a02",
  userC: "0198d4f3-2f34-7c52-95cc-7ff4f6f93a03",
  agentA: "0198d4f3-2f34-7c52-95cc-7ff4f6f93b01",
  agentB: "0198d4f3-2f34-7c52-95cc-7ff4f6f93b02",
  connection: "0198d4f3-2f34-7c52-95cc-7ff4f6f93c01",
  incomingMessage: "0198d4f3-2f34-7c52-95cc-7ff4f6f93d01",
  trace: "0198d4f3-2f34-7c52-95cc-7ff4f6f93e01",
} as const;

const demoSessions: Readonly<Record<string, string>> = {
  "demo-user-a": demoIds.userA,
  "demo-user-b": demoIds.userB,
  "demo-third-party": demoIds.userC,
};

export function createDevelopmentRepository(): InMemoryProductRepository {
  return new InMemoryProductRepository({
    connections: [
      {
        id: demoIds.connection,
        userAId: demoIds.userA,
        userBId: demoIds.userB,
        agentAId: demoIds.agentA,
        agentBId: demoIds.agentB,
        status: "established",
        userAProxyConsent: true,
        userBProxyConsent: true,
        blockedByUserId: null,
        establishedAt: "2026-08-26T08:00:00+08:00",
      },
    ],
    messages: [
      {
        id: demoIds.incomingMessage,
        connectionId: demoIds.connection,
        senderUserId: demoIds.userB,
        content: "周末有空的话，要不要一起找家安静的咖啡馆？",
        clientMessageId: "demo-incoming-message",
        traceId: demoIds.trace,
        createdAt: "2026-08-26T08:00:01+08:00",
      },
    ],
  });
}

export async function prepareDevelopmentDemo(
  repository: InMemoryProductRepository,
  agentClient: IAgentClient,
): Promise<void> {
  const teaParty = new TeaPartyService(repository, agentClient);
  await teaParty.onRelationshipEstablished(demoIds.connection, demoIds.trace);
  try {
    await teaParty.run(demoIds.connection);
  } catch (error) {
    // Provider failures are an expected development scenario. TeaPartyService
    // has already persisted the failed mission, so keep the Product API online
    // for retry, degraded-state, and human-chat testing.
    if (error instanceof AgentClientError) return;
    throw error;
  }
}

export async function resolveDevelopmentSession(request: FastifyRequest): Promise<string | null> {
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return null;
  return demoSessions[authorization.slice("Bearer ".length)] ?? null;
}
