import { z } from "zod";
import { AgentModeSchema, UuidSchema } from "./common.js";
import { MemoryCandidateSchema, MemoryContextSchema } from "./memory.js";
import { PersonaContentSchema, PersonaPatchCandidateSchema } from "./persona.js";
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
  context: z
    .object({
      persona: z
        .object({
          versionId: UuidSchema,
          version: z.string().min(1),
          content: PersonaContentSchema,
        })
        .nullable(),
      memories: z.array(MemoryContextSchema),
      relationship: z
        .object({
          state: z.string().min(1),
          summary: z.string(),
          interactionCount: z.number().int().nonnegative(),
        })
        .nullable(),
      recentMessages: z.array(
        z.object({ id: UuidSchema, role: z.enum(["user", "agent"]), content: z.string().min(1) }),
      ),
    })
    .optional(),
});
export type AgentTurnRequest = z.infer<typeof AgentTurnRequestSchema>;

export const AgentTurnResponseSchema = z.object({
  requestId: UuidSchema,
  message: z.string().min(1),
  mode: AgentModeSchema,
  memoryCandidates: z.array(MemoryCandidateSchema),
  personaPatchCandidates: z.array(PersonaPatchCandidateSchema),
  relationshipCandidates: z.array(
    z.object({
      summary: z.string().min(1),
      reason: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
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
