import { describe, expect, it } from "vitest";
import { SimulatedCarrierClient } from "../../src/carrier/carrier.simulated.js";
import type { CarrierQuoteRequest } from "../../src/carrier/carrier.types.js";

function request(
  idempotencyKey: string,
  overrides: Partial<CarrierQuoteRequest["payload"]["vehicle"]> = {},
): CarrierQuoteRequest {
  return {
    idempotencyKey,
    payload: {
      quoteId: "q-1",
      applicant: {
        firstName: "Jane",
        lastName: "Driver",
        email: "jane@example.com",
        dateOfBirth: "1990-01-01",
        address: "1 Main St",
        state: "TX",
      },
      vehicle: { year: 2020, make: "Toyota", model: "Camry", vin: null, ...overrides },
    },
  };
}

describe("SimulatedCarrierClient", () => {
  it("performs the work once per key and replays the stored response", async () => {
    const carrier = new SimulatedCarrierClient();

    const first = await carrier.requestQuote(request("key-1"));
    const second = await carrier.requestQuote(request("key-1"));

    expect(second).toEqual(first);
    expect(carrier.executionCount).toBe(1);
    expect(carrier.requests.map((r) => r.replayed)).toEqual([false, true]);
  });

  it("treats different keys as different operations", async () => {
    const carrier = new SimulatedCarrierClient();

    const first = await carrier.requestQuote(request("key-1"));
    const second = await carrier.requestQuote(request("key-2"));

    expect(second.carrierQuoteId).not.toBe(first.carrierQuoteId);
    expect(carrier.executionCount).toBe(2);
  });

  it("rejects a reused key with a different request body", async () => {
    const carrier = new SimulatedCarrierClient();
    await carrier.requestQuote(request("key-1"));

    await expect(
      carrier.requestQuote(request("key-1", { model: "Corolla" })),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(carrier.executionCount).toBe(1);
  });

  it("can process a request and then lose the response", async () => {
    const carrier = new SimulatedCarrierClient();
    carrier.dropNextResponse();

    await expect(carrier.requestQuote(request("key-1"))).rejects.toThrow(
      "timeout",
    );
    const retry = await carrier.requestQuote(request("key-1"));

    expect(carrier.executionCount).toBe(1);
    expect(retry).toEqual(carrier.requests[0].response);
  });
});
