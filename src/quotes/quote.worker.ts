import { completeQuoteWithOutbox } from "./quote.completion.js";
import * as quoteRepository from "./quote.repository.js";

const DEFAULT_BATCH_SIZE = 10;

/**
 * Minimal quote worker: claims PENDING quotes and completes them
 * through the transactional outbox boundary.
 */
export async function processPendingQuotes(
  limit = DEFAULT_BATCH_SIZE,
): Promise<number> {
  const quoteIds = await quoteRepository.findPendingQuoteIds(limit);
  let completed = 0;

  for (const quoteId of quoteIds) {
    try {
      await completeQuoteWithOutbox(quoteId);
      completed += 1;
    } catch (error) {
      console.error(`Quote worker failed to complete quote ${quoteId}:`, error);
    }
  }

  return completed;
}

export function startQuoteWorker(intervalMs = 2_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    void processPendingQuotes().catch((error) => {
      console.error("Quote worker tick failed:", error);
    });
  }, intervalMs);

  timer.unref?.();
  console.log(`Quote worker started (interval ${intervalMs}ms)`);
  return timer;
}
