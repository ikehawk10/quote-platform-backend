import { publishQuoteEvent } from "../messaging/rabbitmq.js";
import type { QuoteEventMessage } from "../messaging/quoteEvents.js";
import * as outboxRepository from "../outbox/outbox.repository.js";
import type { OutboxEvent } from "../outbox/outbox.types.js";
import { getSseOwner } from "../quotes/quote.sseOwnership.js";

const DEFAULT_BATCH_SIZE = 50;

function toQuoteEventMessage(event: OutboxEvent): QuoteEventMessage {
  const quoteId =
    typeof event.payload.quoteId === "string"
      ? event.payload.quoteId
      : event.aggregate_id;

  const eventName =
    typeof event.payload.event === "string"
      ? event.payload.event
      : event.event_type;

  return {
    quoteId,
    event: eventName,
  };
}

export type PublishOutboxResult = {
  published: number;
  deferredNoOwner: number;
  failed: number;
};

/**
 * Publishes unpublished outbox events to RabbitMQ.
 *
 * If Redis has no SSE owner for the quote, the event is left unpublished
 * and retried on a later tick. Postgres remains the source of truth, so
 * clients can still recover via GET /quotes/:id.
 */
export async function publishUnpublishedOutboxEvents(
  limit = DEFAULT_BATCH_SIZE,
): Promise<PublishOutboxResult> {
  const events = await outboxRepository.findUnpublishedOutboxEvents(limit);
  const result: PublishOutboxResult = {
    published: 0,
    deferredNoOwner: 0,
    failed: 0,
  };

  for (const event of events) {
    try {
      const ownerInstanceId = await getSseOwner(event.aggregate_id);

      if (!ownerInstanceId) {
        result.deferredNoOwner += 1;
        console.log(
          `Outbox event ${event.id} has no SSE owner for quote ${event.aggregate_id}; leaving unpublished for retry`,
        );
        continue;
      }

      const message = toQuoteEventMessage(event);
      await publishQuoteEvent(ownerInstanceId, message);

      // Mark published only after RabbitMQ accepts the message.
      // If we crash between publish and this update, at-least-once
      // delivery will republish on the next tick.
      await outboxRepository.markOutboxEventPublished(event.id);
      result.published += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Failed to publish outbox event ${event.id}:`, error);
    }
  }

  return result;
}

export function startOutboxPublisher(intervalMs = 1_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    void publishUnpublishedOutboxEvents().catch((error) => {
      console.error("Outbox publisher tick failed:", error);
    });
  }, intervalMs);

  timer.unref?.();
  console.log(`Outbox publisher started (interval ${intervalMs}ms)`);
  return timer;
}
