import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { AppError } from "../../src/errors/AppError.js";
import * as quoteService from "../../src/quotes/quote.service.js";
import { quoteSseHub } from "../../src/quotes/quote.sse.js";
import type { Quote } from "../../src/quotes/quote.types.js";

vi.mock("../../src/quotes/quote.service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/quotes/quote.service.js")
  >("../../src/quotes/quote.service.js");

  return {
    ...actual,
    assertQuoteExists: vi.fn(),
    getQuoteById: vi.fn(),
    createQuote: vi.fn(),
  };
});

const app = createApp();

const quoteId = "11111111-1111-4111-8111-111111111111";

function buildQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: quoteId,
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

describe("GET /quotes/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for an invalid quote id", async () => {
    const response = await request(app).get("/quotes/not-a-uuid/events");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "id must be a valid UUID",
      },
    });
    expect(quoteService.assertQuoteExists).not.toHaveBeenCalled();
  });

  it("returns 404 without opening SSE when the quote is missing", async () => {
    vi.mocked(quoteService.assertQuoteExists).mockRejectedValue(
      AppError.notFound("QUOTE_NOT_FOUND", "Quote not found"),
    );

    const response = await request(app).get(`/quotes/${quoteId}/events`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "QUOTE_NOT_FOUND",
        message: "Quote not found",
      },
    });
    expect(response.headers["content-type"]).not.toContain("text/event-stream");
    expect(quoteSseHub.getClientCount(quoteId)).toBe(0);
  });

  it("opens an SSE stream and sends a connected event when the quote exists", async () => {
    vi.mocked(quoteService.assertQuoteExists).mockResolvedValue(buildQuote());

    const response = await request(app)
      .get(`/quotes/${quoteId}/events`)
      .buffer(true)
      .parse((res, callback) => {
        let data = "";
        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          res.destroy();
          callback(null, data);
        };

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
          if (data.includes("\n\n")) {
            finish();
          }
        });
        res.on("error", () => {
          finish();
        });
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(String(response.headers.connection).toLowerCase()).toBe("keep-alive");
    expect(response.body).toContain("event: connected");
    expect(response.body).toContain(`"quoteId":"${quoteId}"`);
    expect(quoteService.assertQuoteExists).toHaveBeenCalledWith(quoteId);

    // Give the close handlers a tick to run after destroy().
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(quoteSseHub.getClientCount(quoteId)).toBe(0);
  });
});
