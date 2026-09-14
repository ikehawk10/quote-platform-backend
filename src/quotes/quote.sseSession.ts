import type { Request, Response } from "express";
import {
  claimSseOwnership,
  refreshSseOwnership,
  releaseSseOwnership,
  SSE_OWNERSHIP_HEARTBEAT_MS,
} from "./quote.sseOwnership.js";
import { quoteSseHub, writeSseEvent } from "./quote.sse.js";

export type QuoteSseSession = {
  clientId: string;
  quoteId: string;
};

/**
 * Registers an in-memory SSE client, claims Redis ownership for this Node,
 * sends the initial connected event, and wires disconnect cleanup + TTL heartbeat.
 */
export async function openQuoteSseSession(
  quoteId: string,
  req: Request,
  res: Response,
): Promise<QuoteSseSession> {
  const client = quoteSseHub.add(quoteId, res);

  try {
    await claimSseOwnership(quoteId);
  } catch (error) {
    quoteSseHub.remove(quoteId, client.id);
    throw error;
  }

  const heartbeat = setInterval(() => {
    void refreshSseOwnership(quoteId).catch((error) => {
      console.error(
        `Failed to refresh SSE ownership for quote ${quoteId}:`,
        error,
      );
    });
  }, SSE_OWNERSHIP_HEARTBEAT_MS);

  // Don't keep the process alive solely because of heartbeats.
  heartbeat.unref?.();

  writeSseEvent(res, "connected", {
    quoteId,
    connectionId: client.id,
  });

  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;

    clearInterval(heartbeat);
    quoteSseHub.remove(quoteId, client.id);

    // Only release Redis ownership when this Node has no remaining clients
    // for the quote — and only if we still own the key.
    if (quoteSseHub.getClientCount(quoteId) === 0) {
      void releaseSseOwnership(quoteId).catch((error) => {
        console.error(
          `Failed to release SSE ownership for quote ${quoteId}:`,
          error,
        );
      });
    }

    req.off("close", cleanup);
    req.off("aborted", cleanup);
    res.off("close", cleanup);
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
  res.on("close", cleanup);

  return {
    clientId: client.id,
    quoteId,
  };
}
