import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConnect,
  mockCreateChannel,
  mockAssertExchange,
  mockAssertQueue,
  mockBindQueue,
  mockConsume,
  mockAck,
  mockNack,
  mockPrefetch,
  mockPublish,
} = vi.hoisted(() => {
  const mockAck = vi.fn();
  const mockNack = vi.fn();
  const mockAssertExchange = vi.fn();
  const mockAssertQueue = vi.fn();
  const mockBindQueue = vi.fn();
  const mockConsume = vi.fn();
  const mockPrefetch = vi.fn();
  const mockPublish = vi.fn().mockReturnValue(true);
  const mockCreateChannel = vi.fn();
  const mockConnect = vi.fn();

  return {
    mockConnect,
    mockCreateChannel,
    mockAssertExchange,
    mockAssertQueue,
    mockBindQueue,
    mockConsume,
    mockAck,
    mockNack,
    mockPrefetch,
    mockPublish,
  };
});

vi.mock("amqplib", () => ({
  default: {
    connect: mockConnect,
  },
}));

vi.mock("../../src/config/instance.js", () => ({
  NODE_INSTANCE_ID: "node-2",
}));

import { quoteSseHub } from "../../src/quotes/quote.sse.js";

describe("RabbitMQ quote-events consumer routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quoteSseHub.clear();
    process.env.RABBITMQ_URL = "amqp://quote:quote@localhost:5672";

    const channel = {
      assertExchange: mockAssertExchange,
      assertQueue: mockAssertQueue,
      bindQueue: mockBindQueue,
      prefetch: mockPrefetch,
      consume: mockConsume,
      ack: mockAck,
      nack: mockNack,
      publish: mockPublish,
      on: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
    };

    mockCreateChannel.mockResolvedValue(channel);
    mockConnect.mockResolvedValue({
      createChannel: mockCreateChannel,
      on: vi.fn(),
      close: vi.fn(),
    });
    mockAssertExchange.mockResolvedValue(undefined);
    mockAssertQueue.mockResolvedValue({ queue: "quote-events.node-2" });
    mockBindQueue.mockResolvedValue(undefined);
    mockPrefetch.mockResolvedValue(undefined);
    mockConsume.mockResolvedValue({ consumerTag: "ctag-1" });
  });

  it("binds this instance queue with NODE_INSTANCE_ID as the routing key", async () => {
    // Import after mocks so the module picks them up fresh per process.
    const { startQuoteEventsConsumer, stopQuoteEventsConsumer } = await import(
      "../../src/messaging/rabbitmq.js"
    );

    await startQuoteEventsConsumer();

    expect(mockAssertExchange).toHaveBeenCalledWith("quote-events", "direct", {
      durable: true,
    });
    expect(mockAssertQueue).toHaveBeenCalledWith("quote-events.node-2", {
      durable: true,
    });
    expect(mockBindQueue).toHaveBeenCalledWith(
      "quote-events.node-2",
      "quote-events",
      "node-2",
    );
    expect(mockConsume).toHaveBeenCalledWith(
      "quote-events.node-2",
      expect.any(Function),
    );

    await stopQuoteEventsConsumer();
  });

  it("acks after broadcasting a valid message to local SSE clients", async () => {
    const { startQuoteEventsConsumer, stopQuoteEventsConsumer } = await import(
      "../../src/messaging/rabbitmq.js"
    );

    await startQuoteEventsConsumer();

    const consumeHandler = mockConsume.mock.calls[0]?.[1] as (
      msg: {
        content: Buffer;
      } | null,
    ) => void;

    const writes: string[] = [];
    quoteSseHub.add("11111111-1111-4111-8111-111111111111", {
      write: (chunk: string) => {
        writes.push(chunk);
        return true;
      },
    } as never);

    const msg = {
      content: Buffer.from(
        JSON.stringify({
          quoteId: "11111111-1111-4111-8111-111111111111",
          event: "quote.completed",
        }),
      ),
    };

    await Promise.resolve(consumeHandler(msg));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writes.join("")).toContain("event: quote.completed");
    expect(mockAck).toHaveBeenCalledWith(msg);
    expect(mockNack).not.toHaveBeenCalled();

    await stopQuoteEventsConsumer();
  });

  it("nacks invalid messages without requeue", async () => {
    const { startQuoteEventsConsumer, stopQuoteEventsConsumer } = await import(
      "../../src/messaging/rabbitmq.js"
    );

    await startQuoteEventsConsumer();

    const consumeHandler = mockConsume.mock.calls[0]?.[1] as (
      msg: {
        content: Buffer;
      } | null,
    ) => void;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = { content: Buffer.from("nope") };

    await Promise.resolve(consumeHandler(msg));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockNack).toHaveBeenCalledWith(msg, false, false);
    expect(mockAck).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    await stopQuoteEventsConsumer();
  });
});
