import type { NextFunction, Request, Response } from "express";
import * as quoteService from "./quote.service.js";
import { createQuoteSchema, quoteIdSchema } from "./quote.validation.js";

export async function createQuote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
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

    const result = await quoteService.createQuote(parsed.data);

    if (result.kind === "rejected") {
      res.status(400).json({
        error: "Quote rejected",
        id: result.id,
        status: result.status,
        rejection_reason: result.rejection_reason,
      });
      return;
    }

    res.status(202).json({
      id: result.id,
      status: result.status,
    });
  } catch (error) {
    next(error);
  }
}

export async function getQuoteById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
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

    const quote = await quoteService.getQuoteById(parsed.data);

    if (!quote) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    res.status(200).json(quote);
  } catch (error) {
    next(error);
  }
}
