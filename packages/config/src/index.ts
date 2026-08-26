import { z } from "zod";

export const RuntimeConfigSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  AGENT_SERVICE_URL: z.url().default("http://localhost:8000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  TRACE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
