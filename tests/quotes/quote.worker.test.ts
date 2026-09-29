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

describe("processPendingQuotes", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("claims up to the batch size as this instance and completes only the claimed quotes", async () => {
    mockClaimPendingQuotes.mockResolvedValue(["q-1", "q-2"]);
    mockCompleteQuote.mockResolvedValue({});

    const completed = await processPendingQuotes(5);

    expect(mockClaimPendingQuotes).toHaveBeenCalledWith(5, NODE_INSTANCE_ID);
    expect(mockCompleteQuote.mock.calls).toEqual([["q-1"], ["q-2"]]);
    expect(completed).toBe(2);
    expect(mockReleaseQuoteClaim).not.toHaveBeenCalled();
  });

  it("does nothing when another worker already claimed everything", async () => {
    mockClaimPendingQuotes.mockResolvedValue([]);

    expect(await processPendingQuotes()).toBe(0);
    expect(mockCompleteQuote).not.toHaveBeenCalled();
  });

  it("releases the claim when completion fails so the quote is retried", async () => {
    mockClaimPendingQuotes.mockResolvedValue(["q-1", "q-2"]);
    mockCompleteQuote
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({});

    const completed = await processPendingQuotes();

    expect(completed).toBe(1);
    expect(mockReleaseQuoteClaim).toHaveBeenCalledWith("q-1");
    expect(mockReleaseQuoteClaim).toHaveBeenCalledTimes(1);
  });
});
