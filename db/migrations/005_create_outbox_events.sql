-- Transactional outbox for quote domain events

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

-- Efficiently find unpublished events in creation order
CREATE INDEX outbox_events_unpublished_created_at_idx
  ON outbox_events (created_at ASC)
  WHERE published_at IS NULL;
