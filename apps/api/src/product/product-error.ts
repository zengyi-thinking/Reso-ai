import type { ProductErrorCode } from "@reso/contracts";

const statusByCode: Record<ProductErrorCode, number> = {
  AUTH_REQUIRED: 401,
  CONNECTION_FORBIDDEN: 403,
  CONSENT_REQUIRED: 403,
  MESSAGE_NOT_FOUND: 404,
  TEA_PARTY_NOT_AVAILABLE: 409,
  TEA_PARTY_ALREADY_RUNNING: 409,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  AGENT_UNAVAILABLE: 503,
  AGENT_TIMEOUT: 504,
  AGENT_INVALID_RESPONSE: 502,
  RETRY_NOT_ALLOWED: 409,
};

export class ProductError extends Error {
  public readonly httpStatus: number;

  constructor(
    public readonly code: ProductErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProductError";
    this.httpStatus = statusByCode[code];
  }
}
