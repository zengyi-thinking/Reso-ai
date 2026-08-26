import { z } from "zod";
import { AgentPublicEventSchema, ConversationCadenceSchema } from "./agent.js";
import { AgentModeSchema, IsoDateTimeSchema, UuidSchema } from "./common.js";
import { MemoryContextSchema, MemoryTypeSchema, RetrievalScoreSchema } from "./memory.js";
import { PersonaContentSchema, PersonaPatchCandidateSchema } from "./persona.js";

export const LabUserSchema = z.object({
  id: UuidSchema,
  slug: z.string().min(1),
  displayName: z.string().min(1),
  personaVersion: z.string().min(1),
});
export type LabUser = z.infer<typeof LabUserSchema>;

export const LabSessionCreateRequestSchema = z.object({
  userSlug: z.string().min(1),
});
export type LabSessionCreateRequest = z.infer<typeof LabSessionCreateRequestSchema>;

export const LabTurnRequestSchema = z.object({
  message: z.string().min(1).max(20_000),
  requestedMode: AgentModeSchema.optional(),
  replayTurnId: UuidSchema.optional(),
});
export type LabTurnRequest = z.infer<typeof LabTurnRequestSchema>;

export const LabTurnSchema = z.object({
  id: UuidSchema,
  createdAt: IsoDateTimeSchema,
  input: z.string().min(1),
  response: z.string().min(1),
  mode: AgentModeSchema,
  modeReason: z.string().min(1),
  promptVersion: z.string().min(1),
  personaVersion: z.string().min(1),
  personaFields: z.array(z.string()),
  retrievedMemories: z.array(
    z.object({ memory: MemoryContextSchema, score: RetrievalScoreSchema }),
  ),
  contextSummary: z.object({
    personaFields: z.array(z.string()),
    memoryIds: z.array(UuidSchema),
    recentMessageCount: z.number().int().nonnegative(),
    relationshipIncluded: z.boolean(),
  }),
  model: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    latencyMs: z.number().int().nonnegative(),
    promptTokens: z.number().int().nonnegative().nullable(),
    completionTokens: z.number().int().nonnegative().nullable(),
  }),
  memoryCandidateIds: z.array(UuidSchema),
  memoryWrites: z
    .array(
      z.object({
        id: UuidSchema,
        type: MemoryTypeSchema,
        summary: z.string().min(1),
        requiresReview: z.boolean(),
      }),
    )
    .default([]),
  personaPatchCandidates: z.array(PersonaPatchCandidateSchema),
  relationshipCandidates: z.array(
    z.object({ summary: z.string(), reason: z.string(), confidence: z.number() }),
  ),
  cadence: ConversationCadenceSchema,
  publicEvents: z.array(AgentPublicEventSchema),
  eval: z.array(
    z.object({ id: z.string().min(1), passed: z.boolean(), detail: z.string().min(1) }),
  ),
  traceId: UuidSchema,
  replayOf: UuidSchema.nullable(),
});
export type LabTurn = z.infer<typeof LabTurnSchema>;

export const LabSessionSchema = z.object({
  id: UuidSchema,
  user: LabUserSchema,
  provider: z.enum(["deterministic", "real"]),
  createdAt: IsoDateTimeSchema,
  persona: z.object({ version: z.string(), content: PersonaContentSchema }),
  pendingPatches: z.array(PersonaPatchCandidateSchema),
  memories: z.array(MemoryContextSchema),
  turns: z.array(LabTurnSchema),
});
export type LabSession = z.infer<typeof LabSessionSchema>;

export const LabMemoryWriteSchema = z.object({
  id: UuidSchema,
  type: MemoryTypeSchema,
  summary: z.string().min(1),
  requiresReview: z.boolean(),
});
export type LabMemoryWrite = z.infer<typeof LabMemoryWriteSchema>;

export const LabMemoryUpdateSchema = z.object({ enabled: z.boolean() });
export type LabMemoryUpdate = z.infer<typeof LabMemoryUpdateSchema>;

export const LabPatchDecisionSchema = z.object({
  decision: z.enum(["accept", "reject", "edit"]),
  proposedValue: z.unknown().optional(),
});
export type LabPatchDecision = z.infer<typeof LabPatchDecisionSchema>;
