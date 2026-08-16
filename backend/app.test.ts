import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { BookChain } from "./book-api";
import type { TxModel } from "./kaspa-api-types";
import { SqliteMembershipStore } from "./membership-store";
import type { PaymentChain } from "./payments-api";

const USER_ADDRESS = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const VALID_CODE = "kaspatest:qpchy8753068rt2szvwxc0yr0kl38sjxqs0cg7xe97y6tzxh5h5wx09rle5a7";

function bookChainStub(): BookChain {
  return {
    getBalance: async () => ({ address: VALID_CODE, balance: 12500000000 }),
    getFullTransactions: async () => [],
  };
}

function paymentChainStub(): PaymentChain {
  return {
    getUtxos: async () => [],
    getTransaction: async () => ({}) as TxModel,
    getFeeEstimate: async () => ({
      priorityBucket: { feerate: 100, estimatedSeconds: 10 },
      normalBuckets: [{ feerate: 100, estimatedSeconds: 30 }],
      lowBuckets: [{ feerate: 100, estimatedSeconds: 600 }],
    }),
    broadcastTransaction: async () => ({ transactionId: "dd".repeat(32) }),
  };
}

interface TestServer {
  base: string;
  server: Server;
  store: SqliteMembershipStore;
}

async function startServer(): Promise<TestServer> {
  const store = new SqliteMembershipStore();
  const app = createApp({ store, bookChain: bookChainStub(), paymentChain: paymentChainStub() });
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, server, store };
}

async function post(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("HTTP API", () => {
  let testServer: TestServer;

  afterEach(async () => {
    testServer.server.close();
    testServer.store.close();
  });

  it("serves a health check", async () => {
    testServer = await startServer();
    const response = await fetch(`${testServer.base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("lists an empty set of memberships for a new user", async () => {
    testServer = await startServer();
    const response = await fetch(
      `${testServer.base}/api/memberships?user=${encodeURIComponent(USER_ADDRESS)}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ memberships: [] });
  });

  it("joins, lists, and leaves a chama", async () => {
    testServer = await startServer();

    const joined = await post(testServer.base, "/api/memberships", {
      user_address: USER_ADDRESS,
      chama_address: VALID_CODE,
    });
    expect(joined.status).toBe(201);
    expect((await joined.json()).outcome).toBe("joined");

    const duplicate = await post(testServer.base, "/api/memberships", {
      user_address: USER_ADDRESS,
      chama_address: VALID_CODE,
    });
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json()).outcome).toBe("already-member");

    const listed = await fetch(
      `${testServer.base}/api/memberships?user=${encodeURIComponent(USER_ADDRESS)}`,
    );
    expect((await listed.json()).memberships).toHaveLength(1);

    const left = await fetch(`${testServer.base}/api/memberships`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_address: USER_ADDRESS, chama_address: VALID_CODE }),
    });
    expect(left.status).toBe(200);
    expect((await left.json()).outcome).toBe("left");

    const afterLeave = await fetch(
      `${testServer.base}/api/memberships?user=${encodeURIComponent(USER_ADDRESS)}`,
    );
    expect((await afterLeave.json()).memberships).toHaveLength(0);
  });

  it("rejects an invalid chama code when joining", async () => {
    testServer = await startServer();
    const response = await post(testServer.base, "/api/memberships", {
      user_address: USER_ADDRESS,
      chama_address: "not-a-code",
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ outcome: "invalid-code" });
  });

  it("rejects a malformed JSON body", async () => {
    testServer = await startServer();
    const response = await post(testServer.base, "/api/memberships", "{not json");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { kind: "invalid", message: "Request body is not valid JSON" },
    });
  });

  it("returns a structured error for an invalid chama code on the book", async () => {
    testServer = await startServer();
    const response = await fetch(`${testServer.base}/api/chamas/not-a-code/book`);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("invalid");
  });

  it("reads the book from the chain for a valid code", async () => {
    testServer = await startServer();
    const response = await fetch(
      `${testServer.base}/api/chamas/${encodeURIComponent(VALID_CODE)}/book`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ balance_sompi: "12500000000", rows: [] });
  });

  it("rejects a payment prepare with missing fields", async () => {
    testServer = await startServer();
    const response = await post(testServer.base, "/api/payments/prepare", {});
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe("invalid");
  });

  it("rejects an unaffordable payment as a policy error", async () => {
    testServer = await startServer();
    const response = await post(testServer.base, "/api/payments/prepare", {
      user_address: USER_ADDRESS,
      chama_address: VALID_CODE,
      amount_sompi: "100000000",
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe("policy");
  });

  it("rejects a payment finalize without a signed transaction", async () => {
    testServer = await startServer();
    const response = await post(testServer.base, "/api/payments/finalize", {});
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe("invalid");
  });
});
