import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../../database/migrations/0004_post_connection_tea_party.sql", import.meta.url),
);
const initialMigrationPath = fileURLToPath(
  new URL("../../../database/migrations/0002_initial_schema.sql", import.meta.url),
);
const journeyMigrationPath = fileURLToPath(
  new URL("../../../database/migrations/0005_journey_personal_manual.sql", import.meta.url),
);
const verticalSliceMigrationPath = fileURLToPath(
  new URL("../../../database/migrations/0006_product_vertical_slice.sql", import.meta.url),
);
const publicEventsRepairMigrationPath = fileURLToPath(
  new URL("../../../database/migrations/0007_normalize_message_public_events.sql", import.meta.url),
);
const migrationDirectoryPath = fileURLToPath(
  new URL("../../../database/migrations/", import.meta.url),
);

describe("migration ordering", () => {
  it("uses each numeric migration prefix exactly once", async () => {
    const migrations = (await readdir(migrationDirectoryPath)).filter((name) =>
      name.endsWith(".sql"),
    );
    const prefixes = migrations.map((name) => name.split("_", 1)[0]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

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

describe("Journey and Personal Manual migration contract", () => {
  it("keeps Evidence, generated Manual, user edits, Persona V1, and Agent links separate", async () => {
    const sql = await readFile(journeyMigrationPath, "utf8");
    for (const required of [
      "journey_evidence_snapshots",
      "personal_manual_snapshots",
      "personal_manual_edits",
      "original_content_json",
      "current_content_json",
      "source_manual_snapshot_id",
      "persona_version_id",
      "agent_id",
    ]) {
      expect(sql).toContain(required);
    }
  });

  it("enforces credential hashing, idempotency, answer order, and forward-only ownership notes", async () => {
    const sql = await readFile(journeyMigrationPath, "utf8");
    expect(sql).toContain("anonymous_token_hash");
    expect(sql).toContain("char_length(anonymous_token_hash) = 64");
    expect(sql).toContain("journey_answers_client_id_unique");
    expect(sql).toContain("journey_answers_order_unique");
    expect(sql).toContain("journeys_user_official_version_idx");
    expect(sql).toContain("journeys_anonymous_official_version_idx");
    expect(sql).toContain("Rollback strategy: use a compensating migration");
    expect(sql).not.toContain("DROP TABLE");
  });
});

describe("Product Vertical Slice migration contract", () => {
  it("stores only hashed OTP/guest credentials and preserves correction and chat evidence", async () => {
    const sql = await readFile(verticalSliceMigrationPath, "utf8");
    for (const required of [
      "code_hash",
      "token_hash",
      "onboarding_corrections",
      "public_events",
      "client_message_id",
      "memory_candidates",
    ])
      expect(sql).toContain(required);
    expect(sql).not.toContain("smtp_auth_code");
    expect(sql).not.toContain("DROP TABLE");
  });

  it("normalizes every persisted public event sequence to a JSON array", async () => {
    const sql = await readFile(publicEventsRepairMigrationPath, "utf8");
    expect(sql).toContain("jsonb_build_array(public_events)");
    expect(sql).toContain("messages_public_events_array");
    expect(sql).toContain("jsonb_typeof(public_events) = 'array'");
  });
});
