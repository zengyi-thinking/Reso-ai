import {
  AgentReflectionResponseSchema,
  AgentTurnResponseSchema,
  ApiErrorSchema,
  PersonaVersionSchema,
  SocialMissionResultSchema,
  type AgentReflectionRequest,
  type AgentReflectionResponse,
  type AgentTurnRequest,
  type AgentTurnResponse,
  type PersonaInitializeRequest,
  type PersonaPatchCandidate,
  type PersonaVersion,
  type SocialMission,
  type SocialMissionResult,
} from "@reso/contracts";
import type { z } from "zod";
import type { IAgentClient } from "./agent-client.js";

export class AgentClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentClientError";
  }
}

export class ResoAgentClient implements IAgentClient {
  constructor(private readonly baseUrl: string) {}

  async turn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
    return this.post("/v1/agent/turn", request, AgentTurnResponseSchema);
  }

  async reflect(request: AgentReflectionRequest): Promise<AgentReflectionResponse> {
    return this.post("/v1/agent/reflect", request, AgentReflectionResponseSchema);
  }

  async initializePersona(request: PersonaInitializeRequest): Promise<PersonaVersion> {
    return this.post("/v1/persona/initialize", request, PersonaVersionSchema);
  }

  async suggestPersonaPatch(request: AgentReflectionRequest): Promise<PersonaPatchCandidate[]> {
    const response = await this.reflect(request);
    return response.personaPatchCandidates;
  }

  async runSocialAction(request: SocialMission): Promise<SocialMissionResult> {
    return this.post("/v1/social/act", request, SocialMissionResultSchema);
  }

  async evaluateSocialInteraction(request: SocialMissionResult): Promise<SocialMissionResult> {
    return this.post("/v1/social/evaluate", request, SocialMissionResultSchema);
  }

  private async post<TSchema extends z.ZodType>(
    path: string,
    body: unknown,
    schema: TSchema,
  ): Promise<z.infer<TSchema>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const parsed = ApiErrorSchema.safeParse(payload);
      throw new AgentClientError(
        parsed.success ? parsed.data.error.message : "Reso Agent request failed.",
        parsed.success ? parsed.data.error.code : "invalid_agent_error",
        response.status,
      );
    }

    return schema.parse(await response.json());
  }
}
