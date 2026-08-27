import { createAgentTurnRequest } from "@reso/test-fixtures";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
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
import { buildApp } from "../src/app.js";
import { TestAgentClient } from "./test-agent-client.js";

// A hermetic test double: production code has no mock provider anymore.
class StubAgentClient extends TestAgentClient {
  override async turn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
    return {
      requestId: request.requestId,
      message: "我会先听你说。",
      mode: "companion",
      memoryCandidates: [],
      personaPatchCandidates: [],
      relationshipCandidates: [],
      cadence: "direct",
      publicEvents: [{ type: "message", position: "final", text: "我会先听你说。" }],
      traceId: request.requestId,
    };
  }

  override async reflect(_request: AgentReflectionRequest): Promise<AgentReflectionResponse> {
    return { memoryCandidates: [], personaPatchCandidates: [] };
  }

  override async initializePersona(_request: PersonaInitializeRequest): Promise<PersonaVersion> {
    throw new Error("not needed in these tests");
  }

  override async suggestPersonaPatch(
    _request: AgentReflectionRequest,
  ): Promise<PersonaPatchCandidate[]> {
    return [];
  }

  override async runSocialAction(_request: SocialMission): Promise<SocialMissionResult> {
    throw new Error("not needed in these tests");
  }

  override async evaluateSocialInteraction(
    request: SocialMissionResult,
  ): Promise<SocialMissionResult> {
    return request;
  }
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("Reso Product API", () => {
  it("reports health", async () => {
    app = await buildApp({ agentClient: new StubAgentClient() });
    const response = await app.inject({ method: "GET", url: "/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: "reso-api", status: "ok" });
  });

  it("returns AgentTurn responses that satisfy the shared contract", async () => {
    app = await buildApp({ agentClient: new StubAgentClient() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/agent/turn",
      payload: createAgentTurnRequest(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mode: "companion" });
    expect(response.json().publicEvents).toHaveLength(1);
  });

  it("rejects undocumented request shapes", async () => {
    app = await buildApp({ agentClient: new StubAgentClient() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/agent/turn",
      payload: { message: "missing identity fields" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "invalid_request", message: expect.any(String) },
    });
  });

  it("uses the stable error envelope for unknown routes", async () => {
    app = await buildApp({ agentClient: new StubAgentClient() });
    const response = await app.inject({ method: "GET", url: "/v1/not-real" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "route_not_found", message: "The requested route does not exist." },
    });
  });
});
