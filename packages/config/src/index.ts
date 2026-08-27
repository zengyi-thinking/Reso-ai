import { z } from "zod";

export const RuntimeConfigSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  PRODUCT_REPOSITORY: z.enum(["memory", "postgres"]).default("memory"),
  SESSION_PROVIDER: z.enum(["demo", "postgres"]).default("demo"),
  AGENT_SERVICE_URL: z.url().default("http://localhost:8000"),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  AGENT_SERVICE_TOKEN: z.string().default(""),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(1_000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  TRACE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
