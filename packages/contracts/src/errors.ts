import { z } from "zod";

export const ProductErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
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
