import type { ErrorRequestHandler } from "express";
import { DatabaseError } from "pg";
import { AppError } from "../errors/AppError.js";

type ErrorBody = {
  error: {
    code: string;
    message: string;
  };
  [key: string]: unknown;
};

function sendError(
  res: Parameters<ErrorRequestHandler>[2],
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  const body: ErrorBody = {
    error: { code, message },
    ...details,
  };
  res.status(statusCode).json(body);
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  if (err instanceof DatabaseError) {
    if (err.code === "23514") {
      sendError(res, 400, "VALIDATION_ERROR", "Request data failed a database constraint");
      return;
    }

    console.error("Unexpected database error:", err);
    sendError(res, 503, "SERVICE_UNAVAILABLE", "Database unavailable");
    return;
  }

  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND")
  ) {
    console.error("Database connection error:", err);
    sendError(res, 503, "SERVICE_UNAVAILABLE", "Database unavailable");
    return;
  }

  console.error("Unexpected internal error:", err);
  sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
};
