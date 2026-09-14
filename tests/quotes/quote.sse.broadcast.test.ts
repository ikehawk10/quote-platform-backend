import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { QuoteSseHub } from "../../src/quotes/quote.sse.js";

function createMockResponse(shouldFail = false) {
  const writes: string[] = [];
  const res = {
    write: vi.fn((chunk: string) => {
      if (shouldFail) {
        throw new Error("write failed");
      }
      writes.push(chunk);
      return true;
    }),
  } as unknown as Response;

  return { res, writes };
}

describe("QuoteSseHub.broadcast", () => {
  it("returns 0 when no clients are connected", () => {
    const hub = new QuoteSseHub();
    expect(hub.broadcast("missing", "quote.updated")).toBe(0);
  });

  it("writes the event to all active clients for a quote", () => {
    const hub = new QuoteSseHub();
    const first = createMockResponse();
    const second = createMockResponse();

    hub.add("quote-1", first.res);
    hub.add("quote-1", second.res);

    const sent = hub.broadcast("quote-1", "quote.completed", {
      quoteId: "quote-1",
    });

    expect(sent).toBe(2);
    expect(first.writes.join("")).toContain("event: quote.completed");
    expect(second.writes.join("")).toContain('"quoteId":"quote-1"');
  });

  it("continues broadcasting when one client write fails", () => {
    const hub = new QuoteSseHub();
    const failing = createMockResponse(true);
    const healthy = createMockResponse();

    hub.add("quote-2", failing.res);
    hub.add("quote-2", healthy.res);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const sent = hub.broadcast("quote-2", "quote.failed", { ok: false });

    expect(sent).toBe(1);
    expect(healthy.writes.join("")).toContain("event: quote.failed");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
