import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const composeFile = "infra/docker/database-test.compose.yaml";
const projectName = `reso-ai-schema-${process.pid}`;
const composeArgs = ["compose", "-p", projectName, "-f", composeFile];

function run(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`docker ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
  }
  return (result.stdout ?? "").trim();
}

try {
  run([...composeArgs, "up", "-d", "--wait", "postgres", "redis"], { stdio: "inherit" });

  const seed = readFileSync(
    new URL("../../database/seeds/development.sql", import.meta.url),
    "utf8",
  );
  run(
    [
      ...composeArgs,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "reso",
      "-d",
      "reso",
    ],
    {
      input: seed,
    },
  );

  const schemaReady = run([
    ...composeArgs,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-At",
    "-U",
    "reso",
    "-d",
    "reso",
    "-c",
    "SELECT bool_and(to_regclass(name) IS NOT NULL) FROM unnest(ARRAY['public.users','public.persona_versions','public.memories','public.consent_grants','public.event_outbox','public.event_consumptions','public.dead_letter_events']) AS name;",
  ]);
  if (schemaReady !== "t") {
    throw new Error("Expected Product and event/outbox tables were not created.");
  }

  const seedCount = run([
    ...composeArgs,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-At",
    "-U",
    "reso",
    "-d",
    "reso",
    "-c",
    "SELECT count(*) FROM users WHERE email = 'journey@example.test';",
  ]);
  if (seedCount !== "1") {
    throw new Error("Synthetic development seed was not applied exactly once.");
  }

  const redisPing = run([...composeArgs, "exec", "-T", "redis", "redis-cli", "ping"]);
  if (redisPing !== "PONG") {
    throw new Error("Redis health verification did not return PONG.");
  }

  process.stdout.write(
    "Database migrations, synthetic seed, outbox tables, and Redis health verified.\n",
  );
} finally {
  spawnSync("docker", [...composeArgs, "down", "--volumes", "--remove-orphans"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
}
