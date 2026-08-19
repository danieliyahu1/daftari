import { isValidMembershipCode } from "./kaspa-address";
import { ChainError, UpstreamError } from "./kaspa-client";
import type { UpstreamKind } from "./kaspa-client";
import { TxBuilderError } from "./tx-builder";
import { logger } from "./logger";

export interface RouteResult {
  status: number;
  body: unknown;
}

export type ErrorKind =
  | "invalid"
  | "conflict"
  | "policy"
  | "network"
  | "upstream"
  | "unauthorized";

const DEFAULT_STATUS: Record<ErrorKind, number> = {
  invalid: 422,
  conflict: 409,
  policy: 422,
  network: 503,
  upstream: 502,
  unauthorized: 401,
};

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly status: number;
  readonly source?: UpstreamKind;

  constructor(kind: ErrorKind, message: string, status?: number, source?: UpstreamKind) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
    this.status = status ?? DEFAULT_STATUS[kind];
    if (source !== undefined) this.source = source;
  }
}

export function requiredStr(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError("invalid", `${field} is required`, 400);
  }
  return value.trim();
}

export function validStr(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError("invalid", `${field} must be a non-empty string`);
  }
  return value.trim();
}

export function validInt(value: unknown, field: string): number {
  const parsed =
    typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    throw new AppError("invalid", `${field} must be an integer`);
  }
  return parsed;
}

export function validUint(value: unknown, field: string): number {
  const parsed = validInt(value, field);
  if (parsed < 0) {
    throw new AppError("invalid", `${field} must be a non-negative integer`);
  }
  return parsed;
}

export function validHex64(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new AppError("invalid", `${field} must be a 64-character hex string`);
  }
  return value.toLowerCase();
}

export function validAddress(value: unknown, field: string): string {
  const raw = validStr(value, field);
  if (!isValidMembershipCode(raw)) {
    throw new AppError("invalid", `${field} is not a valid address for this network`);
  }
  return raw;
}

export function upstreamStatus(kind: UpstreamKind): number {
  switch (kind) {
    case "bad_request":
      return 400;
    case "validation":
      return 422;
    case "conflict":
      return 409;
    case "rate_limited":
      return 429;
    case "unavailable":
      return 503;
    case "server":
      return 502;
    case "not_found":
      return 404;
    case "unknown":
      return 502;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function upstreamMessage(err: UpstreamError): string {
  if (isRecord(err.body)) {
    if (typeof err.body.error === "string" && err.body.error !== "") {
      return err.body.error;
    }
    if (typeof err.body.detail === "string" && err.body.detail !== "") {
      return err.body.detail;
    }
  }
  return err.message;
}

function txBuilderErrorKind(kind: TxBuilderError["kind"]): ErrorKind {
  switch (kind) {
    case "insufficient-funds":
      return "policy";
    case "invalid-amount":
      return "invalid";
    case "invalid-address":
      return "invalid";
  }
}

export function toRouteResult(err: unknown): RouteResult {
  if (err instanceof AppError) {
    const body: { kind: ErrorKind; source?: UpstreamKind; message: string } = {
      kind: err.kind,
      message: err.message,
    };
    if (err.source !== undefined) body.source = err.source;
    return { status: err.status, body: { error: body } };
  }
  if (err instanceof UpstreamError) {
    logger.warn("upstream error", {
      kind: err.kind,
      status: err.status,
      message: upstreamMessage(err),
    });
    return {
      status: upstreamStatus(err.kind),
      body: {
        error: { kind: "upstream", source: err.kind, message: upstreamMessage(err) },
      },
    };
  }
  if (err instanceof ChainError) {
    logger.warn("chain error", { category: err.category, message: err.message });
    return { status: 503, body: { error: { kind: "network", message: err.message } } };
  }
  if (err instanceof TxBuilderError) {
    logger.warn("transaction build error", { kind: err.kind, message: err.message });
    return {
      status: 422,
      body: { error: { kind: txBuilderErrorKind(err.kind), message: err.message } },
    };
  }
  if (err instanceof Error) {
    logger.error("unexpected error", { message: err.message, stack: err.stack });
  } else {
    logger.error("unexpected error", { value: String(err) });
  }
  return {
    status: 500,
    body: { error: { kind: "policy", message: "Something unexpected went wrong" } },
  };
}
