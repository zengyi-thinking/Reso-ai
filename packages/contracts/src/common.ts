import { z } from "zod";

export const UuidSchema = z.uuid();
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const AgentModeSchema = z.enum(["companion", "mirror", "preprocessor", "proxy"]);
export type AgentMode = z.infer<typeof AgentModeSchema>;

export const CandidateStatusSchema = z.enum(["pending", "accepted", "rejected", "superseded"]);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

export const DisclosureLevelSchema = z.enum([
  "L0_INTERNAL",
  "L1_PUBLIC",
  "L2_SOCIAL",
  "L3_RELATIONSHIP",
  "L4_PRIVATE",
  "L5_SECRET",
]);
export type DisclosureLevel = z.infer<typeof DisclosureLevelSchema>;

export const SubjectTypeSchema = z.enum(["user", "agent"]);
export type SubjectType = z.infer<typeof SubjectTypeSchema>;

export const ConfidenceSchema = z.number().min(0).max(1);
