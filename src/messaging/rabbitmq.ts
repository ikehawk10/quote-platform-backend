import amqp, {
  type Channel,
  type ChannelModel,
  type ConsumeMessage,
} from "amqplib";
import { NODE_INSTANCE_ID } from "../config/instance.js";
import { quoteSseHub } from "../quotes/quote.sse.js";
import {
  parseQuoteEventMessage,
  QUOTE_EVENTS_EXCHANGE,
  quoteEventsQueueName,
  type QuoteEventMessage,
} from "./quoteEvents.js";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let consumerTag: string | null = null;
let connecting: Promise<Channel> | null = null;

function getRabbitUrl(): string {
  const url = process.env.RABBITMQ_URL?.trim();
  if (!url) {
    throw new Error("RABBITMQ_URL is not set");
  }
  return url;
}

async function getChannel(): Promise<Channel> {
  if (channel) {
    return channel;
  }

  connecting ??= (async () => {
    try {
      connection = await amqp.connect(getRabbitUrl());
      connection.on("error", (error) => {
        console.error("RabbitMQ connection error:", error);
      });
      connection.on("close", () => {
        connection = null;
        channel = null;
        consumerTag = null;
        connecting = null;
      });

      const nextChannel = await connection.createChannel();
      nextChannel.on("error", (error) => {
        console.error("RabbitMQ channel error:", error);
      });
      nextChannel.on("close", () => {
        channel = null;
        consumerTag = null;
      });

      channel = nextChannel;
      return nextChannel;
    } catch (error) {
      connecting = null;
      connection = null;
      channel = null;
      throw error;
    }
  })();

  return connecting;
}

async function assertTopology(ch: Channel): Promise<string> {
  await ch.assertExchange(QUOTE_EVENTS_EXCHANGE, "direct", { durable: true });

  const queueName = quoteEventsQueueName();
  await ch.assertQueue(queueName, { durable: true });
  await ch.bindQueue(queueName, QUOTE_EVENTS_EXCHANGE, NODE_INSTANCE_ID);

  return queueName;
}

export async function handleQuoteEventMessage(
  message: QuoteEventMessage,
): Promise<number> {
  return quoteSseHub.broadcast(message.quoteId, message.event, {
    quoteId: message.quoteId,
    event: message.event,
  });
}

async function onMessage(ch: Channel, msg: ConsumeMessage | null): Promise<void> {
  if (!msg) {
    return;
  }

  try {
    const parsed = parseQuoteEventMessage(msg.content);
    await handleQuoteEventMessage(parsed);
    ch.ack(msg);
  } catch (error) {
    console.error("Failed to process quote event message:", error);
    // Invalid/unprocessable: do not requeue (no DLQ in this phase).
    ch.nack(msg, false, false);
  }
}

/**
 * Connects to RabbitMQ, asserts the durable direct exchange + per-instance
 * queue/binding, and starts consuming messages for this Node.
 */
export async function startQuoteEventsConsumer(): Promise<void> {
  const ch = await getChannel();
  const queueName = await assertTopology(ch);

  await ch.prefetch(10);

  const consumer = await ch.consume(queueName, (msg) => {
    void onMessage(ch, msg);
  });

  consumerTag = consumer.consumerTag;
  console.log(
    `RabbitMQ quote-events consumer started on queue ${queueName} (instance ${NODE_INSTANCE_ID})`,
  );
}

/**
 * Publish a quote event to a specific Node instance routing key.
 * Intended for future outbox publishing and local/integration testing.
 */
export async function publishQuoteEvent(
  routingKey: string,
  message: QuoteEventMessage,
): Promise<void> {
  const ch = await getChannel();
  await assertTopology(ch);

  const payload = Buffer.from(JSON.stringify(message));
  const published = ch.publish(QUOTE_EVENTS_EXCHANGE, routingKey, payload, {
    contentType: "application/json",
    persistent: true,
  });

  if (!published) {
    throw new Error("RabbitMQ publish buffer is full");
  }
}

export async function stopQuoteEventsConsumer(): Promise<void> {
  try {
    if (channel && consumerTag) {
      await channel.cancel(consumerTag);
      consumerTag = null;
    }

    if (channel) {
      await channel.close();
      channel = null;
    }

    if (connection) {
      await connection.close();
      connection = null;
    }
  } finally {
    connecting = null;
  }
}
