import { z } from "zod";
import { IsoDateTimeSchema, SubjectTypeSchema, UuidSchema } from "./common.js";

export const RelationshipSchema = z.object({
  id: UuidSchema,
  subjectType: SubjectTypeSchema,
  subjectId: UuidSchema,
  objectType: SubjectTypeSchema,
  objectId: UuidSchema,
  stage: z.string().min(1),
  familiarity: z.number().min(0).max(1),
  trust: z.number().min(0).max(1),
  interactionCount: z.number().int().nonnegative(),
  sharedTopics: z.array(z.string()),
  openQuestions: z.array(z.string()),
  summary: z.string(),
  lastInteractionAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const RelationshipEventSchema = z.object({
  id: UuidSchema,
  relationshipId: UuidSchema,
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: IsoDateTimeSchema,
});
export type RelationshipEvent = z.infer<typeof RelationshipEventSchema>;
