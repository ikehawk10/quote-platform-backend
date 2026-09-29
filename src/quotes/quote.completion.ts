import { withTransaction } from "../db/transaction.js";
import * as outboxRepository from "../outbox/outbox.repository.js";
import * as quoteRepository from "./quote.repository.js";
import type { Quote, QuoteClaim } from "./quote.types.js";

export const QUOTE_COMPLETED_EVENT = "quote.completed";

export type CompletedQuoteResult = {
  quote: Quote;
  outboxEventId: string;
};

/**
 * Completes a quote and inserts the corresponding outbox event
 * in a single PostgreSQL transaction. Fails without side effects if
 * `claim` is no longer the current claim on the quote.
 */
export async function completeQuoteWithOutbox(
  claim: QuoteClaim,
): Promise<CompletedQuoteResult> {
  return withTransaction(async (client) => {
    const quote = await quoteRepository.markQuoteCompleted(claim, client);

    if (!quote) {
      throw new Error(
        `Quote ${claim.quoteId} was not eligible for completion (missing, not PROCESSING, or claim version ${claim.version} is stale)`,
      );
    }

    const outboxEvent = await outboxRepository.insertOutboxEvent(client, {
      event_type: QUOTE_COMPLETED_EVENT,
      aggregate_id: quote.id,
      payload: {
        quoteId: quote.id,
        event: QUOTE_COMPLETED_EVENT,
        status: quote.status,
      },
    });

    return {
      quote,
      outboxEventId: outboxEvent.id,
    };
  });
}
