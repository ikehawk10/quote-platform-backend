import { NODE_INSTANCE_ID } from "../config/instance.js";
import { completeQuoteWithOutbox } from "./quote.completion.js";
import * as quoteRepository from "./quote.repository.js";

const DEFAULT_BATCH_SIZE = 10;

async function releaseClaim(quoteId: string): Promise<void> {
  try {
    await quoteRepository.releaseQuoteClaim(quoteId);
  } catch (error) {
    console.error(`Quote worker failed to release claim on quote ${quoteId}:`, error);
  }
}

/**
 * Claims PENDING quotes (PENDING → PROCESSING) and completes each one
 * through the transactional outbox boundary.
 */
export async function processPendingQuotes(
  limit = DEFAULT_BATCH_SIZE,
): Promise<number> {
  // The claim commits on its own. Carrier calls must happen here, outside
  // any open transaction; only completeQuoteWithOutbox opens one.
  const quoteIds = await quoteRepository.claimPendingQuotes(
    limit,
    NODE_INSTANCE_ID,
  );
  let completed = 0;

  for (const quoteId of quoteIds) {
    try {
      await completeQuoteWithOutbox(quoteId);
      completed += 1;
    } catch (error) {
      console.error(`Quote worker failed to complete quote ${quoteId}:`, error);
      await releaseClaim(quoteId);
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
