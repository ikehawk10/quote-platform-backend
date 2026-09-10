import { pool } from "../db.js";
import type { CreateQuoteInput, Quote, QuoteStatus } from "./quote.types.js";

type QuoteRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  date_of_birth: string;
  vin: string | null;
  state: string;
  status: QuoteStatus;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapRow(row: QuoteRow): Quote {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    year: row.year,
    date_of_birth: row.date_of_birth,
    vin: row.vin,
    state: row.state,
    status: row.status,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function insertQuote(input: {
  id: string;
  make: string;
  model: string;
  year: number;
  date_of_birth: string;
  vin: string | null;
  state: string;
  status: QuoteStatus;
  rejection_reason: string | null;
}): Promise<Pick<Quote, "id" | "status" | "rejection_reason">> {
  const result = await pool.query<{
    id: string;
    status: QuoteStatus;
    rejection_reason: string | null;
  }>(
    `INSERT INTO quotes (
       id, make, model, year, date_of_birth, vin, state, status, rejection_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, status, rejection_reason`,
    [
      input.id,
      input.make,
      input.model,
      input.year,
      input.date_of_birth,
      input.vin,
      input.state,
      input.status,
      input.rejection_reason,
    ],
  );

  return result.rows[0];
}

export async function findQuoteById(id: string): Promise<Quote | null> {
  const result = await pool.query<QuoteRow>(
    `SELECT id, make, model, year, date_of_birth::text AS date_of_birth, vin,
            state, status, rejection_reason, created_at, updated_at
     FROM quotes
     WHERE id = $1`,
    [id],
  );

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export type { CreateQuoteInput };
