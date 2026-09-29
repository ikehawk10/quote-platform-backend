export type CarrierQuotePayload = {
  quoteId: string;
  applicant: {
    firstName: string;
    lastName: string;
    email: string;
    dateOfBirth: string;
    address: string;
    state: string;
  };
  vehicle: {
    year: number;
    make: string;
    model: string;
    vin: string | null;
  };
};

export type CarrierQuoteRequest = {
  /** Same key => the carrier performs the work at most once and replays its response. */
  idempotencyKey: string;
  payload: CarrierQuotePayload;
};

export type CarrierQuoteResponse = {
  carrierQuoteId: string;
  premiumCents: number;
};

export interface CarrierClient {
  requestQuote(request: CarrierQuoteRequest): Promise<CarrierQuoteResponse>;
}

export class CarrierError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "CarrierError";
  }
}
