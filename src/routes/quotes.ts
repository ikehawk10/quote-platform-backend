import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";

const createQuoteSchema = z.object({
  make: z.string().trim().min(1, "make is required"),
  model: z.string().trim().min(1, "model is required"),
  year: z
    .number({ error: "year must be a number" })
    .int("year must be an integer")
    .min(1900, "year must be >= 1900")
    .max(2100, "year must be <= 2100"),
});

const quoteIdSchema = z.uuid("id must be a valid UUID");

type QuoteRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  status: string;
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
      `SELECT id, make, model, year, status, created_at, updated_at
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
      status: quote.status,
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

    const { make, model, year } = parsed.data;
    const id = randomUUID();
    const status = "PENDING" as const;

    const result = await pool.query<{ id: string; status: string }>(
      `INSERT INTO quotes (id, make, model, year, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status`,
      [id, make, model, year, status],
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
