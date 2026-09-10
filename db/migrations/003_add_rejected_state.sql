-- Add REJECTED status, state, and rejection_reason

ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE quotes
  ADD COLUMN state text NOT NULL DEFAULT 'XX',
  ADD COLUMN rejection_reason text;

ALTER TABLE quotes
  ALTER COLUMN state DROP DEFAULT;
