import { createHttpCarrierClient } from "./carrier.http.js";
import { SimulatedCarrierClient } from "./carrier.simulated.js";
import type { CarrierClient } from "./carrier.types.js";

let client: CarrierClient | undefined;

/** HTTP carrier when CARRIER_API_URL is set; otherwise the in-memory simulator. */
export function getCarrierClient(): CarrierClient {
  if (client) {
    return client;
  }

  const baseUrl = process.env.CARRIER_API_URL?.trim();
  if (baseUrl) {
    client = createHttpCarrierClient({
      baseUrl,
      apiKey: process.env.CARRIER_API_KEY?.trim() || undefined,
    });
  } else {
    console.warn(
      "CARRIER_API_URL is not set; using the in-memory simulated carrier",
    );
    client = new SimulatedCarrierClient();
  }

  return client;
}
