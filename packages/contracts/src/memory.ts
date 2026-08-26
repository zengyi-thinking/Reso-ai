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

export const MemoryCandidateSchema = z.object({
  type: MemoryTypeSchema,
  summary: z.string().min(1),
  evidenceMessageIds: z.array(UuidSchema),
  confidence: ConfidenceSchema,
  requiresReview: z.boolean(),
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;
