-- Record which worker claimed a quote (PENDING -> PROCESSING) and when

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text;
