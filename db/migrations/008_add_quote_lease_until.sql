-- Lease-based worker ownership: a PROCESSING quote is owned by claimed_by
-- until lease_until; after that another worker may reclaim it.

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS lease_until timestamptz;

-- Quotes claimed before leases existed get a lease that has already expired
-- relative to their claim, so they become reclaimable instead of stuck.
UPDATE quotes
SET lease_until = COALESCE(claimed_at, updated_at) + interval '60 seconds'
WHERE status = 'PROCESSING'
  AND lease_until IS NULL;

CREATE INDEX IF NOT EXISTS quotes_processing_lease_until_idx
  ON quotes (lease_until ASC)
  WHERE status = 'PROCESSING';
