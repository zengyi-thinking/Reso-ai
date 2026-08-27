import { RuntimeConfigSchema } from "@reso/config";
import { buildApp } from "./app.js";
import { createAgentClient } from "./agent-client/factory.js";
import { PostgresSessionResolver } from "./auth/postgres-session-resolver.js";
import { InMemoryJourneyRepository } from "./journeys/in-memory-journey-repository.js";
import { PostgresJourneyRepository } from "./journeys/postgres-journey-repository.js";
import {
  createDevelopmentRepository,
  prepareDevelopmentDemo,
  resolveDevelopmentSession,
} from "./product/development-demo.js";
import { createPostgresPool, PostgresProductRepository } from "./product/postgres-repository.js";
import { PostgresWindowRateLimiter } from "./product/rate-limiter.js";

const config = RuntimeConfigSchema.parse(process.env);
const agentClient = createAgentClient(config.AGENT_PROVIDER, config.AGENT_SERVICE_URL, {
  timeoutMs: config.AGENT_TIMEOUT_MS,
  serviceToken: config.AGENT_SERVICE_TOKEN,
  mockFailureMode: config.MOCK_AGENT_FAILURE,
});
if (config.APP_ENV === "production" && config.PRODUCT_REPOSITORY !== "postgres") {
  throw new Error("Production requires PRODUCT_REPOSITORY=postgres");
}
if (config.APP_ENV === "production" && config.SESSION_PROVIDER !== "postgres") {
  throw new Error("Production requires SESSION_PROVIDER=postgres");
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
if (developmentRepository !== undefined) {
  await prepareDevelopmentDemo(developmentRepository, agentClient);
}
const app = await buildApp({
  agentClient,
  repository,
  journeyRepository,
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
