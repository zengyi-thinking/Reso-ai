import { z } from "zod";
import { ConfidenceSchema, IsoDateTimeSchema, UuidSchema } from "./common.js";

export const RecommendationSchema = z.object({
  id: UuidSchema,
  subjectUserId: UuidSchema,
  recommendedUserId: UuidSchema,
  reason: z.string().min(1),
  sharedTopics: z.array(z.string()),
  confidence: ConfidenceSchema,
  status: z.enum(["candidate", "presented", "accepted", "declined", "expired"]),
  createdAt: IsoDateTimeSchema,
});
export type Recommendation = z.infer<typeof RecommendationSchema>;
