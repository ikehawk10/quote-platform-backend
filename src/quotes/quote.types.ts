export type QuoteStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "REJECTED";

export type Quote = {
  id: string;
  make: string;
  model: string;
  year: number;
  date_of_birth: string;
  vin: string | null;
  state: string;
  status: QuoteStatus;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

export type CreateQuoteInput = {
  make: string;
  model: string;
  year: number;
  date_of_birth: string;
  vin?: string;
  state: string;
};
