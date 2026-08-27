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
  AnalyzeIncomingResponseSchema,
  PolishDraftResponseSchema,
  SocialActResponseSchema,
  SocialEvaluateResponseSchema,
  type AnalyzeIncomingRequest,
  type AnalyzeIncomingResponse,
  type PolishDraftRequest,
  type PolishDraftResponse,
  type SocialActRequest,
  type SocialActResponse,
  type SocialEvaluateRequest,
  type SocialEvaluateResponse,
  PersonalManualCandidateSchema,
  type PersonalManualCandidate,
  type PersonalManualGenerationRequest,
} from "@reso/contracts";
import type { z } from "zod";
import { AgentClientError, type IAgentClient } from "./agent-client.js";

export interface ResoAgentClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  serviceToken?: string;
  fetchImplementation?: typeof fetch;
}

export class ResoAgentClient implements IAgentClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly serviceToken: string | undefined;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: string | ResoAgentClientOptions) {
    const normalized = typeof options === "string" ? { baseUrl: options } : options;
    this.baseUrl = normalized.baseUrl.replace(/\/$/, "");
    this.timeoutMs = normalized.timeoutMs ?? 15_000;
    this.serviceToken = normalized.serviceToken;
    this.fetchImplementation = normalized.fetchImplementation ?? fetch;
  }

  async analyzeIncoming(request: AnalyzeIncomingRequest): Promise<AnalyzeIncomingResponse> {
    return this.post("/v1/assist/analyze", request, AnalyzeIncomingResponseSchema);
  }

  async polishDraft(request: PolishDraftRequest): Promise<PolishDraftResponse> {
    return this.post("/v1/assist/polish", request, PolishDraftResponseSchema);
  }

  async actSocially(request: SocialActRequest): Promise<SocialActResponse> {
    return this.post("/v1/tea-party/act", request, SocialActResponseSchema);
  }

  async evaluateSocial(request: SocialEvaluateRequest): Promise<SocialEvaluateResponse> {
    return this.post("/v1/tea-party/evaluate", request, SocialEvaluateResponseSchema);
  }

  async generatePersonalManual(
    request: PersonalManualGenerationRequest,
  ): Promise<PersonalManualCandidate> {
    return this.post("/v1/personal-manual/generate", request, PersonalManualCandidateSchema);
  }

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.serviceToken !== undefined && this.serviceToken.length > 0) {
        headers.authorization = `Bearer ${this.serviceToken}`;
      }
      const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new AgentClientError(
          response.status === 504 ? "AGENT_TIMEOUT" : "AGENT_UNAVAILABLE",
          parsed.success
            ? parsed.data.error.message
            : `Reso Agent request failed with status ${response.status}`,
          response.status === 429 || response.status >= 500,
          response.status,
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AgentClientError(
          "AGENT_INVALID_RESPONSE",
          "Reso Agent returned invalid JSON",
          false,
        );
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new AgentClientError(
          "AGENT_INVALID_RESPONSE",
          "Reso Agent response did not match the shared contract",
          false,
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AgentClientError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AgentClientError("AGENT_TIMEOUT", "Reso Agent request timed out", true);
      }
      throw new AgentClientError("AGENT_UNAVAILABLE", "Reso Agent request failed", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
