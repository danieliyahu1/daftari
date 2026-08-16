import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { BookChain } from "./book-api";
import type { TxModel } from "./kaspa-api-types";
import { SqliteMembershipStore } from "./membership-store";
import type { PaymentChain } from "./payments-api";
import { SqliteWalletStore } from "./wallet-store";

const USER_ADDRESS = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const VALID_CODE = "kaspatest:qpchy8753068rt2szvwxc0yr0kl38sjxqs0cg7xe97y6tzxh5h5wx09rle5a7";

function bookChainStub(): BookChain {
  return {
    getBalance: async () => ({ address: VALID_CODE, balance: 12500000000 }),
    getFullTransactions: async () => [],
  };
}

function txWithParty(party: string): TxModel {
  const txid = "cc".repeat(32);
  return {
    subnetwork_id: "0".repeat(64),
    transaction_id: txid,
    hash: txid,
    mass: "100",
    payload: "",
    block_hash: [],
    block_time: 300,
    version: 0,
    is_accepted: true,
    accepting_block_hash: "",
    accepting_block_blue_score: 0,
    accepting_block_time: 0,
    inputs: [
      {
        transaction_id: txid,
        index: 0,
        previous_outpoint_hash: "0".repeat(64),
        previous_outpoint_index: "0",
        signature_script: "",
        sig_op_count: "1",
        previous_outpoint_address: party,
        previous_outpoint_amount: 100000000,
      },
    ],
    outputs: [
      {
        transaction_id: txid,
        index: 0,
        amount: 100000000,
        script_public_key: "20..",
        script_public_key_address: VALID_CODE,
      },
    ],
  };
}

function bookChainWithParty(party: string): BookChain {
  return {
    getBalance: async () => ({ address: VALID_CODE, balance: 12500000000 }),
    getFullTransactions: async () => [txWithParty(party)],
  };
}

function paymentChainStub(): PaymentChain {
  return {
    getUtxos: async () => [],
    getTransaction: async () =>
      ({
        subnetwork_id: "0".repeat(64),
        transaction_id: "dd".repeat(32),
        hash: "dd".repeat(32),
        mass: "100",
        payload: "",
        block_hash: [],
        block_time: 0,
        version: 0,
        is_accepted: true,
        accepting_block_hash: "",
        accepting_block_blue_score: 0,
        accepting_block_time: 0,
        inputs: [],
        outputs: [
          {
            transaction_id: "dd".repeat(32),
            index: 0,
            amount: 10000000000,
            script_public_key: "20..",
          },
        ],
      }) as TxModel,
    getFeeEstimate: async () => ({
      priorityBucket: { feerate: 100, estimatedSeconds: 10 },
      normalBuckets: [{ feerate: 100, estimatedSeconds: 30 }],
      lowBuckets: [{ feerate: 100, estimatedSeconds: 600 }],
    }),
    broadcastTransaction: async () => ({ transactionId: "dd".repeat(32) }),
  };
}

function validSignedTx(): string {
  return JSON.stringify({
    id: "0".repeat(64),
    version: 0,
    inputs: [
      {
        transactionId: "dd".repeat(32),
        index: 0,
        sequence: "0",
        sigOpCount: 1,
        computeBudget: 0,
        signatureScript: "01".repeat(32),
        utxo: {
          amount: "0",
          scriptPublicKey: `0000${"20".repeat(32)}`,
          blockDaaScore: "0",
          isCoinbase: false,
        },
      },
    ],
    outputs: [
      {
        value: "100000000",
        scriptPublicKey: `0000${"20".repeat(32)}`,
        covenant: null,
      },
    ],
    subnetworkId: "0".repeat(40),
    lockTime: "0",
    gas: "0",
    storageMass: "20000",
    payload: "",
  });
}

interface TestServer {
  base: string;
  server: Server;
  store: SqliteMembershipStore;
  walletStore: SqliteWalletStore;
}

