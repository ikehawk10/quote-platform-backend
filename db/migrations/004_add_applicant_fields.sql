-- Add applicant identity and address fields

ALTER TABLE quotes
  ADD COLUMN first_name text NOT NULL DEFAULT '',
  ADD COLUMN last_name text NOT NULL DEFAULT '',
  ADD COLUMN email text NOT NULL DEFAULT '',
  ADD COLUMN address text NOT NULL DEFAULT '';

ALTER TABLE quotes
  ALTER COLUMN first_name DROP DEFAULT,
  ALTER COLUMN last_name DROP DEFAULT,
  ALTER COLUMN email DROP DEFAULT,
  ALTER COLUMN address DROP DEFAULT;
