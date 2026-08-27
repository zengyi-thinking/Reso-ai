import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../../database/migrations/0004_post_connection_tea_party.sql", import.meta.url),
);
const initialMigrationPath = fileURLToPath(
  new URL("../../../database/migrations/0002_initial_schema.sql", import.meta.url),
);

describe("post-connection migration contract", () => {
  it("contains database-enforced idempotency for missions, turns, and assists", async () => {
    const sql = `${await readFile(initialMigrationPath, "utf8")}\n${await readFile(migrationPath, "utf8")}`;
    expect(sql).toContain("social_missions_one_tea_party_per_connection_idx");
    expect(sql).toContain("UNIQUE (requester_user_id, client_request_id)");
    expect(sql).toContain("UNIQUE (sender_user_id, client_message_id)");
    expect(sql).toContain("UNIQUE (mission_id, turn_number)");
  });

  it("persists trace, stop, consent, block, outbox, and audit state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const required of [
      "trace_id",
      "stop_reason",
      "user_a_proxy_consent",
      "user_b_proxy_consent",
      "user_blocks",
      "event_outbox",
      "event_consumptions",
      "product_audit_log",
    ]) {
      expect(sql).toContain(required);
    }
    expect(sql).not.toContain("CREATE TABLE outbox_events");
  });
});
