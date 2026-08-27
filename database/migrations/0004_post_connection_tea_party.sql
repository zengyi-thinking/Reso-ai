-- Ownership: Product Backend / BFF.
-- Forward-only migration for human connections, private Assist results, and
-- the bounded post-connection tea-party workflow.
-- Rollback strategy: prefer a compensating migration. Dropping these tables or
-- columns destroys audit/idempotency history and must not be done in production.

BEGIN;

CREATE TABLE connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid UNIQUE REFERENCES relationships(id) ON DELETE SET NULL,
  user_a_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_a_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  agent_b_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'established', 'closed', 'blocked')),
  user_a_proxy_consent boolean NOT NULL DEFAULT false,
  user_b_proxy_consent boolean NOT NULL DEFAULT false,
  established_at timestamptz,
  blocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_a_id <> user_b_id),
  CHECK (agent_a_id <> agent_b_id)
);

CREATE UNIQUE INDEX connections_unique_pair_idx
  ON connections (LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id));

CREATE TABLE connection_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  client_message_id text NOT NULL,
  trace_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sender_user_id, client_message_id)
);

CREATE INDEX connection_messages_connection_created_idx
  ON connection_messages (connection_id, created_at, id);

CREATE TABLE user_blocks (
  blocker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX user_sessions_active_token_idx
  ON user_sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE agent_assist_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('analyze', 'polish')),
  source_message_id uuid REFERENCES connection_messages(id) ON DELETE SET NULL,
  client_request_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  result_json jsonb,
  trace_id uuid NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_user_id, client_request_id)
);

CREATE INDEX agent_assist_connection_requester_idx
  ON agent_assist_requests (connection_id, requester_user_id, created_at DESC);

ALTER TABLE social_missions
  ADD COLUMN connection_id uuid REFERENCES connections(id) ON DELETE CASCADE,
  ADD COLUMN mission_type text NOT NULL DEFAULT 'legacy_social',
  ADD COLUMN current_turn integer NOT NULL DEFAULT 0 CHECK (current_turn >= 0),
  ADD COLUMN stop_reason text,
  ADD COLUMN error_code text,
  ADD COLUMN trace_id uuid,
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  ADD COLUMN started_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN summary_json jsonb;

ALTER TABLE social_missions
  ADD CONSTRAINT social_missions_current_turn_lte_max
  CHECK (current_turn <= max_turns);

CREATE UNIQUE INDEX social_missions_one_tea_party_per_connection_idx
  ON social_missions (connection_id, mission_type)
  WHERE connection_id IS NOT NULL AND mission_type = 'post_connection_tea_party';

ALTER TABLE agent_interactions
  ADD COLUMN content text,
  ADD COLUMN visibility text NOT NULL DEFAULT 'participants'
    CHECK (visibility IN ('participants', 'private', 'blocked')),
  ADD COLUMN agent_version_id uuid,
  ADD COLUMN model_trace_id uuid,
  ADD COLUMN trace_id uuid;

-- Reuse the committed event seam created by 0003_event_outbox.sql. Product
-- commands add an idempotency key; consumers keep their own retry/ACK state.
ALTER TABLE event_outbox
  ADD COLUMN idempotency_key text;

UPDATE event_outbox
  SET idempotency_key = id::text
  WHERE idempotency_key IS NULL;

ALTER TABLE event_outbox
  ALTER COLUMN idempotency_key SET NOT NULL,
  ADD CONSTRAINT event_outbox_idempotency_key_unique UNIQUE (idempotency_key);

ALTER TABLE event_consumptions
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX event_consumptions_available_idx
  ON event_consumptions (consumer_name, status, available_at, updated_at);

CREATE TABLE product_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  subject_id uuid NOT NULL,
  trace_id uuid NOT NULL,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_audit_subject_created_idx
  ON product_audit_log (subject_id, created_at DESC);

CREATE TABLE rate_limit_buckets (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0),
  expires_at timestamptz NOT NULL
);

CREATE INDEX rate_limit_buckets_expiry_idx ON rate_limit_buckets (expires_at);

COMMIT;
