import type {
  AgentReflectionRequest,
  AgentReflectionResponse,
  AgentTurnRequest,
  AgentTurnResponse,
  AgentStatusEvent,
  EmbeddingsRequest,
  EmbeddingsResponse,
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
  QuickStartPersonaDraftRequest,
  QuickStartPersonaDraftResponse,
} from "@reso/contracts";

export interface IAgentClient {
  initializeQuickStartPersona(
    request: QuickStartPersonaDraftRequest,
  ): Promise<QuickStartPersonaDraftResponse>;
  analyzeIncoming(request: AnalyzeIncomingRequest): Promise<AnalyzeIncomingResponse>;
  polishDraft(request: PolishDraftRequest): Promise<PolishDraftResponse>;
  actSocially(request: SocialActRequest): Promise<SocialActResponse>;
  evaluateSocial(request: SocialEvaluateRequest): Promise<SocialEvaluateResponse>;
  generatePersonalManual(
    request: PersonalManualGenerationRequest,
  ): Promise<PersonalManualCandidate>;
  turn(
    request: AgentTurnRequest,
    onProgress?: (event: AgentStatusEvent) => void,
  ): Promise<AgentTurnResponse>;
  reflect(request: AgentReflectionRequest): Promise<AgentReflectionResponse>;
  embedTexts(request: EmbeddingsRequest): Promise<EmbeddingsResponse>;
  initializePersona(request: PersonaInitializeRequest): Promise<PersonaVersion>;
  suggestPersonaPatch(request: AgentReflectionRequest): Promise<PersonaPatchCandidate[]>;
  runSocialAction(request: SocialMission): Promise<SocialMissionResult>;
  evaluateSocialInteraction(request: SocialMissionResult): Promise<SocialMissionResult>;
}

export type AgentClientErrorCode = "AGENT_TIMEOUT" | "AGENT_UNAVAILABLE" | "AGENT_INVALID_RESPONSE";

export class AgentClientError extends Error {
  constructor(
    public readonly code: AgentClientErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AgentClientError";
  }
}
