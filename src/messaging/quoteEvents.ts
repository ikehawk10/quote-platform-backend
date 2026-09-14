import { z } from "zod";
import { NODE_INSTANCE_ID } from "../config/instance.js";

export const QUOTE_EVENTS_EXCHANGE = "quote-events";

export function quoteEventsQueueName(
  instanceId: string = NODE_INSTANCE_ID,
): string {
  return `quote-events.${instanceId}`;
}

export const quoteEventMessageSchema = z.object({
  quoteId: z.uuid(),
  event: z.string().trim().min(1),
});

export type QuoteEventMessage = z.infer<typeof quoteEventMessageSchema>;

export function parseQuoteEventMessage(content: Buffer): QuoteEventMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error("Quote event message is not valid JSON");
  }

  const result = quoteEventMessageSchema.safeParse(parsed);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    throw new Error(
      firstIssue?.message ?? "Quote event message failed validation",
    );
  }

  return result.data;
}
