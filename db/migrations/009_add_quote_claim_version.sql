-- Fencing token for worker ownership. Every claim/reclaim increments it;
-- a worker may only complete or release a quote while its version matches.
-- Never reset or decrement: stale workers are fenced by the value moving on.

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS claim_version integer NOT NULL DEFAULT 0;
