import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConnect,
  mockQuery,
  mockRelease,
  mockUpdateQuote,
  mockInsertOutbox,
  mockFindUnpublished,
  mockMarkPublished,
  mockScheduleRetry,
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
  mockScheduleRetry: vi.fn(),
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
  scheduleOutboxRetry: mockScheduleRetry,
}));

vi.mock("../../src/quotes/quote.sseOwnership.js", () => ({
  getSseOwner: mockGetSseOwner,
}));

vi.mock("../../src/messaging/rabbitmq.js", () => ({
  publishQuoteEvent: mockPublishQuoteEvent,
}));

import { completeQuoteWithOutbox } from "../../src/quotes/quote.completion.js";
import {
  nextOutboxAttemptAt,
  OUTBOX_MAX_ATTEMPTS,
  publishUnpublishedOutboxEvents,
} from "../../src/outbox/outbox.publisher.js";

const quoteId = "11111111-1111-4111-8111-111111111111";

function unpublishedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    event_type: "quote.completed",
    aggregate_id: quoteId,
    payload: { quoteId, event: "quote.completed" },
    created_at: new Date(),
    published_at: null,
    attempt_count: 0,
    next_attempt_at: new Date(),
    ...overrides,
  };
}

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
    mockScheduleRetry.mockResolvedValue(unpublishedEvent({ attempt_count: 1 }));
    mockMarkPublished.mockResolvedValue(
      unpublishedEvent({ published_at: new Date() }),
    );
  });

  it("marks published_at only after RabbitMQ accepts the message", async () => {
    mockFindUnpublished.mockResolvedValue([unpublishedEvent()]);
    mockGetSseOwner.mockResolvedValue("node-2");
    mockPublishQuoteEvent.mockResolvedValue(undefined);

    const result = await publishUnpublishedOutboxEvents();

    expect(mockPublishQuoteEvent).toHaveBeenCalledWith("node-2", {
      quoteId,
      event: "quote.completed",
    });
    expect(mockMarkPublished).toHaveBeenCalledWith("evt-1");
    expect(result.published).toBe(1);
  });

  it("schedules backoff when RabbitMQ publish fails", async () => {
    mockFindUnpublished.mockResolvedValue([unpublishedEvent()]);
    mockGetSseOwner.mockResolvedValue("node-2");
    mockPublishQuoteEvent.mockRejectedValue(new Error("broker down"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await publishUnpublishedOutboxEvents();
    errorSpy.mockRestore();

    expect(mockMarkPublished).not.toHaveBeenCalled();
    expect(mockScheduleRetry).toHaveBeenCalledWith(
      "evt-1",
      expect.any(Date),
    );
    expect(result.failed).toBe(1);
  });

  it("defers with backoff once when Redis has no SSE owner", async () => {
    mockFindUnpublished.mockResolvedValue([unpublishedEvent()]);
    mockGetSseOwner.mockResolvedValue(null);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await publishUnpublishedOutboxEvents();
    const logCount = logSpy.mock.calls.length;
    logSpy.mockRestore();

    expect(mockPublishQuoteEvent).not.toHaveBeenCalled();
    expect(mockMarkPublished).not.toHaveBeenCalled();
    expect(mockScheduleRetry).toHaveBeenCalledWith(
      "evt-1",
      expect.any(Date),
    );
    expect(result.deferredNoOwner).toBe(1);
    expect(logCount).toBe(1);
  });

  it("does not re-log no-owner deferrals after the first attempt", async () => {
    mockFindUnpublished.mockResolvedValue([
      unpublishedEvent({ attempt_count: 2 }),
    ]);
    mockGetSseOwner.mockResolvedValue(null);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await publishUnpublishedOutboxEvents();
    const logCount = logSpy.mock.calls.length;
    logSpy.mockRestore();

    expect(logCount).toBe(0);
    expect(mockScheduleRetry).toHaveBeenCalled();
  });

  it("abandons SSE delivery after max no-owner attempts", async () => {
    mockFindUnpublished.mockResolvedValue([
      unpublishedEvent({ attempt_count: OUTBOX_MAX_ATTEMPTS - 1 }),
    ]);
    mockGetSseOwner.mockResolvedValue(null);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await publishUnpublishedOutboxEvents();
    warnSpy.mockRestore();

    expect(mockScheduleRetry).not.toHaveBeenCalled();
    expect(mockMarkPublished).toHaveBeenCalledWith("evt-1");
    expect(result.abandoned).toBe(1);
  });

  it("allows duplicate publication by design when mark-published never runs", async () => {
    mockFindUnpublished.mockResolvedValue([unpublishedEvent()]);
    mockGetSseOwner.mockResolvedValue("node-2");
    mockPublishQuoteEvent.mockResolvedValue(undefined);
    mockMarkPublished.mockRejectedValueOnce(
      new Error("db crash after publish"),
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await publishUnpublishedOutboxEvents();
    errorSpy.mockRestore();

    expect(first.failed).toBe(1);
    expect(mockPublishQuoteEvent).toHaveBeenCalledTimes(1);
    expect(mockScheduleRetry).toHaveBeenCalled();

    mockFindUnpublished.mockResolvedValue([unpublishedEvent()]);
    mockMarkPublished.mockResolvedValue(
      unpublishedEvent({ published_at: new Date() }),
    );

    const second = await publishUnpublishedOutboxEvents();
    expect(mockPublishQuoteEvent).toHaveBeenCalledTimes(2);
    expect(second.published).toBe(1);
  });

  it("increases backoff delay with attempts", () => {
    const first = nextOutboxAttemptAt(1).getTime();
    const later = nextOutboxAttemptAt(4).getTime();
    expect(later - Date.now()).toBeGreaterThan(first - Date.now());
  });
});
