-- Add required date_of_birth and optional vin to quotes

ALTER TABLE quotes
  ADD COLUMN date_of_birth date NOT NULL DEFAULT '1900-01-01',
  ADD COLUMN vin text;

ALTER TABLE quotes
  ALTER COLUMN date_of_birth DROP DEFAULT;
