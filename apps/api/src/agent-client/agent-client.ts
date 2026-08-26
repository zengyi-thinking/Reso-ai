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

export interface IAgentClient {
  turn(request: AgentTurnRequest): Promise<AgentTurnResponse>;
  reflect(request: AgentReflectionRequest): Promise<AgentReflectionResponse>;
  initializePersona(request: PersonaInitializeRequest): Promise<PersonaVersion>;
  suggestPersonaPatch(request: AgentReflectionRequest): Promise<PersonaPatchCandidate[]>;
  runSocialAction(request: SocialMission): Promise<SocialMissionResult>;
  evaluateSocialInteraction(request: SocialMissionResult): Promise<SocialMissionResult>;
}
