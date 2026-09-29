import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockClaimPendingQuotes, mockReleaseQuoteClaim, mockCompleteQuote } =
  vi.hoisted(() => ({
    mockClaimPendingQuotes: vi.fn(),
    mockReleaseQuoteClaim: vi.fn(),
    mockCompleteQuote: vi.fn(),
  }));

vi.mock("../../src/quotes/quote.repository.js", () => ({
  claimPendingQuotes: mockClaimPendingQuotes,
  releaseQuoteClaim: mockReleaseQuoteClaim,
}));

vi.mock("../../src/quotes/quote.completion.js", () => ({
  completeQuoteWithOutbox: mockCompleteQuote,
}));

import { NODE_INSTANCE_ID } from "../../src/config/instance.js";
import { processPendingQuotes } from "../../src/quotes/quote.worker.js";

const claim1 = { quoteId: "q-1", version: 1 };
const claim2 = { quoteId: "q-2", version: 4 };

describe("processPendingQuotes", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockReleaseQuoteClaim.mockResolvedValue(true);
  });

  it("claims as this instance and completes each quote with the version it received", async () => {
    mockClaimPendingQuotes.mockResolvedValue([claim1, claim2]);
    mockCompleteQuote.mockResolvedValue({});

    const completed = await processPendingQuotes(5);

    expect(mockClaimPendingQuotes).toHaveBeenCalledWith(5, NODE_INSTANCE_ID);
    expect(mockCompleteQuote.mock.calls).toEqual([[claim1], [claim2]]);
    expect(completed).toBe(2);
    expect(mockReleaseQuoteClaim).not.toHaveBeenCalled();
  });

  it("does nothing when another worker already claimed everything", async () => {
    mockClaimPendingQuotes.mockResolvedValue([]);

    expect(await processPendingQuotes()).toBe(0);
    expect(mockCompleteQuote).not.toHaveBeenCalled();
  });

  it("releases with the same claim version when completion fails", async () => {
    mockClaimPendingQuotes.mockResolvedValue([claim1, claim2]);
    mockCompleteQuote
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({});

    const completed = await processPendingQuotes();

    expect(completed).toBe(1);
    expect(mockReleaseQuoteClaim).toHaveBeenCalledTimes(1);
    expect(mockReleaseQuoteClaim).toHaveBeenCalledWith(claim1);
  });

  it("warns and moves on when its release is fenced by a newer claim", async () => {
    mockClaimPendingQuotes.mockResolvedValue([claim1]);
    mockCompleteQuote.mockRejectedValueOnce(new Error("stale"));
    mockReleaseQuoteClaim.mockResolvedValueOnce(false);

    expect(await processPendingQuotes()).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("claim version 1 is stale"),
    );
  });
});
