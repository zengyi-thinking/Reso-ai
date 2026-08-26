BEGIN;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Reso Agent',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'abandoned')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journey_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  choice_id text NOT NULL,
  answer_order integer NOT NULL CHECK (answer_order > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, question_id)
);

CREATE TABLE persona_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE persona_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES persona_profiles(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  content jsonb NOT NULL,
  change_summary text NOT NULL,
  confirmed_by_user boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version)
);

ALTER TABLE persona_profiles
  ADD CONSTRAINT persona_profiles_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES persona_versions(id) ON DELETE SET NULL;

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('episodic', 'persona_related', 'relationship', 'correction', 'reflection')),
  summary text NOT NULL,
  source_event_id uuid,
  occurred_at timestamptz NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE persona_patch_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_version_id uuid NOT NULL REFERENCES persona_versions(id) ON DELETE CASCADE,
  path text NOT NULL,
  old_value jsonb,
  proposed_value jsonb NOT NULL,
  reason text NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE persona_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patch_candidate_id uuid NOT NULL REFERENCES persona_patch_candidates(id) ON DELETE CASCADE,
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patch_candidate_id, memory_id)
);

CREATE TABLE memory_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  excerpt text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'agent', 'system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'agent')),
  subject_id uuid NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('user', 'agent')),
  object_id uuid NOT NULL,
  stage text NOT NULL,
  familiarity numeric(4,3) NOT NULL DEFAULT 0 CHECK (familiarity BETWEEN 0 AND 1),
  trust numeric(4,3) NOT NULL DEFAULT 0 CHECK (trust BETWEEN 0 AND 1),
  interaction_count integer NOT NULL DEFAULT 0 CHECK (interaction_count >= 0),
  shared_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL DEFAULT '',
  last_interaction_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, object_type, object_id)
);

CREATE TABLE relationship_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE social_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  goal text NOT NULL,
  max_turns integer NOT NULL CHECK (max_turns BETWEEN 1 AND 20),
  allowed_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  forbidden_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  disclosure_level text NOT NULL,
  budget jsonb NOT NULL,
  stop_conditions jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES social_missions(id) ON DELETE CASCADE,
  turn_number integer NOT NULL CHECK (turn_number > 0),
  actor_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  input_summary text NOT NULL,
  output_summary text NOT NULL,
  disclosure_decision text NOT NULL CHECK (disclosure_decision IN ('ALLOW', 'DENY', 'ASK_USER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, turn_number)
);

CREATE TABLE recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recommended_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  shared_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'candidate',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (subject_user_id <> recommended_user_id)
);

CREATE TABLE consent_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  disclosure_level text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE disclosure_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('L0_INTERNAL', 'L1_PUBLIC', 'L2_SOCIAL', 'L3_RELATIONSHIP', 'L4_PRIVATE', 'L5_SECRET')),
  topic text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('ALLOW', 'DENY', 'ASK_USER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, level, topic)
);

CREATE TABLE agent_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona_version_id uuid REFERENCES persona_versions(id) ON DELETE SET NULL,
  retrieved_memory_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  relationship_id uuid REFERENCES relationships(id) ON DELETE SET NULL,
  mode text NOT NULL,
  policy_decision text NOT NULL,
  tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text NOT NULL,
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  input_summary text NOT NULL,
  output text NOT NULL,
  memory_candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  persona_candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id uuid NOT NULL REFERENCES agent_traces(id) ON DELETE CASCADE,
  grader text NOT NULL,
  score numeric(6,3),
  passed boolean NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memories_user_type_occurred_idx ON memories (user_id, type, occurred_at DESC);
CREATE INDEX messages_conversation_created_idx ON messages (conversation_id, created_at);
CREATE INDEX persona_patch_candidates_user_status_idx ON persona_patch_candidates (user_id, status, created_at DESC);
CREATE INDEX relationship_events_relationship_occurred_idx ON relationship_events (relationship_id, occurred_at DESC);
CREATE INDEX consent_grants_user_scope_idx ON consent_grants (user_id, scope, revoked_at);
CREATE INDEX social_missions_initiator_status_idx ON social_missions (initiator_agent_id, status);
CREATE INDEX agent_traces_user_created_idx ON agent_traces (user_id, created_at DESC);

COMMIT;

