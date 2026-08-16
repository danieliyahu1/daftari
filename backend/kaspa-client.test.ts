import { describe, expect, it, vi } from "vitest";
import {
  KaspaClient,
  NetworkError,
  TimeoutError,
  UpstreamError,
} from "./kaspa-client";
import type { Endpoint } from "./kaspa-client";
import type {
  BalanceResponse,
  FeeEstimateResponse,
  SubmitTransactionResponse,
  SubmitTxModel,
  TxModel,
  UtxoResponse,
} from "./kaspa-api-types";

const BASE = "https://api.example";

interface Step {
  body?: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function jsonResponse(step: Step): Response {
  return new Response(
    step.body === undefined ? "" : JSON.stringify(step.body),
    {
      status: step.status ?? 200,
      headers: step.headers,
    },
  );
}

function sequenceFetch(steps: Step[]): ReturnType<typeof vi.fn> {
  return vi.fn(async () => {
    const step = steps[0];
    if (steps.length > 1) steps.shift();
    return jsonResponse(step);
  });
}

const noopSleeper = vi.fn(async (_ms: number) => {});

function client(opts: {
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  backoffBaseMs?: number;
  sleeper?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  cacheTtls?: Partial<Record<Endpoint, number>>;
} = {}): KaspaClient {
  return new KaspaClient({
    baseUrl: BASE,
    maxAttempts: opts.maxAttempts ?? 1,
    backoffBaseMs: opts.backoffBaseMs,
    sleeper: opts.sleeper ?? noopSleeper,
    timeoutMs: opts.timeoutMs,
    cacheTtls: opts.cacheTtls,
    fetchImpl: opts.fetchImpl,
  });
}

const ADDRESS = "kaspatest:qrn8dmc8cczy5dc4qfdg9y7k8yp5s5f2q5l8y2p4px2qq9zxfghlj2j7z8q8";

describe("KaspaClient reads", () => {
  it("getBalance parses the balance and hits the right URL", async () => {
    const fetchImpl = sequenceFetch([
      { body: { address: ADDRESS, balance: 1234 } },
    ]);
    const c = client({ fetchImpl });

    const balance = await c.getBalance(ADDRESS);

    expect(balance).toEqual<BalanceResponse>({
      address: ADDRESS,
      balance: 1234,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/addresses/${ADDRESS}/balance`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("getFullTransactions sends default limit/offset", async () => {
    const fetchImpl = sequenceFetch([{ body: [] }]);
    const c = client({ fetchImpl });

    await c.getFullTransactions(ADDRESS);

    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/addresses/${ADDRESS}/full-transactions?limit=50&offset=0`,
      expect.anything(),
    );
  });

  it("getFullTransactions honours custom pagination", async () => {
    const fetchImpl = sequenceFetch([{ body: [] }]);
    const c = client({ fetchImpl });

    await c.getFullTransactions(ADDRESS, { limit: 20, offset: 40 });

    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/addresses/${ADDRESS}/full-transactions?limit=20&offset=40`,
      expect.anything(),
    );
  });

  it("getUtxos parses the utxo list", async () => {
    const utxos: UtxoResponse[] = [
      {
        outpoint: { transactionId: "abc123", index: 0 },
        utxoEntry: {
          amount: "100000000",
          scriptPublicKey: { scriptPublicKey: "20..." },
          blockDaaScore: "1",
          isCoinbase: false,
        },
      },
    ];
    const fetchImpl = sequenceFetch([{ body: utxos }]);
    const c = client({ fetchImpl });

    const result = await c.getUtxos(ADDRESS);

    expect(result).toEqual(utxos);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/addresses/${ADDRESS}/utxos`,
      expect.anything(),
    );
  });

  it("getTransaction parses a single tx", async () => {
    const tx: TxModel = {
      subnetwork_id: "0000000000000000000000000000000000000000000000000000000000000001",
      transaction_id: "4c173424b6b6e3b7dc7a7ba4170bd08688134db3286fc55129ac0482e9533dae",
      hash: "hash",
      mass: "100",
      payload: "",
      block_hash: [],
      block_time: 1720000000,
      version: 0,
      is_accepted: true,
      accepting_block_hash: "",
      accepting_block_blue_score: 0,
      accepting_block_time: 0,
      inputs: [],
      outputs: [],
    };
    const fetchImpl = sequenceFetch([{ body: tx }]);
    const c = client({ fetchImpl });

    const result = await c.getTransaction(tx.transaction_id);

    expect(result).toEqual(tx);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/transactions/${tx.transaction_id}`,
      expect.anything(),
    );
  });

  it("getFeeEstimate parses the buckets", async () => {
    const fee: FeeEstimateResponse = {
      priorityBucket: { feerate: 2, estimatedSeconds: 5 },
      normalBuckets: [{ feerate: 1, estimatedSeconds: 10 }],
      lowBuckets: [{ feerate: 0.5, estimatedSeconds: 60 }],
    };
    const fetchImpl = sequenceFetch([{ body: fee }]);
    const c = client({ fetchImpl });

    const result = await c.getFeeEstimate();

    expect(result).toEqual(fee);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/info/fee-estimate`,
      expect.anything(),
    );
  });
});

