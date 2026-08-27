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
} from "@reso/contracts";

export interface IAgentClient {
  analyzeIncoming(request: AnalyzeIncomingRequest): Promise<AnalyzeIncomingResponse>;
  polishDraft(request: PolishDraftRequest): Promise<PolishDraftResponse>;
  actSocially(request: SocialActRequest): Promise<SocialActResponse>;
  evaluateSocial(request: SocialEvaluateRequest): Promise<SocialEvaluateResponse>;
  generatePersonalManual(
    request: PersonalManualGenerationRequest,
  ): Promise<PersonalManualCandidate>;
  turn(request: AgentTurnRequest): Promise<AgentTurnResponse>;
  reflect(request: AgentReflectionRequest): Promise<AgentReflectionResponse>;
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
