import { describe, expect, it } from "vitest";
import {
  parseQuoteEventMessage,
  quoteEventsQueueName,
  QUOTE_EVENTS_EXCHANGE,
} from "../../src/messaging/quoteEvents.js";

describe("quoteEvents messaging helpers", () => {
  it("uses a durable-oriented naming scheme for exchange and queues", () => {
    expect(QUOTE_EVENTS_EXCHANGE).toBe("quote-events");
    expect(quoteEventsQueueName("node-2")).toBe("quote-events.node-2");
  });

  it("parses a valid quote event message", () => {
    const message = parseQuoteEventMessage(
      Buffer.from(
        JSON.stringify({
          quoteId: "11111111-1111-4111-8111-111111111111",
          event: "quote.completed",
        }),
      ),
    );

    expect(message).toEqual({
      quoteId: "11111111-1111-4111-8111-111111111111",
      event: "quote.completed",
    });
  });

  it("rejects invalid quote event messages", () => {
    expect(() =>
      parseQuoteEventMessage(Buffer.from(JSON.stringify({ event: "x" }))),
    ).toThrow();

    expect(() => parseQuoteEventMessage(Buffer.from("not-json"))).toThrow(
      /not valid JSON/,
    );
  });
});
