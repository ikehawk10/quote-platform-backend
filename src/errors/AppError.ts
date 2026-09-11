export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: ErrorDetails;
  readonly isOperational = true;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: ErrorDetails,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static validation(message: string, details?: ErrorDetails): AppError {
    return new AppError(400, "VALIDATION_ERROR", message, details);
  }

  static badRequest(
    code: string,
    message: string,
    details?: ErrorDetails,
  ): AppError {
    return new AppError(400, code, message, details);
  }

  static notFound(code: string, message: string): AppError {
    return new AppError(404, code, message);
  }

  static serviceUnavailable(message = "Service temporarily unavailable"): AppError {
    return new AppError(503, "SERVICE_UNAVAILABLE", message);
  }
}
