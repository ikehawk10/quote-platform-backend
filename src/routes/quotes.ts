import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import {
  US_STATE_CODES,
  isSupportedState,
  unsupportedStateReason,
} from "../config/states.js";
import { pool } from "../db.js";

const createQuoteSchema = z.object({
  make: z.string().trim().min(1, "make is required"),
  model: z.string().trim().min(1, "model is required"),
  year: z
    .number({ error: "year must be a number" })
    .int("year must be an integer")
    .min(1900, "year must be >= 1900")
    .max(2100, "year must be <= 2100"),
  date_of_birth: z
    .iso.date("date_of_birth must be YYYY-MM-DD")
    .refine(isAtLeast18, {
      message: "Applicant must be at least 18 years old",
    }),
  vin: z.string().trim().min(1, "vin cannot be empty").optional(),
  state: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(
      z.enum(US_STATE_CODES, {
        error: "state must be a valid US state code",
      }),
    ),
});

function isAtLeast18(dateOfBirth: string, today = new Date()): boolean {
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  let age = today.getFullYear() - year;
  const hasHadBirthdayThisYear =
    today.getMonth() + 1 > month ||
    (today.getMonth() + 1 === month && today.getDate() >= day);

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }

  return age >= 18;
}

const quoteIdSchema = z.uuid("id must be a valid UUID");

type QuoteRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  date_of_birth: string;
  vin: string | null;
  state: string;
  status: string;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

export const quotesRouter = Router();

quotesRouter.get("/:id", async (req, res, next) => {
  try {
    const parsed = quoteIdSchema.safeParse(req.params.id);

    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.issues.map((issue) => ({
          field: "id",
          message: issue.message,
        })),
      });
      return;
    }

    const result = await pool.query<QuoteRow>(
      `SELECT id, make, model, year, date_of_birth::text AS date_of_birth, vin,
              state, status, rejection_reason, created_at, updated_at
       FROM quotes
       WHERE id = $1`,
      [parsed.data],
    );

    const quote = result.rows[0];

    if (!quote) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    res.status(200).json({
      id: quote.id,
      make: quote.make,
      model: quote.model,
      year: quote.year,
      date_of_birth: quote.date_of_birth,
      vin: quote.vin,
      state: quote.state,
      status: quote.status,
      rejection_reason: quote.rejection_reason,
      created_at: quote.created_at,
      updated_at: quote.updated_at,
    });
  } catch (error) {
    next(error);
  }
});

quotesRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createQuoteSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || undefined,
          message: issue.message,
        })),
      });
      return;
    }

    const { make, model, year, date_of_birth, vin, state } = parsed.data;
    const id = randomUUID();

    if (!isSupportedState(state)) {
      const rejectionReason = unsupportedStateReason(state);

      const result = await pool.query<{
        id: string;
        status: string;
        rejection_reason: string | null;
      }>(
        `INSERT INTO quotes (
           id, make, model, year, date_of_birth, vin, state, status, rejection_reason
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, status, rejection_reason`,
        [
          id,
          make,
          model,
          year,
          date_of_birth,
          vin ?? null,
          state,
          "REJECTED",
          rejectionReason,
        ],
      );

      const quote = result.rows[0];

      res.status(400).json({
        error: "Quote rejected",
        id: quote.id,
        status: quote.status,
        rejection_reason: quote.rejection_reason,
      });
      return;
    }

    const result = await pool.query<{ id: string; status: string }>(
      `INSERT INTO quotes (
         id, make, model, year, date_of_birth, vin, state, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, status`,
      [id, make, model, year, date_of_birth, vin ?? null, state, "PENDING"],
    );

    const quote = result.rows[0];

    res.status(202).json({
      id: quote.id,
      status: quote.status,
    });
  } catch (error) {
    next(error);
  }
});
