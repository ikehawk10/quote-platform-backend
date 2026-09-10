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

export const quotesRouter = Router();

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
