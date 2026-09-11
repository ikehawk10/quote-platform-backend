import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/errors/AppError.js";
import * as quoteRepository from "../../src/quotes/quote.repository.js";
import {
  createQuote,
  getQuoteById,
} from "../../src/quotes/quote.service.js";
import type { Quote } from "../../src/quotes/quote.types.js";

vi.mock("../../src/quotes/quote.repository.js", () => ({
  insertQuote: vi.fn(),
  findQuoteById: vi.fn(),
}));

const baseInput = {
  first_name: "Jane",
  last_name: "Doe",
  email: "jane.doe@example.com",
  address: "123 Main St",
  make: "Toyota",
  model: "Camry",
  year: 2022,
  date_of_birth: "1990-01-01",
  state: "TX",
};

function buildQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    first_name: "Jane",
    last_name: "Doe",
    email: "jane.doe@example.com",
    address: "123 Main St",
    make: "Toyota",
    model: "Camry",
    year: 2022,
    date_of_birth: "1990-01-01",
    vin: null,
    state: "TX",
    status: "PENDING",
    rejection_reason: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("quote.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createQuote", () => {
    it("persists a PENDING quote for a supported state", async () => {
      vi.mocked(quoteRepository.insertQuote).mockResolvedValue({
        id: "11111111-1111-4111-8111-111111111111",
        status: "PENDING",
        rejection_reason: null,
      });

      const result = await createQuote(baseInput);

      expect(result).toEqual({
        id: "11111111-1111-4111-8111-111111111111",
        status: "PENDING",
      });
      expect(quoteRepository.insertQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: "Jane",
          last_name: "Doe",
          email: "jane.doe@example.com",
          address: "123 Main St",
          make: "Toyota",
          model: "Camry",
          year: 2022,
          date_of_birth: "1990-01-01",
          vin: null,
          state: "TX",
          status: "PENDING",
          rejection_reason: null,
        }),
      );
    });

    it("persists optional vin when provided", async () => {
      vi.mocked(quoteRepository.insertQuote).mockResolvedValue({
        id: "11111111-1111-4111-8111-111111111111",
        status: "PENDING",
        rejection_reason: null,
      });

      await createQuote({ ...baseInput, vin: "1HGBH41JXMN109186" });

      expect(quoteRepository.insertQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          vin: "1HGBH41JXMN109186",
          status: "PENDING",
        }),
      );
    });

    it("persists REJECTED and throws QUOTE_REJECTED for unsupported states", async () => {
      vi.mocked(quoteRepository.insertQuote).mockResolvedValue({
        id: "22222222-2222-4222-8222-222222222222",
        status: "REJECTED",
        rejection_reason: "State 'AK' is not currently supported",
      });

      const error = await createQuote({ ...baseInput, state: "AK" }).catch(
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        statusCode: 400,
        code: "QUOTE_REJECTED",
        message: "State 'AK' is not currently supported",
        details: {
          id: "22222222-2222-4222-8222-222222222222",
          status: "REJECTED",
          rejection_reason: "State 'AK' is not currently supported",
        },
      });
      expect(quoteRepository.insertQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          state: "AK",
          status: "REJECTED",
          rejection_reason: "State 'AK' is not currently supported",
        }),
      );
    });
  });

  describe("getQuoteById", () => {
    it("returns the quote when found", async () => {
      const quote = buildQuote();
      vi.mocked(quoteRepository.findQuoteById).mockResolvedValue(quote);

      await expect(getQuoteById(quote.id)).resolves.toEqual(quote);
    });

    it("throws QUOTE_NOT_FOUND when missing", async () => {
      vi.mocked(quoteRepository.findQuoteById).mockResolvedValue(null);

      const error = await getQuoteById(
        "00000000-0000-4000-8000-000000000000",
      ).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        statusCode: 404,
        code: "QUOTE_NOT_FOUND",
        message: "Quote not found",
      });
    });
  });
});
