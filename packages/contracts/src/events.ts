import { z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "./common.js";

export const EventTypeSchema = z.enum([
  "user.created",
  "journey.started",
  "journey.choice_made",
  "journey.completed",
  "persona.created",
  "persona.updated",
  "message.created",
  "relationship.created",
  "relationship.updated",
  "social_mission.created",
  "social_mission.completed",
  "recommendation.created",
  "consent.granted",
  "consent.revoked",
  "relationship.blocked",
  "tea_party.started",
  "tea_party.ready",
  "tea_party.failed",
  "agent_assist.completed",
  "agent_assist.failed",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventEnvelopeSchema = z.object({
  id: UuidSchema,
  type: EventTypeSchema,
  version: z.literal(1),
  occurredAt: IsoDateTimeSchema,
  producer: z.string().min(1),
  correlationId: UuidSchema,
  causationId: UuidSchema.nullable(),
  subjectId: UuidSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
