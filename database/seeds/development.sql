INSERT INTO users (id, email, display_name)
VALUES ('0198d4f3-2f34-7c52-95cc-7ff4f6f93a12', 'journey@example.test', 'Journey Explorer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO agents (id, user_id, name)
VALUES (
  '0198d4f3-4a10-7851-a56d-bacbd2d90fb0',
  '0198d4f3-2f34-7c52-95cc-7ff4f6f93a12',
  'Reso Agent'
)
ON CONFLICT (id) DO NOTHING;

