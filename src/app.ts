import express from "express";
import cors from "cors";
import { errorHandler } from "./middleware/errorHandler.js";
import { quotesRouter } from "./quotes/quote.routes.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "quote-platform-backend",
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/quotes", quotesRouter);
  app.use(errorHandler);

  return app;
}
