import { requestContext } from "./request-context";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SILENT = process.env.NODE_ENV === "test" || process.env.LOG_SILENT === "true";

const THRESHOLD: number =
  LEVEL_ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVEL_ORDER.info;

function safeStringify(extra: Record<string, unknown>): string {
  try {
    return JSON.stringify(extra) ?? "";
  } catch {
    return String(extra);
  }
}

function write(level: Level, message: string, extra?: Record<string, unknown>): void {
  if (SILENT) return;
  if (LEVEL_ORDER[level] < THRESHOLD) return;
  const requestId = requestContext.getStore()?.requestId;
  const fields = { ...(requestId !== undefined ? { requestId } : {}), ...extra };
  const suffix = Object.keys(fields).length > 0 ? ` ${safeStringify(fields)}` : "";
  // eslint-disable-next-line no-console
  console[level === "debug" ? "info" : level](
    `${new Date().toISOString()} [daftari:${level}] ${message}${suffix}`,
  );
}

export const logger = {
  debug: (message: string, extra?: Record<string, unknown>): void =>
    write("debug", message, extra),
  info: (message: string, extra?: Record<string, unknown>): void =>
    write("info", message, extra),
  warn: (message: string, extra?: Record<string, unknown>): void =>
    write("warn", message, extra),
  error: (message: string, extra?: Record<string, unknown>): void =>
    write("error", message, extra),
};
