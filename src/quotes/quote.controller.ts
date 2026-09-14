import type { Request, Response } from "express";
import { AppError } from "../errors/AppError.js";
import * as quoteService from "./quote.service.js";
import { quoteSseHub, writeSseEvent } from "./quote.sse.js";
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

export async function streamQuoteEvents(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = quoteIdSchema.safeParse(req.params.id);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw AppError.validation(firstIssue?.message ?? "Validation failed");
  }

  const quoteId = parsed.data;

  // Verify existence before opening the stream (404 if missing).
  await quoteService.assertQuoteExists(quoteId);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const client = quoteSseHub.add(quoteId, res);

  writeSseEvent(res, "connected", {
    quoteId,
    connectionId: client.id,
  });

  const cleanup = () => {
    quoteSseHub.remove(quoteId, client.id);
    req.off("close", cleanup);
    req.off("aborted", cleanup);
    res.off("close", cleanup);
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
  res.on("close", cleanup);
}
