import { z } from "zod";
import { DisclosureDecisionSchema } from "./consent.js";
import { DisclosureLevelSchema, IsoDateTimeSchema, UuidSchema } from "./common.js";

export const TeaPartyStatusSchema = z.enum([
  "not_available",
  "permission_required",
  "queued",
  "running",
  "ready",
  "failed",
  "blocked",
  "cancelled",
]);
export type TeaPartyStatus = z.infer<typeof TeaPartyStatusSchema>;

export const TeaPartyStopReasonSchema = z.enum([
  "max_turns",
  "agent_requested",
  "budget_exhausted",
  "consent_revoked",
  "relationship_blocked",
  "disclosure_blocked",
  "agent_failed",
  "cancelled",
]);
export type TeaPartyStopReason = z.infer<typeof TeaPartyStopReasonSchema>;

export const TeaPartyAgentMessageSchema = z.object({
  id: UuidSchema,
  turnNo: z.number().int().min(1).max(8),
  speakerAgentId: UuidSchema,
  content: z.string().min(1).max(2_000),
  createdAt: IsoDateTimeSchema,
});
export type TeaPartyAgentMessage = z.infer<typeof TeaPartyAgentMessageSchema>;

export const SocialActRequestSchema = z.object({
  missionId: UuidSchema,
  connectionId: UuidSchema,
  turnNo: z.number().int().min(1).max(8),
  speakerAgentId: UuidSchema,
  listenerAgentId: UuidSchema,
  priorMessages: z.array(TeaPartyAgentMessageSchema).max(8),
  disclosureLevel: DisclosureLevelSchema,
  maxContentLength: z.number().int().min(1).max(2_000),
  idempotencyKey: z.string().min(1).max(200),
  traceId: UuidSchema,
});
export type SocialActRequest = z.infer<typeof SocialActRequestSchema>;

export const SocialActResponseSchema = z.object({
  speakerAgentId: UuidSchema,
  content: z.string().min(1).max(2_000),
  disclosure: DisclosureDecisionSchema,
  shouldStop: z.boolean(),
  stopReason: TeaPartyStopReasonSchema.nullable(),
  traceId: UuidSchema,
  agentVersionId: UuidSchema.nullable(),
});
export type SocialActResponse = z.infer<typeof SocialActResponseSchema>;

export const SocialEvaluateRequestSchema = z.object({
  missionId: UuidSchema,
  messages: z.array(TeaPartyAgentMessageSchema).min(1).max(8),
  traceId: UuidSchema,
});
export type SocialEvaluateRequest = z.infer<typeof SocialEvaluateRequestSchema>;

export const TeaPartySummarySchema = z.object({
  headline: z.string().min(1).max(300),
  conversationStarter: z.string().min(1).max(500),
});
export type TeaPartySummary = z.infer<typeof TeaPartySummarySchema>;

export const SocialEvaluateResponseSchema = z.object({
  summary: TeaPartySummarySchema,
  traceId: UuidSchema,
});
export type SocialEvaluateResponse = z.infer<typeof SocialEvaluateResponseSchema>;

export const TeaPartyMessageViewSchema = TeaPartyAgentMessageSchema.extend({
  speakerLabel: z.enum(["my_agent", "their_agent"]),
});
export type TeaPartyMessageView = z.infer<typeof TeaPartyMessageViewSchema>;

export const TeaPartyResponseSchema = z.object({
  status: TeaPartyStatusSchema,
  sessionId: UuidSchema.nullable(),
  messages: z.array(TeaPartyMessageViewSchema),
  summary: TeaPartySummarySchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  retryable: z.boolean(),
  traceId: UuidSchema.nullable(),
});
export type TeaPartyResponse = z.infer<typeof TeaPartyResponseSchema>;
