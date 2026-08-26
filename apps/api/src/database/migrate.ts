import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPostgresPool } from "../product/postgres-repository.js";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required for database migration");
}

const migrationsDirectory = resolve(process.cwd(), "../../database/migrations");
const pool = createPostgresPool(databaseUrl, { max: 1 });
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock(hashtext('reso-ai-database-migrations'))");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/i.test(file))
    .sort((left, right) => left.localeCompare(right));

  for (const file of migrationFiles) {
    const sql = await readFile(resolve(migrationsDirectory, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query<{ checksum: string }>(
      "SELECT checksum FROM schema_migrations WHERE version=$1",
      [file],
    );
    if (existing.rows[0] !== undefined) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Applied migration checksum changed: ${file}`);
      }
      console.info("Migration already applied", { file });
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(stripTransactionWrapper(sql));
      await client.query("INSERT INTO schema_migrations (version,checksum) VALUES ($1,$2)", [
        file,
        checksum,
      ]);
      await client.query("COMMIT");
      console.info("Migration applied", { file });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('reso-ai-database-migrations'))");
  client.release();
  await pool.end();
}

function stripTransactionWrapper(sql: string): string {
  return sql
    .replace(/^\s*BEGIN\s*;\s*/i, "")
    .replace(/\s*COMMIT\s*;\s*$/i, "")
    .trim();
}
