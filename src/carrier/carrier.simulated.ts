import { randomUUID } from "node:crypto";
import type {
  CarrierClient,
  CarrierQuotePayload,
  CarrierQuoteRequest,
  CarrierQuoteResponse,
} from "./carrier.types.js";
import { CarrierError } from "./carrier.types.js";

export type RecordedCarrierRequest = {
  request: CarrierQuoteRequest;
  response: CarrierQuoteResponse;
  /** True when the carrier returned a stored response instead of doing the work. */
  replayed: boolean;
};

function simulatedPremiumCents(payload: CarrierQuotePayload): number {
  const vehicleAge = Math.max(0, new Date().getUTCFullYear() - payload.vehicle.year);
  return 120_000 - Math.min(vehicleAge, 20) * 2_500;
}

/**
 * In-memory stand-in for an idempotent carrier API. Idempotency state is
 * per process, so it only dedupes retries within one Node instance.
 */
export class SimulatedCarrierClient implements CarrierClient {
  readonly requests: RecordedCarrierRequest[] = [];
  private readonly responsesByKey = new Map<
    string,
    { fingerprint: string; response: CarrierQuoteResponse }
  >();
  private executions = 0;
  private responsesToDrop = 0;

  /** Number of times the carrier actually performed the work. */
  get executionCount(): number {
    return this.executions;
  }

  /** The next request is processed by the carrier, but its response never reaches the caller. */
  dropNextResponse(): void {
    this.responsesToDrop += 1;
  }

  async requestQuote(
    request: CarrierQuoteRequest,
  ): Promise<CarrierQuoteResponse> {
    const fingerprint = JSON.stringify(request.payload);
    const stored = this.responsesByKey.get(request.idempotencyKey);
    let response: CarrierQuoteResponse;
    let replayed: boolean;

    if (stored) {
      if (stored.fingerprint !== fingerprint) {
        throw new CarrierError(
          `Idempotency key ${request.idempotencyKey} was reused with a different request body`,
          422,
        );
      }
      response = stored.response;
      replayed = true;
    } else {
      response = {
        carrierQuoteId: randomUUID(),
        premiumCents: simulatedPremiumCents(request.payload),
      };
      this.responsesByKey.set(request.idempotencyKey, { fingerprint, response });
      this.executions += 1;
      replayed = false;
    }

    this.requests.push({ request, response, replayed });

    if (this.responsesToDrop > 0) {
      this.responsesToDrop -= 1;
      throw new CarrierError(
        "Simulated carrier timeout after the request was processed",
      );
    }

    return response;
  }
}
