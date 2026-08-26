import { z } from "zod";
import { AgentModeSchema, UuidSchema } from "./common.js";
import { MemoryCandidateSchema } from "./memory.js";
import { PersonaPatchCandidateSchema } from "./persona.js";
import {
  SocialMissionResultSchema,
  SocialMissionSchema,
  type SocialMission,
  type SocialMissionResult,
} from "./social.js";

export const AgentTurnRequestSchema = z.object({
  requestId: UuidSchema,
  userId: UuidSchema,
  agentId: UuidSchema,
  conversationId: UuidSchema,
  message: z.string().min(1).max(20_000),
  requestedMode: AgentModeSchema.optional(),
  personaVersionId: UuidSchema.nullable(),
});
export type AgentTurnRequest = z.infer<typeof AgentTurnRequestSchema>;

export const AgentTurnResponseSchema = z.object({
  requestId: UuidSchema,
  message: z.string().min(1),
  mode: AgentModeSchema,
  memoryCandidates: z.array(MemoryCandidateSchema),
  personaPatchCandidates: z.array(PersonaPatchCandidateSchema),
  traceId: UuidSchema,
});
export type AgentTurnResponse = z.infer<typeof AgentTurnResponseSchema>;

export const AgentReflectionRequestSchema = z.object({
  userId: UuidSchema,
  conversationId: UuidSchema,
  messageIds: z.array(UuidSchema).min(1),
});
export type AgentReflectionRequest = z.infer<typeof AgentReflectionRequestSchema>;

export const AgentReflectionResponseSchema = z.object({
  memoryCandidates: z.array(MemoryCandidateSchema),
  personaPatchCandidates: z.array(PersonaPatchCandidateSchema),
});
export type AgentReflectionResponse = z.infer<typeof AgentReflectionResponseSchema>;

export const SocialActionRequestSchema = SocialMissionSchema;
export type SocialActionRequest = SocialMission;
export const SocialActionResponseSchema = SocialMissionResultSchema;
export type SocialActionResponse = SocialMissionResult;
