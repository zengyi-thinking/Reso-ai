import { z } from "zod";

export const ProductErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "JOURNEY_FORBIDDEN",
  "JOURNEY_NOT_FOUND",
  "JOURNEY_ALREADY_COMPLETED",
  "JOURNEY_INCOMPLETE",
  "JOURNEY_ANSWER_CONFLICT",
  "JOURNEY_INVALID_DEFINITION",
  "PERSONAL_MANUAL_NOT_READY",
  "PERSONAL_MANUAL_NOT_FOUND",
  "PERSONAL_MANUAL_EDIT_CONFLICT",
  "PERSONAL_MANUAL_INVALID_CONTENT",
  "PERSONA_ALREADY_EXISTS",
  "CONNECTION_FORBIDDEN",
  "CONSENT_REQUIRED",
  "MESSAGE_NOT_FOUND",
  "TEA_PARTY_NOT_AVAILABLE",
  "TEA_PARTY_ALREADY_RUNNING",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "AGENT_UNAVAILABLE",
  "AGENT_TIMEOUT",
  "AGENT_INVALID_RESPONSE",
  "RETRY_NOT_ALLOWED",
]);
export type ProductErrorCode = z.infer<typeof ProductErrorCodeSchema>;

export const ProductErrorResponseSchema = z.object({
  code: ProductErrorCodeSchema,
  message: z.string().min(1),
  traceId: z.string().uuid(),
  retryable: z.boolean(),
});
export type ProductErrorResponse = z.infer<typeof ProductErrorResponseSchema>;
