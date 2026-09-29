import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockClaimPendingQuotes,
  mockReclaimExpiredQuotes,
  mockReleaseQuoteClaim,
  mockFindQuoteById,
  mockCompleteQuote,
} = vi.hoisted(() => ({
  mockClaimPendingQuotes: vi.fn(),
  mockReclaimExpiredQuotes: vi.fn(),
  mockReleaseQuoteClaim: vi.fn(),
  mockFindQuoteById: vi.fn(),
  mockCompleteQuote: vi.fn(),
}));

vi.mock("../../src/quotes/quote.repository.js", () => ({
  claimPendingQuotes: mockClaimPendingQuotes,
  reclaimExpiredQuotes: mockReclaimExpiredQuotes,
  releaseQuoteClaim: mockReleaseQuoteClaim,
  findQuoteById: mockFindQuoteById,
}));

vi.mock("../../src/quotes/quote.completion.js", () => ({
  completeQuoteWithOutbox: mockCompleteQuote,
}));

import type { CarrierClient } from "../../src/carrier/carrier.types.js";
import { NODE_INSTANCE_ID } from "../../src/config/instance.js";
import { processPendingQuotes } from "../../src/quotes/quote.worker.js";

const claim1 = { quoteId: "q-1", version: 1 };
const claim2 = { quoteId: "q-2", version: 4 };

function quoteRow(id: string) {
  return {
    id,
    first_name: "Jane",
    last_name: "Driver",
    email: "jane@example.com",
    address: "1 Main St",
    make: "Toyota",
    model: "Camry",
    year: 2020,
    date_of_birth: "1990-01-01",
    vin: null,
    state: "TX",
    status: "PROCESSING",
    rejection_reason: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

let carrier: CarrierClient & { requestQuote: ReturnType<typeof vi.fn> };

describe("processPendingQuotes", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    carrier = {
      requestQuote: vi
        .fn()
        .mockResolvedValue({ carrierQuoteId: "cq", premiumCents: 1 }),
    };
    mockReclaimExpiredQuotes.mockResolvedValue([]);
    mockClaimPendingQuotes.mockResolvedValue([]);
    mockReleaseQuoteClaim.mockResolvedValue(true);
    mockFindQuoteById.mockImplementation(async (id: string) => quoteRow(id));
    mockCompleteQuote.mockResolvedValue({});
  });

  it("reclaims expired quotes first, then claims PENDING quotes with the remaining capacity", async () => {
    mockReclaimExpiredQuotes.mockResolvedValue([claim2]);
    mockClaimPendingQuotes.mockResolvedValue([claim1]);

    const completed = await processPendingQuotes(5, { carrier });

    expect(mockReclaimExpiredQuotes).toHaveBeenCalledWith(5, NODE_INSTANCE_ID);
    expect(mockClaimPendingQuotes).toHaveBeenCalledWith(4, NODE_INSTANCE_ID);
    expect(completed).toBe(2);
  });

  it("does not claim new quotes when reclaimed quotes fill the batch", async () => {
    mockReclaimExpiredQuotes.mockResolvedValue([claim1, claim2]);

    await processPendingQuotes(2, { carrier });

    expect(mockClaimPendingQuotes).not.toHaveBeenCalled();
  });

  it("calls the carrier with the quote's lifecycle key, then completes with the claim it received", async () => {
    mockClaimPendingQuotes.mockResolvedValue([claim1]);

    await processPendingQuotes(5, { carrier, workerId: "worker-x" });

    expect(mockClaimPendingQuotes).toHaveBeenCalledWith(5, "worker-x");
    expect(carrier.requestQuote).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "quote:q-1:rate" }),
    );
    expect(mockCompleteQuote).toHaveBeenCalledWith(claim1);
  });

  it("uses the same key for a reclaimed quote as for its first claim", async () => {
    mockClaimPendingQuotes.mockResolvedValueOnce([claim1]);
    await processPendingQuotes(5, { carrier });

    mockReclaimExpiredQuotes.mockResolvedValueOnce([{ quoteId: "q-1", version: 2 }]);
    await processPendingQuotes(5, { carrier });

    const keys = carrier.requestQuote.mock.calls.map(([req]) => req.idempotencyKey);
    expect(keys).toEqual(["quote:q-1:rate", "quote:q-1:rate"]);
  });

  it("does nothing when there is nothing to claim", async () => {
    expect(await processPendingQuotes(5, { carrier })).toBe(0);
    expect(carrier.requestQuote).not.toHaveBeenCalled();
    expect(mockCompleteQuote).not.toHaveBeenCalled();
  });

  it("releases the claim and skips completion when the carrier fails", async () => {
    mockClaimPendingQuotes.mockResolvedValue([claim1]);
    carrier.requestQuote.mockRejectedValueOnce(new Error("carrier down"));

    expect(await processPendingQuotes(5, { carrier })).toBe(0);
    expect(mockCompleteQuote).not.toHaveBeenCalled();
    expect(mockReleaseQuoteClaim).toHaveBeenCalledWith(claim1);
  });

  it("releases with the same claim version when completion fails", async () => {
    mockClaimPendingQuotes.mockResolvedValue([claim1, claim2]);
    mockCompleteQuote
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({});

    expect(await processPendingQuotes(5, { carrier })).toBe(1);
    expect(mockReleaseQuoteClaim).toHaveBeenCalledTimes(1);
    expect(mockReleaseQuoteClaim).toHaveBeenCalledWith(claim1);
  });

  it("warns and moves on when its release is fenced by a newer claim", async () => {
    mockClaimPendingQuotes.mockResolvedValue([claim1]);
    mockCompleteQuote.mockRejectedValueOnce(new Error("stale"));
    mockReleaseQuoteClaim.mockResolvedValueOnce(false);

    expect(await processPendingQuotes(5, { carrier })).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("claim version 1 is stale"),
    );
  });
});
