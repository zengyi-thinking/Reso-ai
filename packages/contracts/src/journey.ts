import { z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "./common.js";
import { EventEnvelopeSchema } from "./events.js";
import { PersonaVersionSchema } from "./persona.js";

export const JourneyVersionSchema = z.literal("mountain-v1");
export type JourneyVersion = z.infer<typeof JourneyVersionSchema>;

export const JourneyStatusSchema = z.enum(["started", "completed", "abandoned"]);
export type JourneyStatus = z.infer<typeof JourneyStatusSchema>;

export const JourneyEvidenceTargetSchema = z.enum(["self", "partner", "joint"]);
export type JourneyEvidenceTarget = z.infer<typeof JourneyEvidenceTargetSchema>;

export const JourneyEvidenceSignalSchema = z.object({
  dimension: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(120),
  weight: z.number().int().min(1).max(3),
});
export type JourneyEvidenceSignal = z.infer<typeof JourneyEvidenceSignalSchema>;

export const JourneyEvidenceItemSchema = z.object({
  evidenceRef: z.string().trim().min(1).max(240),
  journeyVersion: JourneyVersionSchema,
  stageId: z.string().trim().min(1).max(80),
  questionId: z.string().trim().min(1).max(80),
  choiceId: z.string().trim().min(1).max(80),
  optionText: z.string().trim().min(1).max(600),
  responseText: z.string().trim().min(1).max(1_000).nullable(),
  target: JourneyEvidenceTargetSchema,
  summary: z.string().trim().min(1).max(600),
  signals: z.array(JourneyEvidenceSignalSchema).min(1).max(12),
  contextTags: z.array(z.string().trim().min(1).max(80)).max(12),
  pressure: z.enum(["low", "medium", "high"]),
  companionMood: z.string().trim().min(1).max(80).nullable(),
  elapsedMs: z.number().int().min(0).max(86_400_000).nullable(),
  answeredAt: IsoDateTimeSchema,
});
export type JourneyEvidenceItem = z.infer<typeof JourneyEvidenceItemSchema>;

export const JourneyEvidenceSnapshotSchema = z.object({
  id: UuidSchema,
  journeyId: UuidSchema,
  journeyVersion: JourneyVersionSchema,
  evidenceVersion: z.literal(1),
  official: z.boolean(),
  evidenceSignature: z.string().regex(/^[0-9a-f]{64}$/),
  items: z.array(JourneyEvidenceItemSchema).min(1).max(60),
  createdAt: IsoDateTimeSchema,
});
export type JourneyEvidenceSnapshot = z.infer<typeof JourneyEvidenceSnapshotSchema>;

export const JourneyAnswerInputSchema = z
  .object({
    stageId: z.string().trim().min(1).max(80),
    questionId: z.string().trim().min(1).max(80),
    choiceId: z.string().trim().min(1).max(80),
    responseText: z.string().trim().min(1).max(1_000).optional(),
    elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
    clientAnswerId: UuidSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.choiceId === "free-response" && value.responseText === undefined) {
      context.addIssue({
        code: "custom",
        path: ["responseText"],
        message: "responseText is required for a free response",
      });
    }
    if (value.choiceId !== "free-response" && value.responseText !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["responseText"],
        message: "responseText is only allowed for a free response",
      });
    }
  });
export type JourneyAnswerInput = z.infer<typeof JourneyAnswerInputSchema>;

export const JourneyAnswerSchema = z.object({
  id: UuidSchema,
  journeyId: UuidSchema,
  stageId: z.string().min(1),
  questionId: z.string().min(1),
  choiceId: z.string().min(1),
  responseText: z.string().min(1).max(1_000).nullable(),
  elapsedMs: z.number().int().min(0).nullable(),
  clientAnswerId: UuidSchema,
  answerOrder: z.number().int().positive(),
  answeredAt: IsoDateTimeSchema,
  evidence: JourneyEvidenceItemSchema,
});
export type JourneyAnswer = z.infer<typeof JourneyAnswerSchema>;

