-- Outbox retry / backoff for unpublished events

ALTER TABLE outbox_events
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();

DROP INDEX IF EXISTS outbox_events_unpublished_created_at_idx;

CREATE INDEX outbox_events_due_unpublished_idx
  ON outbox_events (next_attempt_at ASC, created_at ASC)
  WHERE published_at IS NULL;
