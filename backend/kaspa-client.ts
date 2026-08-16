import { getNetworkConfig } from "../shared/network";
import type {
  BalanceResponse,
  FeeEstimateResponse,
  SubmitTransactionResponse,
  SubmitTxModel,
  TxModel,
  UtxoResponse,
} from "./kaspa-api-types";
import { logger } from "./logger";

export type Endpoint =
  | "balance"
  | "full-transactions"
  | "utxos"
  | "transaction"
  | "fee-estimate";

export type UpstreamKind =
  | "bad_request"
  | "validation"
  | "conflict"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "server"
  | "unknown";

export class ChainError extends Error {
  readonly category: "network" | "timeout" | "upstream";

  constructor(category: ChainError["category"], message: string) {
    super(message);
    this.name = "ChainError";
    this.category = category;
  }
}

export class NetworkError extends ChainError {
  constructor(message: string, cause?: unknown) {
    super("network", message);
    this.name = "NetworkError";
    if (cause !== undefined) this.cause = cause;
  }
}

export class TimeoutError extends ChainError {
  constructor(message: string) {
    super("timeout", message);
    this.name = "TimeoutError";
  }
}

export class UpstreamError extends ChainError {
  readonly status: number;
  readonly kind: UpstreamKind;
  readonly body: unknown;

  constructor(message: string, status: number, kind: UpstreamKind, body: unknown) {
    super("upstream", message);
    this.name = "UpstreamError";
    this.status = status;
    this.kind = kind;
    this.body = body;
  }
}

export interface KaspaClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  cacheTtls?: Partial<Record<Endpoint, number>>;
  sleeper?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BACKOFF_BASE_MS = 200;
const DEFAULT_PAGE_SIZE = 50;

const DEFAULT_TTL_MS: Record<Endpoint, number> = {
  balance: 5_000,
  "full-transactions": 5_000,
  utxos: 5_000,
  transaction: 5_000,
  "fee-estimate": 30_000,
};

const RETRYABLE_STATUSES = new Set([429, 503]);

function defaultSleeper(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyStatus(status: number): UpstreamKind {
  switch (status) {
    case 400:
      return "bad_request";
    case 422:
      return "validation";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    case 503:
      return "unavailable";
    default:
      return status >= 500 ? "server" : "unknown";
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return null;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

export class KaspaClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly ttls: Record<Endpoint, number>;
  private readonly sleeper: (ms: number) => Promise<void>;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(config: KaspaClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? getNetworkConfig().apiBaseUrl;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffBaseMs = config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.ttls = { ...DEFAULT_TTL_MS, ...config.cacheTtls };
    this.sleeper = config.sleeper ?? defaultSleeper;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  getBalance(address: string): Promise<BalanceResponse> {
    return this.request("balance", `/addresses/${address}/balance`, {
      cacheable: true,
    });
  }

  getFullTransactions(
    address: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<TxModel[]> {
    const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
    const offset = opts.offset ?? 0;
    return this.request(
      "full-transactions",
      `/addresses/${address}/full-transactions?limit=${limit}&offset=${offset}`,
      { cacheable: true },
    );
  }

  getUtxos(address: string): Promise<UtxoResponse[]> {
    return this.request("utxos", `/addresses/${address}/utxos`, {
      cacheable: true,
    });
  }

  getTransaction(txid: string): Promise<TxModel> {
    return this.request("transaction", `/transactions/${txid}`, {
      cacheable: true,
    });
  }

  getFeeEstimate(): Promise<FeeEstimateResponse> {
    return this.request("fee-estimate", "/info/fee-estimate", {
      cacheable: true,
    });
  }

  broadcastTransaction(
    transaction: SubmitTxModel,
  ): Promise<SubmitTransactionResponse> {
    return this.request("broadcast", "/transactions", {
      method: "POST",
      body: { transaction, allowOrphan: false },
    });
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async request<T>(
    endpoint: string,
    path: string,
    opts: { method?: "GET" | "POST"; cacheable?: boolean; body?: unknown } = {},
  ): Promise<T> {
    const { method = "GET", cacheable = false, body } = opts;
    const key = `${method} ${path}`;

    if (cacheable) {
      const hit = this.cache.get(key);
        if (hit !== undefined && hit.expiresAt > Date.now()) {
          logger.debug("upstream cache hit", { endpoint, path });
          return hit.value as T;
        }
    }

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const attemptStart = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const init: RequestInit = {
          method,
          signal: controller.signal,
        };
        if (body !== undefined) {
          init.body = JSON.stringify(body);
          init.headers = { "content-type": "application/json" };
        }

        logger.debug("upstream request", { endpoint, path, method, attempt: attempt + 1 });
        const res = await this.fetchImpl(this.baseUrl + path, init);
        const responseBody = await readBody(res);
        logger.debug("upstream response", {
          endpoint,
          path,
          method,
          status: res.status,
          durationMs: Date.now() - attemptStart,
        });

        if (res.ok) {
          if (cacheable) {
            this.cache.set(key, {
              expiresAt: Date.now() + this.ttls[endpoint as Endpoint],
              value: responseBody,
            });
          }
          return responseBody as T;
        }

        const retryable = RETRYABLE_STATUSES.has(res.status);
        if (retryable && attempt < this.maxAttempts - 1) {
          logger.debug("upstream retry scheduled", {
            endpoint,
            path,
            status: res.status,
            attempt: attempt + 1,
          });
          await this.sleeper(this.retryDelayMs(res, attempt));
          continue;
        }

        throw new UpstreamError(
          `Kaspa upstream responded ${res.status} for ${method} ${path}`,
          res.status,
          classifyStatus(res.status),
          responseBody,
        );
      } catch (err) {
        if (controller.signal.aborted) {
          logger.warn("upstream request timed out", { endpoint, path, timeoutMs: this.timeoutMs });
          throw new TimeoutError(
            `Request timed out after ${this.timeoutMs}ms: ${method} ${path}`,
          );
        }
        if (err instanceof ChainError) throw err;
        throw new NetworkError(`Network error on ${method} ${path}`, err);
      } finally {
        clearTimeout(timer);
      }
    }

    throw new UpstreamError(
      `Kaspa upstream did not respond for ${method} ${path}`,
      0,
      "unknown",
      undefined,
    );
  }

  private retryDelayMs(res: Response, attempt: number): number {
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    if (retryAfter !== null) return retryAfter;
    return this.backoffBaseMs * 2 ** attempt;
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