describe("KaspaClient broadcast", () => {
  it("POSTs a SubmitTxModel and returns the transactionId", async () => {
    const tx: SubmitTxModel = {
      version: 0,
      inputs: [
        {
          previousOutpoint: { transactionId: "abc", index: 1 },
          signatureScript: "sig",
          sequence: 0,
          sigOpCount: 1,
        },
      ],
      outputs: [
        {
          amount: 1000,
          scriptPublicKey: { version: 0, scriptPublicKey: "20..." },
        },
      ],
    };
    const fetchImpl = sequenceFetch([
      { body: { transactionId: "txid123" } satisfies SubmitTransactionResponse },
    ]);
    const c = client({ fetchImpl });

    const result = await c.broadcastTransaction(tx);

    expect(result).toEqual({ transactionId: "txid123" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      transaction: tx,
      allowOrphan: false,
    });
  });
});

describe("KaspaClient retry and backoff", () => {
  it("retries once on 503 with the base backoff delay", async () => {
    const sleeper = vi.fn(async (_ms: number) => {});
    const fetchImpl = sequenceFetch([
      { status: 503, body: {} },
      { body: { address: ADDRESS, balance: 1 } },
    ]);
    const c = client({
      fetchImpl,
      maxAttempts: 3,
      backoffBaseMs: 100,
      sleeper,
    });

    const result = await c.getBalance(ADDRESS);

    expect(result.balance).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeper).toHaveBeenCalledTimes(1);
    expect(sleeper).toHaveBeenCalledWith(100);
  });

  it("doubles the backoff across consecutive 503s", async () => {
    const sleeper = vi.fn(async (_ms: number) => {});
    const fetchImpl = sequenceFetch([
      { status: 503, body: {} },
      { status: 503, body: {} },
      { body: { address: ADDRESS, balance: 1 } },
    ]);
    const c = client({
      fetchImpl,
      maxAttempts: 4,
      backoffBaseMs: 100,
      sleeper,
    });

    await c.getBalance(ADDRESS);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeper.mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
  });

  it("honours Retry-After seconds over the backoff", async () => {
    const sleeper = vi.fn(async (_ms: number) => {});
    const fetchImpl = sequenceFetch([
      { status: 429, body: {}, headers: { "retry-after": "2" } },
      { body: { address: ADDRESS, balance: 1 } },
    ]);
    const c = client({
      fetchImpl,
      maxAttempts: 3,
      backoffBaseMs: 100,
      sleeper,
    });

    await c.getBalance(ADDRESS);

    expect(sleeper).toHaveBeenCalledTimes(1);
    expect(sleeper).toHaveBeenCalledWith(2000);
  });

  it("surfaces a structured rejection once retries are exhausted", async () => {
    const fetchImpl = sequenceFetch([{ status: 503, body: { detail: "x" } }]);
    const c = client({ fetchImpl, maxAttempts: 3 });

    const err = await c.getBalance(ADDRESS).catch((e) => e);

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({
      category: "upstream",
      status: 503,
      kind: "unavailable",
      body: { detail: "x" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a plain 5xx that is not 503", async () => {
    const fetchImpl = sequenceFetch([{ status: 500, body: {} }]);
    const c = client({ fetchImpl, maxAttempts: 4 });

    const err = await c.getBalance(ADDRESS).catch((e) => e);

    expect(err).toMatchObject({ kind: "server", status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("KaspaClient rejection parsing", () => {
  it("surfaces a 400 submit as a structured bad_request rejection", async () => {
    const body = { error: "Transaction is invalid", transactionId: null };
    const fetchImpl = sequenceFetch([{ status: 400, body }]);
    const c = client({ fetchImpl, maxAttempts: 3 });

    const err = await c
      .broadcastTransaction({ version: 0, inputs: [], outputs: [] })
      .catch((e) => e);

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({
      category: "upstream",
      status: 400,
      kind: "bad_request",
      body,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies 422 as validation", async () => {
    const fetchImpl = sequenceFetch([
      { status: 422, body: { detail: [{ loc: ["body"], msg: "bad", type: "x" }] } },
    ]);
    const c = client({ fetchImpl, maxAttempts: 3 });

    const err = await c.getBalance(ADDRESS).catch((e) => e);

    expect(err).toMatchObject({ kind: "validation", status: 422 });
  });

  it("classifies 409 as conflict", async () => {
    const fetchImpl = sequenceFetch([{ status: 409, body: {} }]);
    const c = client({ fetchImpl, maxAttempts: 3 });

    const err = await c.getBalance(ADDRESS).catch((e) => e);

    expect(err).toMatchObject({ kind: "conflict", status: 409 });
  });

  it("surfaces a 404 on tx lookup as not_found without retrying", async () => {
    const fetchImpl = sequenceFetch([{ status: 404, body: {} }]);
    const c = client({ fetchImpl, maxAttempts: 3 });

    const err = await c.getTransaction("4c173424b6b6e3b7dc7a7ba4170bd08688134db3286fc55129ac0482e9533dae").catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ kind: "not_found", status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("KaspaClient cache", () => {
  it("serves identical reads from the short-TTL cache", async () => {
    const fetchImpl = sequenceFetch([{ body: { address: ADDRESS, balance: 5 } }]);
    const c = client({ fetchImpl });

    const a = await c.getBalance(ADDRESS);
    const b = await c.getBalance(ADDRESS);

    expect(a).toEqual(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refetches after the endpoint TTL expires", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = sequenceFetch([
        { body: { address: ADDRESS, balance: 5 } },
        { body: { address: ADDRESS, balance: 6 } },
      ]);
      const c = client({ fetchImpl, cacheTtls: { balance: 100 } });

      await c.getBalance(ADDRESS);
      await vi.advanceTimersByTimeAsync(101);
      const result = await c.getBalance(ADDRESS);

      expect(result.balance).toBe(6);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caches per endpoint and per key", async () => {
    const fetchImpl = sequenceFetch([
      { body: { address: ADDRESS, balance: 5 } },
      { body: [] },
    ]);
    const c = client({ fetchImpl });

    await c.getBalance(ADDRESS);
    await c.getFullTransactions(ADDRESS);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("clearCache forces the next read to refetch", async () => {
    const fetchImpl = sequenceFetch([
      { body: { address: ADDRESS, balance: 5 } },
      { body: { address: ADDRESS, balance: 6 } },
    ]);
    const c = client({ fetchImpl });

    await c.getBalance(ADDRESS);
    c.clearCache();
    const result = await c.getBalance(ADDRESS);

    expect(result.balance).toBe(6);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never caches a failed response", async () => {
    const fetchImpl = sequenceFetch([{ status: 503, body: {} }]);
    const c = client({ fetchImpl, maxAttempts: 3 });

    await c.getBalance(ADDRESS).catch(() => {});
    await c.getBalance(ADDRESS).catch(() => {});

    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});

describe("KaspaClient error taxonomy", () => {
  it("distinguishes a timeout from a network error", async () => {
    const abortingFetch = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const c = client({
      fetchImpl: abortingFetch as unknown as typeof fetch,
      timeoutMs: 20,
      maxAttempts: 2,
    });

    const err = await c.getBalance(ADDRESS).catch((e) => e);

    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).toMatchObject({ category: "timeout" });
  });

  it("distinguishes a network error from an upstream error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const c = client({ fetchImpl, maxAttempts: 2 });

    const err = await c.getBalance(ADDRESS).catch((e) => e);

    expect(err).toBeInstanceOf(NetworkError);
    expect(err).toMatchObject({ category: "network" });
  });
});
