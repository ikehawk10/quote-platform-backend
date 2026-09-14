import "dotenv/config";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { NODE_INSTANCE_ID } from "./config/instance.js";
import {
  startQuoteEventsConsumer,
  stopQuoteEventsConsumer,
} from "./messaging/rabbitmq.js";

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;

let server: Server | null = null;
let shuttingDown = false;

async function start(): Promise<void> {
  await startQuoteEventsConsumer();

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