export const JourneyAttemptSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema.nullable(),
  journeyVersion: JourneyVersionSchema,
  status: JourneyStatusSchema,
  clientAttemptId: UuidSchema,
  replayOfJourneyId: UuidSchema.nullable(),
  official: z.boolean(),
  answerCount: z.number().int().min(0),
  requiredAnswerCount: z.number().int().positive(),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type JourneyAttempt = z.infer<typeof JourneyAttemptSchema>;

export const JourneyProgressSchema = z.object({
  attempt: JourneyAttemptSchema,
  answers: z.array(JourneyAnswerSchema),
  nextQuestionId: z.string().min(1).nullable(),
});
export type JourneyProgress = z.infer<typeof JourneyProgressSchema>;

export const CreateJourneyRequestSchema = z
  .object({
    journeyVersion: JourneyVersionSchema,
    clientAttemptId: UuidSchema,
    replayOfJourneyId: UuidSchema.optional(),
    anonymousAccessToken: z
      .string()
      .min(43)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
export type CreateJourneyRequest = z.infer<typeof CreateJourneyRequestSchema>;

export const CreateJourneyResponseSchema = z.object({ attempt: JourneyAttemptSchema });
export type CreateJourneyResponse = z.infer<typeof CreateJourneyResponseSchema>;

export const JourneyCompletedEventPayloadSchema = z.object({
  journeyId: UuidSchema,
  evidenceSnapshotId: UuidSchema,
  personalManualSnapshotId: UuidSchema,
});
export type JourneyCompletedEventPayload = z.infer<typeof JourneyCompletedEventPayloadSchema>;

export const JourneyCompletedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("journey.completed"),
  payload: JourneyCompletedEventPayloadSchema,
}).superRefine((event, context) => {
  if (event.subjectId !== event.payload.journeyId) {
    context.addIssue({
      code: "custom",
      path: ["subjectId"],
      message: "subjectId must match payload.journeyId",
    });
  }
});
export type JourneyCompletedEvent = z.infer<typeof JourneyCompletedEventSchema>;

export const PersonalManualVariableIdSchema = z.enum([
  "crisisInstinct",
  "involuntaryReaction",
  "incompatiblePattern",
  "possibleMisreading",
  "negativeFeeling",
  "relationshipRedLine",
  "repairAction",
  "recoveryNeed",
  "lifeVision",
]);
export type PersonalManualVariableId = z.infer<typeof PersonalManualVariableIdSchema>;

export const PersonalManualSectionIdSchema = z.enum([
  "deepNeed",
  "defense",
  "incompatible",
  "repair",
  "vision",
]);
export type PersonalManualSectionId = z.infer<typeof PersonalManualSectionIdSchema>;

export const PersonalManualConfidenceSchema = z.enum(["low", "medium", "high"]);

export const PersonalManualVariableSchema = z.object({
  id: PersonalManualVariableIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(600),
  confidence: PersonalManualConfidenceSchema,
  evidenceRefs: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
});
export type PersonalManualVariable = z.infer<typeof PersonalManualVariableSchema>;

export const PersonalManualSectionSchema = z.object({
  id: PersonalManualSectionIdSchema,
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(1_200),
  confidence: PersonalManualConfidenceSchema,
  evidenceRefs: z.array(z.string().trim().min(1).max(240)).min(1).max(24),
});
export type PersonalManualSection = z.infer<typeof PersonalManualSectionSchema>;

const manualVariableOrder = PersonalManualVariableIdSchema.options;
const manualSectionOrder = PersonalManualSectionIdSchema.options;

export const PersonalManualContentSchema = z
  .object({
    variables: z.array(PersonalManualVariableSchema).length(manualVariableOrder.length),
    sections: z.array(PersonalManualSectionSchema).length(manualSectionOrder.length),
    updateSummary: z.string().trim().min(1).max(300),
  })
  .strict()
  .superRefine((value, context) => {
    value.variables.forEach((variable, index) => {
      if (variable.id !== manualVariableOrder[index]) {
        context.addIssue({
          code: "custom",
          path: ["variables", index, "id"],
          message: `expected ${manualVariableOrder[index]}`,
        });
      }
    });
    value.sections.forEach((section, index) => {
      if (section.id !== manualSectionOrder[index]) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "id"],
          message: `expected ${manualSectionOrder[index]}`,
        });
      }
    });
  });
