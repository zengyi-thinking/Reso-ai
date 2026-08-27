import { z } from "zod";
import { ConfidenceSchema, IsoDateTimeSchema, UuidSchema } from "./common.js";

export const MemoryTypeSchema = z.enum([
  "episodic",
  "persona_related",
  "relationship",
  "correction",
  "reflection",
]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemorySchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  type: MemoryTypeSchema,
  summary: z.string().min(1),
  sourceEventId: UuidSchema.nullable(),
  occurredAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
});
export type Memory = z.infer<typeof MemorySchema>;

export const MemoryContextSchema = MemorySchema.extend({
  importance: ConfidenceSchema.default(0.5),
  relationshipRelevance: ConfidenceSchema.default(0),
  topics: z.array(z.string()).default([]),
  embedding: z.array(z.number()).optional(),
  enabled: z.boolean().default(true),
  conflictsWith: z.array(UuidSchema).default([]),
});
export type MemoryContext = z.infer<typeof MemoryContextSchema>;

export const RetrievalScoreSchema = z.object({
  semantic: z.number().min(0),
  recency: z.number().min(0),
  importance: z.number().min(0),
  type: z.number().min(0),
  relationship: z.number().min(0),
  correctionBoost: z.number().min(0),
  final: z.number().min(0),
  reason: z.string().min(1),
});
export type RetrievalScore = z.infer<typeof RetrievalScoreSchema>;

export const MemoryCandidateSchema = z.object({
  type: MemoryTypeSchema,
  summary: z.string().min(1),
  evidenceMessageIds: z.array(UuidSchema),
  confidence: ConfidenceSchema,
  requiresReview: z.boolean(),
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;
