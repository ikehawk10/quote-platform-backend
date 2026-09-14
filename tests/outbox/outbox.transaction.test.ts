import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConnect,
  mockQuery,
  mockRelease,
  mockUpdateQuote,
  mockInsertOutbox,
  mockFindUnpublished,
  mockMarkPublished,
  mockGetSseOwner,
  mockPublishQuoteEvent,
} = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockQuery: vi.fn(),
  mockRelease: vi.fn(),
  mockUpdateQuote: vi.fn(),
  mockInsertOutbox: vi.fn(),
  mockFindUnpublished: vi.fn(),
  mockMarkPublished: vi.fn(),
  mockGetSseOwner: vi.fn(),
  mockPublishQuoteEvent: vi.fn(),
}));

vi.mock("../../src/db.js", () => ({
  pool: {
    connect: mockConnect,
  },
}));

vi.mock("../../src/quotes/quote.repository.js", () => ({
  markQuoteCompleted: mockUpdateQuote,
}));

vi.mock("../../src/outbox/outbox.repository.js", () => ({
  insertOutboxEvent: mockInsertOutbox,
  findUnpublishedOutboxEvents: mockFindUnpublished,
  markOutboxEventPublished: mockMarkPublished,
}));

vi.mock("../../src/quotes/quote.sseOwnership.js", () => ({
  getSseOwner: mockGetSseOwner,
}));

vi.mock("../../src/messaging/rabbitmq.js", () => ({
  publishQuoteEvent: mockPublishQuoteEvent,
}));

import { completeQuoteWithOutbox } from "../../src/quotes/quote.completion.js";
import { publishUnpublishedOutboxEvents } from "../../src/outbox/outbox.publisher.js";

const quoteId = "11111111-1111-4111-8111-111111111111";

describe("completeQuoteWithOutbox transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it("commits quote completion and outbox insert together", async () => {
    mockUpdateQuote.mockResolvedValue({
      id: quoteId,
      status: "COMPLETED",
    });
    mockInsertOutbox.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
    });

    const result = await completeQuoteWithOutbox(quoteId);

    expect(result).toEqual({
      quote: { id: quoteId, status: "COMPLETED" },
      outboxEventId: "22222222-2222-4222-8222-222222222222",
    });
    expect(mockQuery).toHaveBeenCalledWith("BEGIN");
    expect(mockUpdateQuote).toHaveBeenCalled();
    expect(mockInsertOutbox).toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledWith("COMMIT");
    expect(mockRelease).toHaveBeenCalled();
  });

  it("rolls back quote completion when outbox insert fails", async () => {
    mockUpdateQuote.mockResolvedValue({
      id: quoteId,
      status: "COMPLETED",
    });
    mockInsertOutbox.mockRejectedValue(new Error("outbox insert failed"));

    await expect(completeQuoteWithOutbox(quoteId)).rejects.toThrow(
      "outbox insert failed",
    );

    expect(mockQuery).toHaveBeenCalledWith("BEGIN");
    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockQuery).not.toHaveBeenCalledWith("COMMIT");
    expect(mockRelease).toHaveBeenCalled();
  });
});

describe("publishUnpublishedOutboxEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks published_at only after RabbitMQ accepts the message", async () => {
    mockFindUnpublished.mockResolvedValue([
      {
        id: "evt-1",
        event_type: "quote.completed",
        aggregate_id: quoteId,
        payload: { quoteId, event: "quote.completed" },
        created_at: new Date(),
        published_at: null,
      },
    ]);
    mockGetSseOwner.mockResolvedValue("node-2");
    mockPublishQuoteEvent.mockResolvedValue(undefined);
    mockMarkPublished.mockResolvedValue({ id: "evt-1", published_at: new Date() });

    const result = await publishUnpublishedOutboxEvents();

    expect(mockPublishQuoteEvent).toHaveBeenCalledWith("node-2", {
      quoteId,
      event: "quote.completed",
    });
    expect(mockMarkPublished).toHaveBeenCalledWith("evt-1");
    expect(result.published).toBe(1);
  });

  it("leaves the event unpublished when RabbitMQ publish fails", async () => {
    mockFindUnpublished.mockResolvedValue([
      {
        id: "evt-2",
        event_type: "quote.completed",
        aggregate_id: quoteId,
        payload: { quoteId, event: "quote.completed" },
        created_at: new Date(),
        published_at: null,
      },
    ]);
    mockGetSseOwner.mockResolvedValue("node-2");
    mockPublishQuoteEvent.mockRejectedValue(new Error("broker down"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await publishUnpublishedOutboxEvents();
    errorSpy.mockRestore();

    expect(mockMarkPublished).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  it("leaves the event unpublished when Redis has no SSE owner", async () => {
    mockFindUnpublished.mockResolvedValue([
      {
        id: "evt-3",
        event_type: "quote.completed",
        aggregate_id: quoteId,
        payload: { quoteId, event: "quote.completed" },
        created_at: new Date(),
        published_at: null,
      },
    ]);
    mockGetSseOwner.mockResolvedValue(null);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await publishUnpublishedOutboxEvents();
    logSpy.mockRestore();

    expect(mockPublishQuoteEvent).not.toHaveBeenCalled();
    expect(mockMarkPublished).not.toHaveBeenCalled();
    expect(result.deferredNoOwner).toBe(1);
  });

  it("allows duplicate publication by design when mark-published never runs", async () => {
    mockFindUnpublished.mockResolvedValue([
      {
        id: "evt-4",
        event_type: "quote.completed",
        aggregate_id: quoteId,
        payload: { quoteId, event: "quote.completed" },
        created_at: new Date(),
        published_at: null,
      },
    ]);
    mockGetSseOwner.mockResolvedValue("node-2");
    mockPublishQuoteEvent.mockResolvedValue(undefined);
    mockMarkPublished.mockRejectedValue(new Error("db crash after publish"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await publishUnpublishedOutboxEvents();
    errorSpy.mockRestore();

    expect(first.failed).toBe(1);
    expect(mockPublishQuoteEvent).toHaveBeenCalledTimes(1);

    // Event remains unpublished, so a later tick can publish again (at-least-once).
    mockFindUnpublished.mockResolvedValue([
      {
        id: "evt-4",
        event_type: "quote.completed",
        aggregate_id: quoteId,
        payload: { quoteId, event: "quote.completed" },
        created_at: new Date(),
        published_at: null,
      },
    ]);
    mockMarkPublished.mockResolvedValue({ id: "evt-4", published_at: new Date() });

    const second = await publishUnpublishedOutboxEvents();
    expect(mockPublishQuoteEvent).toHaveBeenCalledTimes(2);
    expect(second.published).toBe(1);
  });
});
