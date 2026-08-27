import { z } from "zod";
import { UuidSchema } from "./common.js";

export const AssistStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type AssistStatus = z.infer<typeof AssistStatusSchema>;

export const ReplyRouteSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
  suggestedReply: z.string().min(1).max(2_000),
});
export type ReplyRoute = z.infer<typeof ReplyRouteSchema>;

export const AnalyzeIncomingRequestSchema = z.object({
  requestId: UuidSchema,
  idempotencyKey: z.string().min(1).max(200),
  requesterUserId: UuidSchema,
  connectionId: UuidSchema,
  sourceMessageId: UuidSchema,
  sourceText: z.string().min(1).max(8_000),
  senderUserId: UuidSchema,
  agentId: UuidSchema,
  traceId: UuidSchema,
});
export type AnalyzeIncomingRequest = z.infer<typeof AnalyzeIncomingRequestSchema>;

export const AnalyzeIncomingResponseSchema = z.object({
  interpretation: z.string().min(1).max(4_000),
  replyRoutes: z.array(ReplyRouteSchema).max(5),
  traceId: UuidSchema,
});
export type AnalyzeIncomingResponse = z.infer<typeof AnalyzeIncomingResponseSchema>;

export const PolishCandidateSchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().min(1).max(2_000),
});
export type PolishCandidate = z.infer<typeof PolishCandidateSchema>;

export const PolishDraftRequestSchema = z.object({
  requestId: UuidSchema,
  idempotencyKey: z.string().min(1).max(200),
  requesterUserId: UuidSchema,
  connectionId: UuidSchema,
  draft: z.string().min(1).max(2_000),
  replyToMessageId: UuidSchema.nullable(),
  agentId: UuidSchema,
  traceId: UuidSchema,
});
export type PolishDraftRequest = z.infer<typeof PolishDraftRequestSchema>;

export const PolishDraftResponseSchema = z.object({
  candidates: z.array(PolishCandidateSchema).min(1).max(5),
  traceId: UuidSchema,
});
export type PolishDraftResponse = z.infer<typeof PolishDraftResponseSchema>;

export const AnalyzeAssistBodySchema = z.object({
  messageId: UuidSchema,
  clientRequestId: z.string().min(1).max(200),
});
export type AnalyzeAssistBody = z.infer<typeof AnalyzeAssistBodySchema>;

export const PolishAssistBodySchema = z.object({
  draft: z.string().min(1).max(2_000),
  replyToMessageId: UuidSchema.nullable().optional(),
  clientRequestId: z.string().min(1).max(200),
});
export type PolishAssistBody = z.infer<typeof PolishAssistBodySchema>;

export const AnalyzeAssistResponseSchema = z.object({
  requestId: UuidSchema,
  status: AssistStatusSchema,
  result: z
    .object({
      interpretation: z.string().min(1).max(4_000),
      replyRoutes: z.array(ReplyRouteSchema).max(5),
    })
    .nullable(),
  traceId: UuidSchema,
});
export type AnalyzeAssistResponse = z.infer<typeof AnalyzeAssistResponseSchema>;

export const PolishAssistResponseSchema = z.object({
  requestId: UuidSchema,
  status: AssistStatusSchema,
  result: z.object({ candidates: z.array(PolishCandidateSchema).min(1).max(5) }).nullable(),
  traceId: UuidSchema,
});
export type PolishAssistResponse = z.infer<typeof PolishAssistResponseSchema>;
