import { z } from "zod";

export const RuntimeConfigSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  PRODUCT_REPOSITORY: z.enum(["memory", "postgres"]).default("memory"),
  SESSION_PROVIDER: z.enum(["demo", "postgres"]).default("demo"),
  AGENT_SERVICE_URL: z.url().default("http://localhost:8000"),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  AGENT_SERVICE_TOKEN: z.string().default(""),
  SMTP_HOST: z.string().min(1).default("smtp.qq.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().default(""),
  SMTP_AUTH_CODE: z.string().default(""),
  SMTP_FROM: z.string().default(""),
  AUTH_CODE_HASH_SECRET: z.string().default(""),
  AUTH_CODE_TTL_SECONDS: z.coerce.number().int().min(300).max(600).default(600),
  AUTH_CODE_RESEND_SECONDS: z.coerce.number().int().min(30).max(300).default(60),
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
