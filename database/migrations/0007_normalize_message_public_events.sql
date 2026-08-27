-- Ownership: Product Backend / Conversation domain.
-- Forward-only repair for JSON arrays that were encoded as a single JSON
-- object by the PostgreSQL driver. Public events must always remain an array.
-- Rollback strategy: no rollback; converting an object into a one-item array
-- preserves the complete event while restoring the shared Contract shape.

BEGIN;

UPDATE messages
SET public_events = '[]'::jsonb
WHERE public_events = '{}'::jsonb;

UPDATE messages
SET public_events = jsonb_build_array(public_events)
WHERE jsonb_typeof(public_events) = 'object';

UPDATE messages
SET public_events = '[]'::jsonb
WHERE public_events IS NULL OR jsonb_typeof(public_events) <> 'array';

ALTER TABLE messages
  ADD CONSTRAINT messages_public_events_array
  CHECK (jsonb_typeof(public_events) = 'array');

COMMIT;
