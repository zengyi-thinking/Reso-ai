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

export const ConversationCadenceSchema = z.enum([
  "direct",
  "considered",
  "reflective",
  "reconsidered",
]);
export type ConversationCadence = z.infer<typeof ConversationCadenceSchema>;

export const AgentStatusPhaseSchema = z.enum([
  "understanding",
  "recalling",
  "noticing",
  "composing",
  "reconsidering",
]);
export type AgentStatusPhase = z.infer<typeof AgentStatusPhaseSchema>;

export const AgentStatusEventSchema = z.object({
  type: z.literal("status"),
  phase: AgentStatusPhaseSchema,
  text: z.string().min(1).max(80),
});

export const AgentPublicReflectionEventSchema = z.object({
  type: z.literal("public_reflection"),
  text: z.string().min(1).max(160),
  evidenceRefs: z
    .array(z.string().regex(/^(memory|persona):\d+$|^message:current$/))
    .min(1)
    .max(3),
});

export const AgentMessageEventSchema = z.object({
  type: z.literal("message"),
  position: z.enum(["tentative", "continuation", "final"]),
  text: z.string().min(1).max(600),
});

export const AgentPublicEventSchema = z.discriminatedUnion("type", [
  AgentStatusEventSchema,
  AgentPublicReflectionEventSchema,
  AgentMessageEventSchema,
]);
export type AgentPublicEvent = z.infer<typeof AgentPublicEventSchema>;

export const AgentPublicOutputSchema = z
  .object({
    cadence: ConversationCadenceSchema,
    events: z.array(AgentPublicEventSchema).min(1).max(5),
  })
  .superRefine((value, context) => {
    const statuses = value.events.filter((event) => event.type === "status");
    const reflections = value.events.filter((event) => event.type === "public_reflection");
    const messages = value.events.filter((event) => event.type === "message");
    if (!messages.some((event) => event.position === "final")) {
      context.addIssue({ code: "custom", message: "public output requires a final message" });
    }
    if (statuses.length > 2 || reflections.length > 1 || messages.length > 2) {
      context.addIssue({ code: "custom", message: "public output exceeds the breathing budget" });
    }
  });
export type AgentPublicOutput = z.infer<typeof AgentPublicOutputSchema>;

export const AgentMessageDeltaEventSchema = z.object({
  type: z.literal("message_delta"),
  text: z.string().min(1).max(120),
});
export type AgentMessageDeltaEvent = z.infer<typeof AgentMessageDeltaEventSchema>;

export const AgentStreamCompleteEventSchema = z.object({
  type: z.literal("complete"),
  turnId: UuidSchema,
  traceId: UuidSchema,
});

export const AgentStreamErrorEventSchema = z.object({
  type: z.literal("error"),
  code: z.string().min(1),
  text: z.string().min(1),
  retryable: z.boolean(),
});

export const AgentStreamEventSchema = z.discriminatedUnion("type", [
  AgentStatusEventSchema,
  AgentPublicReflectionEventSchema,
  AgentMessageEventSchema,
  AgentMessageDeltaEventSchema,
  AgentStreamCompleteEventSchema,
  AgentStreamErrorEventSchema,
]);
export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;

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
      activeProxyConsent: z.boolean().default(false),
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
  cadence: ConversationCadenceSchema.default("direct"),
  publicEvents: z.array(AgentPublicEventSchema).default([]),
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
