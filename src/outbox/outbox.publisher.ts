import { publishQuoteEvent } from "../messaging/rabbitmq.js";
import type { QuoteEventMessage } from "../messaging/quoteEvents.js";
import * as outboxRepository from "../outbox/outbox.repository.js";
import type { OutboxEvent } from "../outbox/outbox.types.js";
import { getSseOwner } from "../quotes/quote.sseOwnership.js";

const DEFAULT_BATCH_SIZE = 50;

/** Give up on SSE notification delivery after this many no-owner/publish failures. */
export const OUTBOX_MAX_ATTEMPTS = 8;

/** Base delay for exponential backoff (seconds): 5, 10, 20, ... capped. */
const OUTBOX_BACKOFF_BASE_SECONDS = 5;
const OUTBOX_BACKOFF_MAX_SECONDS = 5 * 60;

export function nextOutboxAttemptAt(attemptCountAfterIncrement: number): Date {
  const exp = Math.max(0, attemptCountAfterIncrement - 1);
  const delaySeconds = Math.min(
    OUTBOX_BACKOFF_MAX_SECONDS,
    OUTBOX_BACKOFF_BASE_SECONDS * 2 ** exp,
  );
  return new Date(Date.now() + delaySeconds * 1000);
}

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
  abandoned: number;
  failed: number;
};

async function deferOrAbandon(
  event: OutboxEvent,
  reason: string,
): Promise<"deferred" | "abandoned"> {
  const nextAttemptNumber = event.attempt_count + 1;

  if (nextAttemptNumber >= OUTBOX_MAX_ATTEMPTS) {
    await outboxRepository.markOutboxEventPublished(event.id);
    console.warn(
      `Outbox event ${event.id} abandoned after ${nextAttemptNumber} attempts (${reason}); quote ${event.aggregate_id} remains available via GET /quotes/:id`,
    );
    return "abandoned";
  }

  const nextAttemptAt = nextOutboxAttemptAt(nextAttemptNumber);
  await outboxRepository.scheduleOutboxRetry(event.id, nextAttemptAt);

  // Log only on the first deferral for this event to avoid spam.
  if (event.attempt_count === 0) {
    console.log(
      `Outbox event ${event.id} has no SSE owner for quote ${event.aggregate_id}; retrying with backoff (next at ${nextAttemptAt.toISOString()})`,
    );
  }

  return "deferred";
}

/**
 * Publishes unpublished outbox events that are due for attempt.
 *
 * No SSE owner / transient failures use exponential backoff.
 * After OUTBOX_MAX_ATTEMPTS, the event is marked published to stop retries
 * (Postgres quote state remains the durable source of truth).
 */
export async function publishUnpublishedOutboxEvents(
  limit = DEFAULT_BATCH_SIZE,
): Promise<PublishOutboxResult> {
  const events = await outboxRepository.findUnpublishedOutboxEvents(limit);
  const result: PublishOutboxResult = {
    published: 0,
    deferredNoOwner: 0,
    abandoned: 0,
    failed: 0,
  };

  for (const event of events) {
    try {
      const ownerInstanceId = await getSseOwner(event.aggregate_id);

      if (!ownerInstanceId) {
        const outcome = await deferOrAbandon(event, "no SSE owner");
        if (outcome === "abandoned") {
          result.abandoned += 1;
        } else {
          result.deferredNoOwner += 1;
        }
        continue;
      }

      const message = toQuoteEventMessage(event);
      await publishQuoteEvent(ownerInstanceId, message);

      // Mark published only after RabbitMQ accepts the message.
      await outboxRepository.markOutboxEventPublished(event.id);
      result.published += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Failed to publish outbox event ${event.id}:`, error);

      try {
        const outcome = await deferOrAbandon(event, "publish failure");
        if (outcome === "abandoned") {
          result.abandoned += 1;
          result.failed -= 1;
        }
      } catch (scheduleError) {
        console.error(
          `Failed to schedule retry for outbox event ${event.id}:`,
          scheduleError,
        );
      }
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
