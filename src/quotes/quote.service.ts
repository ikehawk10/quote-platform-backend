import { randomUUID } from "node:crypto";
import {
  isSupportedState,
  unsupportedStateReason,
} from "../config/states.js";
import { AppError } from "../errors/AppError.js";
import * as quoteRepository from "./quote.repository.js";
import type { CreateQuoteInput, Quote } from "./quote.types.js";

export type AcceptedQuote = {
  id: string;
  status: "PENDING";
};

export async function createQuote(
  input: CreateQuoteInput,
): Promise<AcceptedQuote> {
  const id = randomUUID();

  if (!isSupportedState(input.state)) {
    const rejectionReason = unsupportedStateReason(input.state);
    const quote = await quoteRepository.insertQuote({
      id,
      make: input.make,
      model: input.model,
      year: input.year,
      date_of_birth: input.date_of_birth,
      vin: input.vin ?? null,
      state: input.state,
      status: "REJECTED",
      rejection_reason: rejectionReason,
    });

    throw AppError.badRequest("QUOTE_REJECTED", rejectionReason, {
      id: quote.id,
      status: quote.status,
      rejection_reason: quote.rejection_reason ?? rejectionReason,
    });
  }

  const quote = await quoteRepository.insertQuote({
    id,
    make: input.make,
    model: input.model,
    year: input.year,
    date_of_birth: input.date_of_birth,
    vin: input.vin ?? null,
    state: input.state,
    status: "PENDING",
    rejection_reason: null,
  });

  return {
    id: quote.id,
    status: "PENDING",
  };
}

export async function getQuoteById(id: string): Promise<Quote> {
  const quote = await quoteRepository.findQuoteById(id);

  if (!quote) {
    throw AppError.notFound("QUOTE_NOT_FOUND", "Quote not found");
  }

  return quote;
}
