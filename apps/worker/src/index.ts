export const workerQueues = [
  "memory_jobs",
  "reflection_jobs",
  "persona_jobs",
  "social_jobs",
] as const;

if (process.env["APP_ENV"] !== "test") {
  console.info("Reso worker skeleton ready", { queues: workerQueues });
}
