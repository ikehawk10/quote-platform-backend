import { z } from "zod";
import type {
  CarrierClient,
  CarrierQuoteRequest,
  CarrierQuoteResponse,
} from "./carrier.types.js";
import { CarrierError } from "./carrier.types.js";

const carrierQuoteResponseSchema = z.object({
  carrierQuoteId: z.string().min(1),
  premiumCents: z.number().int().nonnegative(),
});

export type HttpCarrierClientOptions = {
  baseUrl: string;
  apiKey?: string;
  /** Must stay well under the worker lease so a hung call can't outlive it. */
  timeoutMs?: number;
};

export function createHttpCarrierClient({
  baseUrl,
  apiKey,
  timeoutMs = 10_000,
}: HttpCarrierClientOptions): CarrierClient {
  const quotesUrl = new URL("quotes", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  return {
    async requestQuote(
      request: CarrierQuoteRequest,
    ): Promise<CarrierQuoteResponse> {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "idempotency-key": request.idempotencyKey,
      };
      if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(quotesUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(request.payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new CarrierError(
          `Carrier responded with HTTP ${response.status}`,
          response.status,
        );
      }

      const parsed = carrierQuoteResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new CarrierError("Carrier returned an unexpected response body");
      }

      return parsed.data;
    },
  };
}
