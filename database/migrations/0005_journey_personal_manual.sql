-- Ownership: Product Backend / Journey + Persona domains.
-- Forward-only migration for the trusted Journey evidence pipeline, generated
-- Personal Manual snapshots, optional edits, and the claim-Agent transaction.
-- Rollback strategy: use a compensating migration. Dropping these columns or
-- tables would destroy evidence, idempotency, and user-confirmation history.
-- Data lifecycle: free-response text remains Product DB data and must not be
-- copied to logs/traces. Anonymous access credentials are stored only as SHA-256.

BEGIN;

ALTER TABLE journeys
  ADD COLUMN client_attempt_id uuid,
  ADD COLUMN anonymous_token_hash text,
  ADD COLUMN replay_of_journey_id uuid REFERENCES journeys(id) ON DELETE SET NULL,
  ADD COLUMN official boolean NOT NULL DEFAULT true;

UPDATE journeys SET client_attempt_id = gen_random_uuid() WHERE client_attempt_id IS NULL;

-- Legacy anonymous rows predate bearer credentials. Preserve them without
-- inventing a recoverable plaintext token; a future authenticated owner may be
-- attached only through an explicit support/compensating migration.
UPDATE journeys
  SET anonymous_token_hash = encode(digest(gen_random_uuid()::text, 'sha256'), 'hex')
  WHERE user_id IS NULL AND anonymous_token_hash IS NULL;

ALTER TABLE journeys
  ALTER COLUMN client_attempt_id SET NOT NULL,
  ADD CONSTRAINT journeys_anonymous_token_hash_length
    CHECK (anonymous_token_hash IS NULL OR char_length(anonymous_token_hash) = 64),
  ADD CONSTRAINT journeys_owner_or_anonymous_token
    CHECK (user_id IS NOT NULL OR anonymous_token_hash IS NOT NULL),
  ADD CONSTRAINT journeys_replay_not_official
    CHECK (replay_of_journey_id IS NULL OR official = false);

-- Keep the earliest server record as the single official Journey per logged-in
-- owner/version. Later legacy attempts become replays without deleting data.
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY user_id, version
      ORDER BY completed_at NULLS LAST, created_at, id
    ) AS first_id,
    row_number() OVER (
      PARTITION BY user_id, version
      ORDER BY completed_at NULLS LAST, created_at, id
    ) AS position
  FROM journeys
  WHERE user_id IS NOT NULL
)
UPDATE journeys AS journey
  SET official = false,
      replay_of_journey_id = ranked.first_id
  FROM ranked
  WHERE journey.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX journeys_user_client_attempt_idx
  ON journeys (user_id, client_attempt_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX journeys_anonymous_client_attempt_idx
  ON journeys (anonymous_token_hash, client_attempt_id)
  WHERE user_id IS NULL;

CREATE INDEX journeys_user_version_completed_idx
  ON journeys (user_id, version, completed_at DESC)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX journeys_user_official_version_idx
  ON journeys (user_id, version)
  WHERE user_id IS NOT NULL AND official = true;

CREATE UNIQUE INDEX journeys_anonymous_official_version_idx
  ON journeys (anonymous_token_hash, version)
  WHERE user_id IS NULL AND official = true;

ALTER TABLE journey_answers
  ADD COLUMN stage_id text,
  ADD COLUMN response_text text,
  ADD COLUMN elapsed_ms integer,
  ADD COLUMN client_answer_id uuid,
  ADD COLUMN answered_at timestamptz,
  ADD COLUMN evidence_json jsonb;

UPDATE journey_answers SET
  stage_id = question_id,
  client_answer_id = id,
  answered_at = created_at,
  evidence_json = '{}'::jsonb
WHERE stage_id IS NULL;

ALTER TABLE journey_answers
  ALTER COLUMN stage_id SET NOT NULL,
  ALTER COLUMN client_answer_id SET NOT NULL,
  ALTER COLUMN answered_at SET NOT NULL,
  ALTER COLUMN evidence_json SET NOT NULL,
  ADD CONSTRAINT journey_answers_response_length
    CHECK (response_text IS NULL OR char_length(response_text) BETWEEN 1 AND 1000),
  ADD CONSTRAINT journey_answers_elapsed_ms
    CHECK (elapsed_ms IS NULL OR elapsed_ms BETWEEN 0 AND 86400000),
  ADD CONSTRAINT journey_answers_client_id_unique
    UNIQUE (journey_id, client_answer_id),
  ADD CONSTRAINT journey_answers_order_unique
    UNIQUE (journey_id, answer_order);

CREATE TABLE journey_evidence_snapshots (
  id uuid PRIMARY KEY,
  journey_id uuid NOT NULL UNIQUE REFERENCES journeys(id) ON DELETE CASCADE,
  journey_version text NOT NULL,
  evidence_version integer NOT NULL CHECK (evidence_version > 0),
  official boolean NOT NULL,
  evidence_signature text NOT NULL CHECK (char_length(evidence_signature) = 64),
  items_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX journey_evidence_signature_idx
  ON journey_evidence_snapshots (evidence_signature);

CREATE TABLE personal_manual_snapshots (
  id uuid PRIMARY KEY,
  journey_id uuid NOT NULL UNIQUE REFERENCES journeys(id) ON DELETE CASCADE,
  evidence_snapshot_id uuid NOT NULL UNIQUE
    REFERENCES journey_evidence_snapshots(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating', 'ready', 'failed', 'claimed')),
  evidence_signature text NOT NULL CHECK (char_length(evidence_signature) = 64),
  original_content_json jsonb,
  current_content_json jsonb,
  current_source text NOT NULL DEFAULT 'agent_generated'
    CHECK (current_source IN ('agent_generated', 'user_edit')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  retryable boolean NOT NULL DEFAULT false,
  error_code text,
  agent_trace_id uuid,
  agent_version_id uuid,
  model_version text,
  persona_version_id uuid REFERENCES persona_versions(id) ON DELETE RESTRICT,
  agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
  generated_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status IN ('generating', 'failed') AND original_content_json IS NULL)
    OR (status IN ('ready', 'claimed') AND original_content_json IS NOT NULL
        AND current_content_json IS NOT NULL)
  ),
  CHECK (status <> 'claimed' OR (persona_version_id IS NOT NULL AND agent_id IS NOT NULL))
);

CREATE INDEX personal_manual_status_updated_idx
  ON personal_manual_snapshots (status, updated_at);

CREATE TABLE personal_manual_edits (
  id uuid PRIMARY KEY,
  manual_snapshot_id uuid NOT NULL REFERENCES personal_manual_snapshots(id) ON DELETE CASCADE,
  client_edit_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 1),
  source text NOT NULL CHECK (source = 'user_edit'),
  content_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manual_snapshot_id, client_edit_id),
  UNIQUE (manual_snapshot_id, revision)
);

ALTER TABLE persona_versions
  ADD COLUMN source_manual_snapshot_id uuid UNIQUE
    REFERENCES personal_manual_snapshots(id) ON DELETE RESTRICT;

COMMIT;
