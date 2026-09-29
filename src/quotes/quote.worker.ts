import { NODE_INSTANCE_ID } from "../config/instance.js";
import { completeQuoteWithOutbox } from "./quote.completion.js";
import * as quoteRepository from "./quote.repository.js";
import type { QuoteClaim } from "./quote.types.js";

const DEFAULT_BATCH_SIZE = 10;

async function releaseClaim(claim: QuoteClaim): Promise<void> {
  try {
    const released = await quoteRepository.releaseQuoteClaim(claim);
    if (!released) {
      console.warn(
        `Quote worker no longer owns quote ${claim.quoteId} (claim version ${claim.version} is stale); leaving it to the current owner`,
      );
    }
  } catch (error) {
    console.error(
      `Quote worker failed to release claim on quote ${claim.quoteId}:`,
      error,
    );
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
  const claims = await quoteRepository.claimPendingQuotes(
    limit,
    NODE_INSTANCE_ID,
  );
  let completed = 0;

  for (const claim of claims) {
    try {
      await completeQuoteWithOutbox(claim);
      completed += 1;
    } catch (error) {
      console.error(
        `Quote worker failed to complete quote ${claim.quoteId}:`,
        error,
      );
      await releaseClaim(claim);
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
