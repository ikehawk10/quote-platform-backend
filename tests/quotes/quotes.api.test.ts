import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { AppError } from "../../src/errors/AppError.js";
import * as quoteService from "../../src/quotes/quote.service.js";
import type { Quote } from "../../src/quotes/quote.types.js";

vi.mock("../../src/quotes/quote.service.js", () => ({
  createQuote: vi.fn(),
  getQuoteById: vi.fn(),
}));

const app = createApp();

const validBody = {
  make: "Toyota",
  model: "Camry",
  year: 2022,
  date_of_birth: "1990-01-01",
  state: "TX",
};

function buildQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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

describe("POST /quotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 202 with id and PENDING status for a valid supported request", async () => {
    vi.mocked(quoteService.createQuote).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      status: "PENDING",
    });

    const response = await request(app).post("/quotes").send(validBody);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      status: "PENDING",
    });
    expect(quoteService.createQuote).toHaveBeenCalledWith({
      make: "Toyota",
      model: "Camry",
      year: 2022,
      date_of_birth: "1990-01-01",
      state: "TX",
    });
  });

  it("returns 400 VALIDATION_ERROR when required fields are invalid", async () => {
    const response = await request(app).post("/quotes").send({
      ...validBody,
      make: "",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "make is required",
      },
    });
    expect(quoteService.createQuote).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_ERROR for under-18 applicants", async () => {
    const response = await request(app).post("/quotes").send({
      ...validBody,
      date_of_birth: "2010-01-01",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Applicant must be at least 18 years old",
      },
    });
    expect(quoteService.createQuote).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_ERROR for an invalid state code", async () => {
    const response = await request(app).post("/quotes").send({
      ...validBody,
      state: "ZZ",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(quoteService.createQuote).not.toHaveBeenCalled();
  });

  it("returns 400 QUOTE_REJECTED with persisted quote details", async () => {
    vi.mocked(quoteService.createQuote).mockRejectedValue(
      AppError.badRequest(
        "QUOTE_REJECTED",
        "State 'AK' is not currently supported",
        {
          id: "22222222-2222-4222-8222-222222222222",
          status: "REJECTED",
          rejection_reason: "State 'AK' is not currently supported",
        },
      ),
    );

    const response = await request(app)
      .post("/quotes")
      .send({ ...validBody, state: "AK" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "QUOTE_REJECTED",
        message: "State 'AK' is not currently supported",
      },
      id: "22222222-2222-4222-8222-222222222222",
      status: "REJECTED",
      rejection_reason: "State 'AK' is not currently supported",
    });
  });
});

describe("GET /quotes/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with the quote when found", async () => {
    const quote = buildQuote();
    vi.mocked(quoteService.getQuoteById).mockResolvedValue(quote);

    const response = await request(app).get(`/quotes/${quote.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: quote.id,
      make: "Toyota",
      model: "Camry",
      year: 2022,
      date_of_birth: "1990-01-01",
      state: "TX",
      status: "PENDING",
      rejection_reason: null,
    });
  });

  it("returns 400 VALIDATION_ERROR for an invalid UUID", async () => {
    const response = await request(app).get("/quotes/not-a-uuid");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "id must be a valid UUID",
      },
    });
    expect(quoteService.getQuoteById).not.toHaveBeenCalled();
  });

  it("returns 404 QUOTE_NOT_FOUND when missing", async () => {
    vi.mocked(quoteService.getQuoteById).mockRejectedValue(
      AppError.notFound("QUOTE_NOT_FOUND", "Quote not found"),
    );

    const response = await request(app).get(
      "/quotes/00000000-0000-4000-8000-000000000000",
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "QUOTE_NOT_FOUND",
        message: "Quote not found",
      },
    });
  });
});
