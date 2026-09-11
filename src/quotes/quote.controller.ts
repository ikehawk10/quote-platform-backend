import type { Request, Response } from "express";
import { AppError } from "../errors/AppError.js";
import * as quoteService from "./quote.service.js";
import { createQuoteSchema, quoteIdSchema } from "./quote.validation.js";

export async function createQuote(req: Request, res: Response): Promise<void> {
  const parsed = createQuoteSchema.safeParse(req.body);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw AppError.validation(
      firstIssue?.message ?? "Validation failed",
    );
  }

  const quote = await quoteService.createQuote(parsed.data);

  res.status(202).json({
    id: quote.id,
    status: quote.status,
  });
}

export async function getQuoteById(req: Request, res: Response): Promise<void> {
  const parsed = quoteIdSchema.safeParse(req.params.id);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw AppError.validation(firstIssue?.message ?? "Validation failed");
  }

  const quote = await quoteService.getQuoteById(parsed.data);
  res.status(200).json(quote);
}
