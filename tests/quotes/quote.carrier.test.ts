import { describe, expect, it, vi } from "vitest";
import type { CarrierClient } from "../../src/carrier/carrier.types.js";
import {
  carrierIdempotencyKey,
  requestCarrierQuote,
  toCarrierQuotePayload,
} from "../../src/quotes/quote.carrier.js";
import type { Quote } from "../../src/quotes/quote.types.js";

const quote: Quote = {
  id: "11111111-1111-4111-8111-111111111111",
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
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
};

describe("carrierIdempotencyKey", () => {
  it("is derived only from the quote ID", () => {
    expect(carrierIdempotencyKey(quote.id)).toBe(`quote:${quote.id}:rate`);
    expect(carrierIdempotencyKey(quote.id)).toBe(carrierIdempotencyKey(quote.id));
  });

  it("differs between quotes", () => {
    expect(carrierIdempotencyKey(quote.id)).not.toBe(
      carrierIdempotencyKey("22222222-2222-4222-8222-222222222222"),
    );
  });
});

describe("requestCarrierQuote", () => {
  it("sends the lifecycle key with the request", async () => {
    const carrier: CarrierClient = {
      requestQuote: vi.fn().mockResolvedValue({
        carrierQuoteId: "cq-1",
        premiumCents: 100_000,
      }),
    };

    await requestCarrierQuote(carrier, quote);

    expect(carrier.requestQuote).toHaveBeenCalledWith({
      idempotencyKey: `quote:${quote.id}:rate`,
      payload: toCarrierQuotePayload(quote),
    });
  });

  it("sends an identical request regardless of mutable quote state", async () => {
    const carrier: CarrierClient = {
      requestQuote: vi.fn().mockResolvedValue({
        carrierQuoteId: "cq-1",
        premiumCents: 100_000,
      }),
    };

    await requestCarrierQuote(carrier, quote);
    await requestCarrierQuote(carrier, {
      ...quote,
      status: "PENDING",
      updated_at: new Date(),
    });

    const [first, second] = vi.mocked(carrier.requestQuote).mock.calls;
    expect(second).toEqual(first);
  });
});
