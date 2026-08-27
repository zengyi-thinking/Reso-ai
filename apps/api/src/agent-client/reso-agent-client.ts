import {
  AgentReflectionResponseSchema,
  AgentTurnResponseSchema,
  AgentStatusEventSchema,
  AgentStreamErrorEventSchema,
  AgentTurnResultEventSchema,
  ApiErrorSchema,
  EmbeddingsResponseSchema,
  PersonaVersionSchema,
  SocialMissionResultSchema,
  type AgentReflectionRequest,
  type AgentReflectionResponse,
  type AgentTurnRequest,
  type AgentTurnResponse,
  type AgentStatusEvent,
  type EmbeddingsRequest,
  type EmbeddingsResponse,
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
  QuickStartPersonaDraftResponseSchema,
  type QuickStartPersonaDraftRequest,
  type QuickStartPersonaDraftResponse,
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

  async initializeQuickStartPersona(
    request: QuickStartPersonaDraftRequest,
  ): Promise<QuickStartPersonaDraftResponse> {
    return this.post("/v1/persona/quick-start", request, QuickStartPersonaDraftResponseSchema);
  }

  async turn(
    request: AgentTurnRequest,
    onProgress?: (event: AgentStatusEvent) => void,
  ): Promise<AgentTurnResponse> {
    if (onProgress === undefined) {
      return this.post("/v1/agent/turn", request, AgentTurnResponseSchema);
    }
    return this.streamTurn(request, onProgress);
  }

  private async streamTurn(
    request: AgentTurnRequest,
    onProgress: (event: AgentStatusEvent) => void,
  ): Promise<AgentTurnResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "text/event-stream",
      };
      if (this.serviceToken !== undefined && this.serviceToken.length > 0) {
        headers.authorization = `Bearer ${this.serviceToken}`;
      }
      const response = await this.fetchImplementation(`${this.baseUrl}/v1/agent/turn/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok || response.body === null) {
        throw new AgentClientError(
          response.status === 504 ? "AGENT_TIMEOUT" : "AGENT_UNAVAILABLE",
          `Reso Agent stream failed with status ${response.status}`,
          response.status === 429 || response.status >= 500,
          response.status,
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: AgentTurnResponse | null = null;
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((item) => item.startsWith("data: "));
          if (line === undefined) continue;
          const payload: unknown = JSON.parse(line.slice(6));
          const status = AgentStatusEventSchema.safeParse(payload);
          if (status.success) {
            onProgress(status.data);
            continue;
          }
          const terminal = AgentTurnResultEventSchema.safeParse(payload);
          if (terminal.success) {
            result = terminal.data.response;
            continue;
          }
          const failure = AgentStreamErrorEventSchema.safeParse(payload);
          if (failure.success) {
            throw new AgentClientError(
              "AGENT_UNAVAILABLE",
              failure.data.text,
              failure.data.retryable,
            );
          }
          throw new AgentClientError(
            "AGENT_INVALID_RESPONSE",
            "Reso Agent stream returned an undocumented event",
            false,
          );
        }
        if (done) break;
      }
      if (result === null) {
        throw new AgentClientError(
          "AGENT_INVALID_RESPONSE",
          "Reso Agent stream ended without a turn result",
          false,
        );
      }
      return result;
    } catch (error) {
      if (error instanceof AgentClientError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AgentClientError("AGENT_TIMEOUT", "Reso Agent request timed out", true);
      }
      throw new AgentClientError("AGENT_UNAVAILABLE", "Reso Agent stream failed", true);
    } finally {
      clearTimeout(timeout);
    }
  }

  async reflect(request: AgentReflectionRequest): Promise<AgentReflectionResponse> {
    return this.post("/v1/agent/reflect", request, AgentReflectionResponseSchema);
  }

  async embedTexts(request: EmbeddingsRequest): Promise<EmbeddingsResponse> {
    return this.post("/v1/embeddings", request, EmbeddingsResponseSchema);
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
