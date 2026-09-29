import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpCarrierClient } from "../../src/carrier/carrier.http.js";
import type { CarrierQuoteRequest } from "../../src/carrier/carrier.types.js";

const request: CarrierQuoteRequest = {
  idempotencyKey: "quote:q-1:rate",
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
    vehicle: { year: 2020, make: "Toyota", model: "Camry", vin: null },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createHttpCarrierClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the idempotency key as a header alongside the payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ carrierQuoteId: "cq-1", premiumCents: 99_000 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpCarrierClient({
      baseUrl: "https://carrier.test/v1",
      apiKey: "secret",
    });
    const response = await client.requestQuote(request);

    expect(response).toEqual({ carrierQuoteId: "cq-1", premiumCents: 99_000 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://carrier.test/v1/quotes");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "idempotency-key": "quote:q-1:rate",
      authorization: "Bearer secret",
    });
    expect(JSON.parse(init.body)).toEqual(request.payload);
  });

  it("throws a CarrierError with the status on non-2xx responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));

    const client = createHttpCarrierClient({ baseUrl: "https://carrier.test" });

    await expect(client.requestQuote(request)).rejects.toMatchObject({
      name: "CarrierError",
      statusCode: 503,
    });
  });

  it("rejects malformed response bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ premiumCents: "lots" })),
    );

    const client = createHttpCarrierClient({ baseUrl: "https://carrier.test" });

    await expect(client.requestQuote(request)).rejects.toThrow(
      "unexpected response body",
    );
  });
});
