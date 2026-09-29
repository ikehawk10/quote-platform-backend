import type {
  CarrierClient,
  CarrierQuotePayload,
  CarrierQuoteResponse,
} from "../carrier/carrier.types.js";
import type { Quote } from "./quote.types.js";

/**
 * Derived only from the immutable quote ID so every worker, retry, and
 * reclaim sends the same key for the quote's whole lifecycle. Must never
 * include claim_version, worker ID, attempt number, or time.
 */
export function carrierIdempotencyKey(quoteId: string): string {
  return `quote:${quoteId}:rate`;
}

/** Built only from fields that never change after insert, so retries send an identical body. */
export function toCarrierQuotePayload(quote: Quote): CarrierQuotePayload {
  return {
    quoteId: quote.id,
    applicant: {
      firstName: quote.first_name,
      lastName: quote.last_name,
      email: quote.email,
      dateOfBirth: quote.date_of_birth,
      address: quote.address,
      state: quote.state,
    },
    vehicle: {
      year: quote.year,
      make: quote.make,
      model: quote.model,
      vin: quote.vin,
    },
  };
}

export async function requestCarrierQuote(
  carrier: CarrierClient,
  quote: Quote,
): Promise<CarrierQuoteResponse> {
  return carrier.requestQuote({
    idempotencyKey: carrierIdempotencyKey(quote.id),
    payload: toCarrierQuotePayload(quote),
  });
}
