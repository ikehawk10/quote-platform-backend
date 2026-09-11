export type QuoteStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "REJECTED";

export type Quote = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  address: string;
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
  first_name: string;
  last_name: string;
  email: string;
  address: string;
  make: string;
  model: string;
  year: number;
  date_of_birth: string;
  vin?: string;
  state: string;
};
