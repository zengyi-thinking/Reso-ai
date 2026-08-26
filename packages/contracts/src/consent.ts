import { z } from "zod";
import { DisclosureLevelSchema, IsoDateTimeSchema, UuidSchema } from "./common.js";

export const ConsentGrantSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  scope: z.string().min(1),
  disclosureLevel: DisclosureLevelSchema,
  grantedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
});
export type ConsentGrant = z.infer<typeof ConsentGrantSchema>;

export const DisclosureDecisionSchema = z.object({
  decision: z.enum(["ALLOW", "DENY", "ASK_USER"]),
  level: DisclosureLevelSchema,
  reasonCode: z.string().min(1),
});
export type DisclosureDecision = z.infer<typeof DisclosureDecisionSchema>;
