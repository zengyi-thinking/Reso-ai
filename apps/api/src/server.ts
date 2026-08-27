import { RuntimeConfigSchema } from "@reso/config";
import { buildApp } from "./app.js";
import { createAgentClient } from "./agent-client/factory.js";
import { PostgresSessionResolver } from "./auth/postgres-session-resolver.js";
import { InMemoryJourneyRepository } from "./journeys/in-memory-journey-repository.js";
import { PostgresJourneyRepository } from "./journeys/postgres-journey-repository.js";
import {
  createDevelopmentRepository,
  resolveDevelopmentSession,
} from "./product/development-demo.js";
import { createPostgresPool, PostgresProductRepository } from "./product/postgres-repository.js";
import { PostgresWindowRateLimiter } from "./product/rate-limiter.js";
import { SmtpEmailCodeMailer } from "./auth/smtp-email-code-mailer.js";
import { UnconfiguredEmailCodeMailer } from "./auth/email-mailer.js";
import { InMemoryVerticalSliceRepository } from "./vertical-slice/in-memory-repository.js";
import { PostgresVerticalSliceRepository } from "./vertical-slice/postgres-repository.js";

const config = RuntimeConfigSchema.parse(process.env);
const agentClient = createAgentClient(config.AGENT_SERVICE_URL, {
  timeoutMs: config.AGENT_TIMEOUT_MS,
  serviceToken: config.AGENT_SERVICE_TOKEN,
});
if (config.APP_ENV === "production" && config.PRODUCT_REPOSITORY !== "postgres") {
  throw new Error("Production requires PRODUCT_REPOSITORY=postgres");
}
if (config.APP_ENV === "production" && config.SESSION_PROVIDER !== "postgres") {
  throw new Error("Production requires SESSION_PROVIDER=postgres");
}
if (config.APP_ENV === "production" && config.AGENT_SERVICE_TOKEN.length === 0) {
  throw new Error("Production requires AGENT_SERVICE_TOKEN");
}
if (
  config.APP_ENV === "production" &&
  (config.SMTP_USER.length === 0 ||
    config.SMTP_AUTH_CODE.length === 0 ||
    config.AUTH_CODE_HASH_SECRET.length === 0)
) {
  throw new Error("Production requires SMTP_USER, SMTP_AUTH_CODE and AUTH_CODE_HASH_SECRET");
}

const postgresPool =
  config.PRODUCT_REPOSITORY === "postgres" ? createPostgresPool(config.DATABASE_URL) : undefined;
const developmentRepository =
  config.PRODUCT_REPOSITORY === "memory" ? createDevelopmentRepository() : undefined;
const repository =
  postgresPool === undefined ? developmentRepository! : new PostgresProductRepository(postgresPool);
const journeyRepository =
  postgresPool === undefined
    ? new InMemoryJourneyRepository()
    : new PostgresJourneyRepository(postgresPool);
const verticalSliceRepository =
  postgresPool === undefined
    ? new InMemoryVerticalSliceRepository()
    : new PostgresVerticalSliceRepository(postgresPool);
const emailCodeMailer =
  config.SMTP_USER.length > 0 && config.SMTP_AUTH_CODE.length > 0
    ? new SmtpEmailCodeMailer({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        user: config.SMTP_USER,
        authCode: config.SMTP_AUTH_CODE,
        from: config.SMTP_FROM || config.SMTP_USER,
      })
    : new UnconfiguredEmailCodeMailer();
const app = await buildApp({
  agentClient,
  repository,
  journeyRepository,
  verticalSliceRepository,
  emailCodeMailer,
  authCodeHashSecret:
    config.AUTH_CODE_HASH_SECRET || config.SMTP_AUTH_CODE || "reso-development-auth-code-secret",
  authCodeTtlMs: config.AUTH_CODE_TTL_SECONDS * 1_000,
  authCodeResendMs: config.AUTH_CODE_RESEND_SECONDS * 1_000,
  sessionUserResolver:
    config.SESSION_PROVIDER === "postgres"
      ? new PostgresSessionResolver(repository).resolve
      : resolveDevelopmentSession,
  ...(postgresPool === undefined
    ? {}
    : { rateLimiter: new PostgresWindowRateLimiter(postgresPool) }),
  logger: true,
});

await app.listen({ host: "0.0.0.0", port: config.API_PORT });

const shutdown = async (): Promise<void> => {
  await app.close();
  await postgresPool?.end();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
