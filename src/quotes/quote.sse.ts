import { randomUUID } from "node:crypto";
import type { Response } from "express";

export type SseClient = {
  id: string;
  quoteId: string;
  res: Response;
};

/**
 * In-memory registry of active quote SSE connections.
 * Keeps connection bookkeeping out of controllers/services.
 */
export class QuoteSseHub {
  private readonly clientsByQuoteId = new Map<string, Map<string, SseClient>>();

  add(quoteId: string, res: Response): SseClient {
    const client: SseClient = {
      id: randomUUID(),
      quoteId,
      res,
    };

    let clients = this.clientsByQuoteId.get(quoteId);
    if (!clients) {
      clients = new Map();
      this.clientsByQuoteId.set(quoteId, clients);
    }

    clients.set(client.id, client);
    return client;
  }

  remove(quoteId: string, clientId: string): void {
    const clients = this.clientsByQuoteId.get(quoteId);
    if (!clients) {
      return;
    }

    clients.delete(clientId);

    if (clients.size === 0) {
      this.clientsByQuoteId.delete(quoteId);
    }
  }

  getClientCount(quoteId: string): number {
    return this.clientsByQuoteId.get(quoteId)?.size ?? 0;
  }

  /** Useful for tests / future broadcast work. */
  getActiveQuoteIds(): string[] {
    return [...this.clientsByQuoteId.keys()];
  }

  /** Test helper to reset in-memory connections. */
  clear(): void {
    this.clientsByQuoteId.clear();
  }
}

export const quoteSseHub = new QuoteSseHub();

export function writeSseEvent(
  res: Response,
  event: string,
  data: unknown,
): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
