import { z } from "zod";
import {
  CandidateStatusSchema,
  ConfidenceSchema,
  IsoDateTimeSchema,
  UuidSchema,
} from "./common.js";

export const PersonaContentSchema = z.object({
  identity: z.record(z.string(), z.unknown()).default({}),
  values: z.array(z.string()).default([]),
  socialStyle: z.record(z.string(), z.unknown()).default({}),
  communicationStyle: z.record(z.string(), z.unknown()).default({}),
  relationshipNeeds: z.array(z.string()).default([]),
  boundaries: z.array(z.string()).default([]),
  interests: z.array(z.string()).default([]),
  currentGoals: z.array(z.string()).default([]),
  confirmedPatterns: z.array(z.string()).default([]),
  uncertainHypotheses: z.array(z.string()).default([]),
});
export type PersonaContent = z.infer<typeof PersonaContentSchema>;

export const PersonaProfileSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  currentVersionId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PersonaProfile = z.infer<typeof PersonaProfileSchema>;

export const PersonaVersionSchema = z.object({
  id: UuidSchema,
  profileId: UuidSchema,
  version: z.number().int().positive(),
  content: PersonaContentSchema,
  changeSummary: z.string().min(1),
  confirmedByUser: z.boolean(),
  createdAt: IsoDateTimeSchema,
});
export type PersonaVersion = z.infer<typeof PersonaVersionSchema>;

export const PersonaPatchCandidateSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  fromVersionId: UuidSchema,
  path: z.string().min(1),
  oldValue: z.unknown(),
  proposedValue: z.unknown(),
  reason: z.string().min(1),
  evidenceIds: z.array(UuidSchema).min(1),
  confidence: ConfidenceSchema,
  status: CandidateStatusSchema,
  createdAt: IsoDateTimeSchema,
  confirmedAt: IsoDateTimeSchema.nullable(),
});
export type PersonaPatchCandidate = z.infer<typeof PersonaPatchCandidateSchema>;

export const PersonaInitializeRequestSchema = z.object({
  userId: UuidSchema,
  journeyId: UuidSchema,
  answers: z.array(z.object({ questionId: z.string().min(1), choiceId: z.string().min(1) })),
});
export type PersonaInitializeRequest = z.infer<typeof PersonaInitializeRequestSchema>;
