import type { ErrorRequestHandler } from "express";
import { DatabaseError } from "pg";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof DatabaseError) {
    if (err.code === "23514") {
      res.status(400).json({
        error: "Validation failed",
        details: [{ message: err.detail ?? "Database constraint violated" }],
      });
      return;
    }

    console.error("Database error:", err);
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND")
  ) {
    console.error("Database connection error:", err);
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
};
