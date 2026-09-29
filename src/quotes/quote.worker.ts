import { getCarrierClient } from "../carrier/carrier.client.js";
import type { CarrierClient } from "../carrier/carrier.types.js";
import { NODE_INSTANCE_ID } from "../config/instance.js";
import { requestCarrierQuote } from "./quote.carrier.js";
import { completeQuoteWithOutbox } from "./quote.completion.js";
import * as quoteRepository from "./quote.repository.js";
import type { QuoteClaim } from "./quote.types.js";

const DEFAULT_BATCH_SIZE = 10;

export type ProcessQuotesOptions = {
  carrier?: CarrierClient;
  workerId?: string;
};

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
 * Carrier call, then completion, for one claim. On any failure the claim is
 * released so a later tick retries; the retry reuses the same idempotency
 * key, so a carrier call that already succeeded is replayed, not redone.
 */
export async function processClaim(
  claim: QuoteClaim,
  carrier: CarrierClient,
): Promise<boolean> {
  try {
    const quote = await quoteRepository.findQuoteById(claim.quoteId);
    if (!quote) {
      throw new Error(`Quote ${claim.quoteId} no longer exists`);
    }

    await requestCarrierQuote(carrier, quote);
    await completeQuoteWithOutbox(claim);
    return true;
  } catch (error) {
    console.error(
      `Quote worker failed to process quote ${claim.quoteId}:`,
      error,
    );
    await releaseClaim(claim);
    return false;
  }
}

/**
 * Takes over quotes whose lease expired, then claims PENDING quotes with any
 * remaining capacity, and processes every claim.
 */
export async function processPendingQuotes(
  limit = DEFAULT_BATCH_SIZE,
  options: ProcessQuotesOptions = {},
): Promise<number> {
  const carrier = options.carrier ?? getCarrierClient();
  const workerId = options.workerId ?? NODE_INSTANCE_ID;

  // Claims commit on their own. Carrier calls run with no transaction open;
  // only completeQuoteWithOutbox opens one.
  const reclaimed = await quoteRepository.reclaimExpiredQuotes(limit, workerId);
  const claimed =
    reclaimed.length < limit
      ? await quoteRepository.claimPendingQuotes(
          limit - reclaimed.length,
          workerId,
        )
      : [];

  // Processed concurrently so the whole batch finishes within one lease.
  const results = await Promise.all(
    [...reclaimed, ...claimed].map((claim) => processClaim(claim, carrier)),
  );

  return results.filter(Boolean).length;
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
