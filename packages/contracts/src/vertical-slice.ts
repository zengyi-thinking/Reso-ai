import { z } from "zod";
import { AgentPublicEventSchema, PublicProcessModeSchema } from "./agent.js";
import {
  CandidateStatusSchema,
  ConfidenceSchema,
  IsoDateTimeSchema,
  UuidSchema,
} from "./common.js";
import { MemoryTypeSchema } from "./memory.js";
import { PersonaContentSchema, PersonaVersionSchema } from "./persona.js";

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);

export const EmailSendCodeRequestSchema = z.object({
  email: EmailSchema,
});
export type EmailSendCodeRequest = z.infer<typeof EmailSendCodeRequestSchema>;

export const EmailSendCodeResponseSchema = z.object({
  expiresAt: IsoDateTimeSchema,
  resendAfterSeconds: z.number().int().positive(),
});
export type EmailSendCodeResponse = z.infer<typeof EmailSendCodeResponseSchema>;

export const EmailVerifyCodeRequestSchema = z.object({
  email: EmailSchema,
  code: z.string().regex(/^\d{6}$/),
  guestToken: z.string().min(32).max(256).optional(),
});

export const ProductUserSchema = z.object({
  id: UuidSchema,
  email: EmailSchema,
  displayName: z.string().min(1).max(80).nullable(),
  createdAt: IsoDateTimeSchema,
});
export type ProductUser = z.infer<typeof ProductUserSchema>;

export const PrimaryAgentSchema = z.object({
  id: UuidSchema,
  ownerUserId: UuidSchema,
  name: z.string().min(1).max(80),
  status: z.enum(["active", "paused", "retired"]),
  createdAt: IsoDateTimeSchema,
});
export type PrimaryAgent = z.infer<typeof PrimaryAgentSchema>;

export const QuickStartAnswersSchema = z.object({
  mbti: z.string().trim().max(12).nullable().default(null),
  zodiac: z.string().trim().max(20).nullable().default(null),
  relationshipGoal: z.string().trim().min(1).max(160),
  communicationPreference: z.string().trim().min(1).max(160),
  socialPreference: z.string().trim().min(1).max(160),
});
export type QuickStartAnswers = z.infer<typeof QuickStartAnswersSchema>;

export const QuickStartPersonaDraftRequestSchema = z.object({
  requestId: UuidSchema,
  answers: QuickStartAnswersSchema,
});
export type QuickStartPersonaDraftRequest = z.infer<typeof QuickStartPersonaDraftRequestSchema>;

export const QuickStartPersonaDraftResponseSchema = z.object({
  content: PersonaContentSchema,
  modelVersion: z.string().min(1).max(120),
});
export type QuickStartPersonaDraftResponse = z.infer<typeof QuickStartPersonaDraftResponseSchema>;

export const GuestOnboardingSchema = z.object({
  id: UuidSchema,
  status: z.enum(["started", "draft_ready", "confirmed", "claimed"]),
  answers: QuickStartAnswersSchema.nullable(),
  personaDraft: PersonaContentSchema.nullable(),
  corrections: z.array(
    z.object({
      id: UuidSchema,
      path: z.string().min(1).max(120),
      previousValue: z.unknown(),
      correctedValue: z.unknown(),
      createdAt: IsoDateTimeSchema,
    }),
  ),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type GuestOnboarding = z.infer<typeof GuestOnboardingSchema>;

export const GuestOnboardingSessionSchema = z.object({
  guestToken: z.string().min(32).max(256),
  onboarding: GuestOnboardingSchema,
});

export const QuickStartSubmitRequestSchema = z.object({
  answers: QuickStartAnswersSchema,
});

export const PersonaDraftUpdateRequestSchema = z.object({
  content: PersonaContentSchema,
});

export const QuickStartClaimAgentRequestSchema = z.object({
  guestToken: z.string().min(32).max(256),
  agentName: z.string().trim().min(1).max(80).default("Reso"),
});

export const ProductIdentitySchema = z.object({
  user: ProductUserSchema,
  agent: PrimaryAgentSchema.nullable(),
  persona: PersonaVersionSchema.nullable(),
});
export type ProductIdentity = z.infer<typeof ProductIdentitySchema>;

export const EmailVerifyCodeResponseSchema = z.object({
  sessionToken: z.string().min(32),
  expiresAt: IsoDateTimeSchema,
  identity: ProductIdentitySchema,
  migratedGuest: z.boolean(),
});

export const ProductConversationSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  agentId: UuidSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ProductConversation = z.infer<typeof ProductConversationSchema>;

export const ProductMessageSchema = z.object({
  id: UuidSchema,
  conversationId: UuidSchema,
  role: z.enum(["user", "agent"]),
  content: z.string().min(1).max(20_000),
  publicEvents: z.array(AgentPublicEventSchema).default([]),
  createdAt: IsoDateTimeSchema,
});
export type ProductMessage = z.infer<typeof ProductMessageSchema>;

export const ProductConversationDetailSchema = z.object({
  conversation: ProductConversationSchema,
  messages: z.array(ProductMessageSchema),
});
export type ProductConversationDetail = z.infer<typeof ProductConversationDetailSchema>;

export const ProductTurnRequestSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  clientMessageId: z.string().min(1).max(200),
  publicProcessMode: PublicProcessModeSchema.default("adaptive"),
});

export const ProductTurnCompleteSchema = z.object({
  type: z.literal("done"),
  userMessageId: UuidSchema,
  agentMessageId: UuidSchema,
  traceId: UuidSchema,
});

export const MemoryCandidateRecordSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  sourceMessageId: UuidSchema.nullable(),
  type: MemoryTypeSchema,
  summary: z.string().min(1),
  evidenceMessageIds: z.array(UuidSchema),
  confidence: ConfidenceSchema,
  requiresReview: z.boolean(),
  status: z.enum(["pending", "accepted", "rejected"]),
  createdAt: IsoDateTimeSchema,
});
export type MemoryCandidateRecord = z.infer<typeof MemoryCandidateRecordSchema>;

export const PersonaPatchRecordSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  fromVersionId: UuidSchema,
  path: z.string().min(1),
  oldValue: z.unknown().nullable(),
  proposedValue: z.unknown(),
  reason: z.string().min(1),
  evidenceMessageIds: z.array(UuidSchema),
  confidence: ConfidenceSchema,
  status: CandidateStatusSchema,
  createdAt: IsoDateTimeSchema,
  confirmedAt: IsoDateTimeSchema.nullable(),
});
export type PersonaPatchRecord = z.infer<typeof PersonaPatchRecordSchema>;

export const CandidateDecisionRequestSchema = z.object({
  decision: z.enum(["accept", "reject"]),
});