async function startServer(
  paymentChain: PaymentChain = paymentChainStub(),
  confirmPolicy?: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; sleeper?: (ms: number) => Promise<void> },
  bookChain: BookChain = bookChainStub(),
): Promise<TestServer> {
  const store = new SqliteMembershipStore();
  const walletStore = new SqliteWalletStore();
  const app = createApp({ store, walletStore, bookChain, paymentChain, confirmPolicy });
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, server, store, walletStore };
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
    testServer.walletStore.close();
  });

  it("serves a health check", async () => {
    testServer = await startServer();
    const response = await fetch(`${testServer.base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns an unregistered home for a new user", async () => {
    testServer = await startServer();
    const response = await fetch(
      `${testServer.base}/api/memberships?user=${encodeURIComponent(USER_ADDRESS)}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ identity: null, members: [], chamas: [] });
  });

  it("adds a member from the book and reflects it on both homes", async () => {
    testServer = await startServer(undefined, undefined, bookChainWithParty(USER_ADDRESS));
    await post(testServer.base, "/api/wallets/register", {
      address: VALID_CODE,
      name: "Plot",
      kind: "group",
    });
    await post(testServer.base, "/api/wallets/register", {
      address: USER_ADDRESS,
      name: "Amina",
      kind: "user",
    });

    const added = await post(testServer.base, "/api/memberships", {
      group_address: VALID_CODE,
      member_address: USER_ADDRESS,
    });
    expect(added.status).toBe(201);
    expect((await added.json()) as unknown).toMatchObject({
      membership: { user_address: USER_ADDRESS, chama_address: VALID_CODE },
    });

    const personHome = await fetch(
      `${testServer.base}/api/memberships?user=${encodeURIComponent(USER_ADDRESS)}`,
    );
    expect(await personHome.json()).toMatchObject({
      identity: { address: USER_ADDRESS, name: "Amina", kind: "user" },
      members: [],
      chamas: [{ address: VALID_CODE, name: "Plot", kind: "group" }],
    });

    const groupHome = await fetch(
      `${testServer.base}/api/memberships?user=${encodeURIComponent(VALID_CODE)}`,
    );
    expect(await groupHome.json()).toMatchObject({
      identity: { address: VALID_CODE, name: "Plot", kind: "group" },
      members: [{ address: USER_ADDRESS, name: "Amina", kind: "user" }],
      chamas: [],
    });
  });

  it("refuses to add a member who has not transacted with the group", async () => {
    testServer = await startServer();
    await post(testServer.base, "/api/wallets/register", {
      address: VALID_CODE,
      name: "Plot",
      kind: "group",
    });
    const response = await post(testServer.base, "/api/memberships", {
      group_address: VALID_CODE,
      member_address: USER_ADDRESS,
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      "This wallet hasn't paid into the chama.",
    );
  });

  it("refuses to add a member when the group is not registered", async () => {
    testServer = await startServer(undefined, undefined, bookChainWithParty(USER_ADDRESS));
    const response = await post(testServer.base, "/api/memberships", {
      group_address: VALID_CODE,
      member_address: USER_ADDRESS,
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      "This isn't a registered group.",
    );
  });

  it("registers a wallet through the API", async () => {
    testServer = await startServer();
    const response = await post(testServer.base, "/api/wallets/register", {
      address: USER_ADDRESS,
      name: "Amina",
      kind: "user",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { wallet: { address: string; name: string; kind: string } };
    expect(body.wallet).toMatchObject({ address: USER_ADDRESS, name: "Amina", kind: "user" });
  });

  it("rejects a second registration of the same wallet with a conflict", async () => {
    testServer = await startServer();
    await post(testServer.base, "/api/wallets/register", {
      address: USER_ADDRESS,
      name: "Amina",
      kind: "user",
    });
    const response = await post(testServer.base, "/api/wallets/register", {
      address: USER_ADDRESS,
      name: "Bob",
      kind: "group",
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe("conflict");
  });

  it("resolves registered names in bulk and omits the unknown", async () => {
    testServer = await startServer();
    await post(testServer.base, "/api/wallets/register", {
      address: USER_ADDRESS,
      name: "Amina",
      kind: "user",
    });

    const response = await fetch(
      `${testServer.base}/api/wallets/resolve?addresses=${encodeURIComponent(`${USER_ADDRESS},${VALID_CODE}`)}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      wallets: [
        {
          address: USER_ADDRESS,
          name: "Amina",
          kind: "user",
          created_at: expect.any(Number),
        },
      ],
    });
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

  it("refuses an unregistered group code on the book with the exact copy", async () => {
    testServer = await startServer();
    const response = await fetch(
      `${testServer.base}/api/chamas/${encodeURIComponent(VALID_CODE)}/book`,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { kind: "invalid", message: "This isn't a registered group." },
    });
  });

  it("refuses a registered user wallet as a chama on the book", async () => {
    testServer = await startServer();
    await post(testServer.base, "/api/wallets/register", {
      address: VALID_CODE,
      name: "Amina",
      kind: "user",
    });
    const response = await fetch(
      `${testServer.base}/api/chamas/${encodeURIComponent(VALID_CODE)}/book`,
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      "This isn't a registered group.",
    );
  });

  it("reads the book from the chain for a registered group and enriches it", async () => {
    testServer = await startServer();
    await post(testServer.base, "/api/wallets/register", {
      address: VALID_CODE,
      name: "Plot",
      kind: "group",
    });
    const response = await fetch(
      `${testServer.base}/api/chamas/${encodeURIComponent(VALID_CODE)}/book?user=${encodeURIComponent(VALID_CODE)}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      balance_sompi: "12500000000",
      rows: [],
      group: { address: VALID_CODE, name: "Plot", kind: "group" },
    });
  });

  it("refuses a non-member with the member-only copy", async () => {
    testServer = await startServer();
    await post(testServer.base, "/api/wallets/register", {
      address: VALID_CODE,
      name: "Plot",
      kind: "group",
    });
    await post(testServer.base, "/api/wallets/register", {
      address: USER_ADDRESS,
      name: "Amina",
      kind: "user",
    });
    const response = await fetch(
      `${testServer.base}/api/chamas/${encodeURIComponent(VALID_CODE)}/book?user=${encodeURIComponent(USER_ADDRESS)}`,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { kind: "policy", message: "Only members can see this chama." },
    });
  });

  it("lets a member read the book with membership marked on the rows", async () => {
    testServer = await startServer(undefined, undefined, bookChainWithParty(USER_ADDRESS));
    await post(testServer.base, "/api/wallets/register", {
      address: VALID_CODE,
      name: "Plot",
      kind: "group",
    });
    await post(testServer.base, "/api/wallets/register", {
      address: USER_ADDRESS,
      name: "Amina",
      kind: "user",
    });
    await post(testServer.base, "/api/memberships", {
      group_address: VALID_CODE,
      member_address: USER_ADDRESS,
    });

    const response = await fetch(
      `${testServer.base}/api/chamas/${encodeURIComponent(VALID_CODE)}/book?user=${encodeURIComponent(USER_ADDRESS)}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rows: Array<{ other_address: string; other_is_member: boolean }> };
    expect(body.rows[0]).toMatchObject({
      other_address: USER_ADDRESS,
      other_is_member: true,
    });
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

  it("records a finalized payment that is accepted on chain", async () => {
    const chain = paymentChainStub();
    testServer = await startServer(chain);
    const response = await post(testServer.base, "/api/payments/finalize", {
      signed: validSignedTx(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "recorded",
      txid: "dd".repeat(32),
    });
  });

  it("returns 202 pending with an explorer link when acceptance is not confirmed in time", async () => {
    const chain = paymentChainStub();
    chain.getTransaction = async () =>
      ({
        subnetwork_id: "0".repeat(64),
        transaction_id: "dd".repeat(32),
        hash: "dd".repeat(32),
        mass: "100",
        payload: "",
        block_hash: [],
        block_time: 0,
        version: 0,
        is_accepted: false,
        accepting_block_hash: "",
        accepting_block_blue_score: 0,
        accepting_block_time: 0,
        inputs: [],
        outputs: [{ transaction_id: "dd".repeat(32), index: 0, amount: 1000000000, script_public_key: "20.." }],
      }) as TxModel;
    testServer = await startServer(chain, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 1,
      sleeper: async () => {},
    });
    const response = await post(testServer.base, "/api/payments/finalize", {
      signed: validSignedTx(),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      status: "pending",
      txid: "dd".repeat(32),
      explorer_url: `https://explorer-tn10.kaspa.org/txs/${"dd".repeat(32)}`,
    });
  });
});
