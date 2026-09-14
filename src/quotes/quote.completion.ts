import { withTransaction } from "../db/transaction.js";
import * as outboxRepository from "../outbox/outbox.repository.js";
import * as quoteRepository from "./quote.repository.js";
import type { Quote } from "./quote.types.js";

export const QUOTE_COMPLETED_EVENT = "quote.completed";

export type CompletedQuoteResult = {
  quote: Quote;
  outboxEventId: string;
};

/**
 * Completes a quote and inserts the corresponding outbox event
 * in a single PostgreSQL transaction.
 */
export async function completeQuoteWithOutbox(
  quoteId: string,
): Promise<CompletedQuoteResult> {
  return withTransaction(async (client) => {
    const quote = await quoteRepository.markQuoteCompleted(quoteId, client);

    if (!quote) {
      throw new Error(
        `Quote ${quoteId} was not eligible for completion (missing or already terminal)`,
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