export type PersonalManualContent = z.infer<typeof PersonalManualContentSchema>;

export const PersonalManualGenerationRequestSchema = z.object({
  requestId: UuidSchema,
  journeyId: UuidSchema,
  journeyVersion: JourneyVersionSchema,
  evidenceSnapshotId: UuidSchema,
  evidenceSignature: z.string().regex(/^[0-9a-f]{64}$/),
  evidence: z.array(JourneyEvidenceItemSchema).min(7).max(60),
  traceId: UuidSchema,
});
export type PersonalManualGenerationRequest = z.infer<typeof PersonalManualGenerationRequestSchema>;

export const PersonalManualCandidateSchema = PersonalManualContentSchema.extend({
  traceId: UuidSchema,
  agentVersionId: UuidSchema.nullable(),
  modelVersion: z.string().trim().min(1).max(120).nullable(),
});
export type PersonalManualCandidate = z.infer<typeof PersonalManualCandidateSchema>;

export const PersonalManualStatusSchema = z.enum(["generating", "ready", "failed", "claimed"]);
export type PersonalManualStatus = z.infer<typeof PersonalManualStatusSchema>;

export const PersonalManualSnapshotSchema = z.object({
  id: UuidSchema,
  journeyId: UuidSchema,
  status: PersonalManualStatusSchema,
  evidenceSignature: z.string().regex(/^[0-9a-f]{64}$/),
  originalContent: PersonalManualContentSchema.nullable(),
  currentContent: PersonalManualContentSchema.nullable(),
  revision: z.number().int().positive(),
  currentSource: z.enum(["agent_generated", "user_edit"]),
  retryable: z.boolean(),
  errorCode: z.string().trim().min(1).max(80).nullable(),
  agentTraceId: UuidSchema.nullable(),
  agentVersionId: UuidSchema.nullable(),
  modelVersion: z.string().trim().min(1).max(120).nullable(),
  personaVersionId: UuidSchema.nullable(),
  agentId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  generatedAt: IsoDateTimeSchema.nullable(),
  claimedAt: IsoDateTimeSchema.nullable(),
});
export type PersonalManualSnapshot = z.infer<typeof PersonalManualSnapshotSchema>;

export const PersonalManualEditRequestSchema = z
  .object({
    clientEditId: UuidSchema,
    expectedRevision: z.number().int().positive(),
    content: PersonalManualContentSchema,
  })
  .strict();
export type PersonalManualEditRequest = z.infer<typeof PersonalManualEditRequestSchema>;

export const RetryPersonalManualRequestSchema = z.object({ clientRetryId: UuidSchema }).strict();
export type RetryPersonalManualRequest = z.infer<typeof RetryPersonalManualRequestSchema>;

export const ClaimJourneyOwnershipRequestSchema = z.object({ clientClaimId: UuidSchema }).strict();
export type ClaimJourneyOwnershipRequest = z.infer<typeof ClaimJourneyOwnershipRequestSchema>;

export const ClaimAgentRequestSchema = z.object({ clientClaimId: UuidSchema }).strict();
export type ClaimAgentRequest = z.infer<typeof ClaimAgentRequestSchema>;

export const ClaimedAgentSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  name: z.string().trim().min(1).max(120),
  status: z.enum(["active", "paused", "retired"]),
  createdAt: IsoDateTimeSchema,
});
export type ClaimedAgent = z.infer<typeof ClaimedAgentSchema>;

export const ClaimAgentResponseSchema = z.object({
  personalManual: PersonalManualSnapshotSchema,
  personaVersion: PersonaVersionSchema,
  agent: ClaimedAgentSchema,
  nextPath: z.literal("/agent"),
});
export type ClaimAgentResponse = z.infer<typeof ClaimAgentResponseSchema>;
