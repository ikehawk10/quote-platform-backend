import { Router } from "express";
import * as quoteController from "./quote.controller.js";

export const quotesRouter = Router();

quotesRouter.post("/", quoteController.createQuote);
quotesRouter.get("/:id/events", quoteController.streamQuoteEvents);
quotesRouter.get("/:id", quoteController.getQuoteById);
