-- Ownership: Product Backend / Reflection, Memory and Persona domains.
-- Forward-only migration closing the growth loop: reflection watermarks for the
-- Worker batch trigger and message-level evidence on persona patch candidates.
-- (Review-status indexes already exist from 0002; do not duplicate them here.)
-- Rollback strategy: use a compensating migration. Dropping these objects loses
-- reflection progress bookkeeping only; memory/persona candidates themselves stay
-- intact because their tables predate this migration.

BEGIN;

CREATE TABLE reflection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- Timestamp-based watermark: Worker counts user messages created strictly after
  -- this value, then advances it to the newest message included in the batch.
  last_reflected_at timestamptz NOT NULL DEFAULT '-infinity'::timestamptz,
  reflected_run_count integer NOT NULL DEFAULT 0 CHECK (reflected_run_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id)
);

-- Contract AgentReflectionResponse.personaPatchCandidates carries transcript
-- message ids as evidence; they live here until the future version-bump flow
-- materializes persona_evidence links against accepted memories.
ALTER TABLE persona_patch_candidates
  ADD COLUMN evidence_message_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
