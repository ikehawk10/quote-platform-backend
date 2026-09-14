import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { QuoteSseHub, writeSseEvent } from "../../src/quotes/quote.sse.js";

function createMockResponse() {
  const writes: string[] = [];
  const res = {
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
  } as unknown as Response;

  return { res, writes };
}

describe("QuoteSseHub", () => {
  it("tracks clients per quote and removes them on cleanup", () => {
    const hub = new QuoteSseHub();
    const { res: first } = createMockResponse();
    const { res: second } = createMockResponse();

    const clientA = hub.add("quote-1", first);
    const clientB = hub.add("quote-1", second);

    expect(hub.getClientCount("quote-1")).toBe(2);
    expect(hub.getActiveQuoteIds()).toEqual(["quote-1"]);

    hub.remove("quote-1", clientA.id);
    expect(hub.getClientCount("quote-1")).toBe(1);

    hub.remove("quote-1", clientB.id);
    expect(hub.getClientCount("quote-1")).toBe(0);
    expect(hub.getActiveQuoteIds()).toEqual([]);
  });

  it("is a no-op when removing an unknown client", () => {
    const hub = new QuoteSseHub();
    expect(() => hub.remove("missing", "nope")).not.toThrow();
  });
});

describe("writeSseEvent", () => {
  it("writes SSE event and data frames", () => {
    const { res, writes } = createMockResponse();

    writeSseEvent(res, "connected", { quoteId: "abc" });

    expect(writes.join("")).toBe(
      'event: connected\ndata: {"quoteId":"abc"}\n\n',
    );
  });
});
