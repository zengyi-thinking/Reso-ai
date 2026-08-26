BEGIN;

CREATE TABLE event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1 CHECK (event_version > 0),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_consumptions (
  consumer_name text NOT NULL,
  event_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'acked', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_error text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  PRIMARY KEY (consumer_name, event_id)
);

CREATE TABLE dead_letter_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_name text NOT NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count > 0),
  failure_code text NOT NULL,
  failure_message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer_name, event_id)
);

CREATE INDEX event_outbox_unpublished_idx
  ON event_outbox (occurred_at, id)
  WHERE published_at IS NULL;
CREATE INDEX event_consumptions_status_updated_idx
  ON event_consumptions (status, updated_at);

COMMIT;
