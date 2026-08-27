-- Ownership: Product Backend / Auth, Onboarding, Persona and Conversation domains.
-- Forward-only migration for email OTP, anonymous Quick Start migration,
-- public Agent events, and reviewable memory candidates.
-- Rollback strategy: use a compensating migration; deleting these records can
-- destroy login audit, explicit correction evidence, and conversation history.

BEGIN;

CREATE TABLE email_verification_codes (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  code_hash text NOT NULL CHECK (char_length(code_hash) = 64),
  expires_at timestamptz NOT NULL,
  resend_available_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_verification_codes_email_created_idx
  ON email_verification_codes (email, created_at DESC);

CREATE TABLE guest_onboarding_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  status text NOT NULL CHECK (status IN ('started', 'draft_ready', 'confirmed', 'claimed')),
  answers_json jsonb,
  persona_draft_json jsonb,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE onboarding_corrections (
  id uuid PRIMARY KEY,
  guest_session_id uuid NOT NULL REFERENCES guest_onboarding_sessions(id) ON DELETE CASCADE,
  path text NOT NULL,
  previous_value jsonb,
  corrected_value jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX onboarding_corrections_guest_created_idx
  ON onboarding_corrections (guest_session_id, created_at);

ALTER TABLE messages
  ADD COLUMN public_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN client_message_id text;

CREATE UNIQUE INDEX messages_conversation_client_id_idx
  ON messages (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

ALTER TABLE memories
  ADD COLUMN importance numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  ADD COLUMN relationship_relevance numeric(4,3) NOT NULL DEFAULT 0 CHECK (relationship_relevance BETWEEN 0 AND 1),
  ADD COLUMN topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN conflicts_with jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE memory_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('episodic', 'persona_related', 'relationship', 'correction', 'reflection')),
  summary text NOT NULL,
  evidence_message_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  requires_review boolean NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL
);

CREATE INDEX memory_candidates_user_status_created_idx
  ON memory_candidates (user_id, status, created_at DESC);

COMMIT;
