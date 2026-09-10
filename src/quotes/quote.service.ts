import { randomUUID } from "node:crypto";
import {
  isSupportedState,
  unsupportedStateReason,
} from "../config/states.js";
import * as quoteRepository from "./quote.repository.js";
import type { CreateQuoteInput, CreateQuoteResult, Quote } from "./quote.types.js";

export async function createQuote(
  input: CreateQuoteInput,
): Promise<CreateQuoteResult> {
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

    return {
      kind: "rejected",
      id: quote.id,
      status: "REJECTED",
      rejection_reason: quote.rejection_reason ?? rejectionReason,
    };
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
    kind: "accepted",
    id: quote.id,
    status: "PENDING",
  };
}

export async function getQuoteById(id: string): Promise<Quote | null> {
  return quoteRepository.findQuoteById(id);
}
