import "dotenv/config";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { NODE_INSTANCE_ID } from "./config/instance.js";
import {
  startQuoteEventsConsumer,
  stopQuoteEventsConsumer,
} from "./messaging/rabbitmq.js";
import { startOutboxPublisher } from "./outbox/outbox.publisher.js";
import { startQuoteWorker } from "./quotes/quote.worker.js";

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;
const QUOTE_WORKER_INTERVAL_MS = Number(
  process.env.QUOTE_WORKER_INTERVAL_MS ?? 2_000,
);
const OUTBOX_PUBLISHER_INTERVAL_MS = Number(
  process.env.OUTBOX_PUBLISHER_INTERVAL_MS ?? 1_000,
);

let server: Server | null = null;
let shuttingDown = false;
let quoteWorkerTimer: NodeJS.Timeout | null = null;
let outboxPublisherTimer: NodeJS.Timeout | null = null;

async function start(): Promise<void> {
  await startQuoteEventsConsumer();

  quoteWorkerTimer = startQuoteWorker(QUOTE_WORKER_INTERVAL_MS);
  outboxPublisherTimer = startOutboxPublisher(OUTBOX_PUBLISHER_INTERVAL_MS);

  server = app.listen(PORT, () => {
    console.log(
      `Server listening on http://localhost:${PORT} (instance ${NODE_INSTANCE_ID})`,
    );
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down…`);

  if (quoteWorkerTimer) {
    clearInterval(quoteWorkerTimer);
    quoteWorkerTimer = null;
  }

  if (outboxPublisherTimer) {
    clearInterval(outboxPublisherTimer);
    outboxPublisherTimer = null;
  }

  try {
    await stopQuoteEventsConsumer();
  } catch (error) {
    console.error("Error while stopping RabbitMQ consumer:", error);
  }

  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });

  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

start().catch((error) => {
  console.error("Failed to start application:", error);
  process.exit(1);
});
