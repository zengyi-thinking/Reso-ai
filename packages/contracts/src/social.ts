import { z } from "zod";
import { ConfidenceSchema, DisclosureLevelSchema, UuidSchema } from "./common.js";

export const SocialMissionSchema = z.object({
  missionId: UuidSchema,
  initiatorAgentId: UuidSchema,
  targetAgentId: UuidSchema,
  goal: z.string().min(1),
  maxTurns: z.number().int().positive().max(20),
  allowedTopics: z.array(z.string()),
  forbiddenTopics: z.array(z.string()),
  disclosureLevel: DisclosureLevelSchema,
  budget: z.object({
    maxModelCalls: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
  }),
  stopConditions: z.array(z.string()).min(1),
});
export type SocialMission = z.infer<typeof SocialMissionSchema>;

export const SocialMissionResultSchema = z.object({
  missionId: UuidSchema,
  summary: z.string(),
  interestingPoints: z.array(z.string()),
  sharedTopics: z.array(z.string()),
  conflicts: z.array(z.string()),
  openQuestions: z.array(z.string()),
  recommendationCandidate: z.boolean(),
  confidence: ConfidenceSchema,
  turnsUsed: z.number().int().nonnegative(),
  stopReason: z.string().min(1),
});
export type SocialMissionResult = z.infer<typeof SocialMissionResultSchema>;
