export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_CONFIGURED"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  NOT_CONFIGURED: 409,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export interface ErrorDetail {
  path?: string;
  row?: number;
  message: string;
}

/** Application error with a safe, user-presentable message. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetail[];

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const forbidden = (message = "You do not have permission to perform this action.") =>
  new AppError("FORBIDDEN", message);
export const validation = (message: string, details?: ErrorDetail[]) =>
  new AppError("VALIDATION_ERROR", message, details);
