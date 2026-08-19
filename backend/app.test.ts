import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { createApp } from "./app";
import type { AuthStore } from "./auth-store";
import type { BookChain } from "./book-api";
import type { TxModel } from "./kaspa-api-types";
import type { MembershipStore } from "./membership-store";
import type { PaymentChain } from "./payments-api";
import type { WalletStore } from "./wallet-store";
import { FakeAuthStore, FakeMembershipStore, FakeWalletStore } from "./test-stores";
import { pubkeyToP2PKAddress } from "./kaspa-address";
import { messageHash } from "./kaspa-signature";

const SECRET = new TextEncoder().encode("test-secret-that-is-long-enough-for-hs256");
const ORIGIN = "http://localhost:5173";

const USER_PRIV = Uint8Array.from([...Array(31).fill(0), 3]);
const GROUP_PRIV = Uint8Array.from([...Array(31).fill(0), 4]);

function addressFor(priv: Uint8Array): string {
  const address = pubkeyToP2PKAddress(schnorr.getPublicKey(priv), "kaspatest");
  if (address === null) throw new Error("no address");
  return address;
}

const USER_ADDRESS = addressFor(USER_PRIV);
const VALID_CODE = addressFor(GROUP_PRIV);

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function signMessage(message: string, priv: Uint8Array): string {
  const hash = messageHash(message);
  return hex(schnorr.sign(hash, priv));
}

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
  store: MembershipStore;
  walletStore: WalletStore;
  authStore: AuthStore;
}

async function startServer(
  paymentChain: PaymentChain = paymentChainStub(),
  confirmPolicy?: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; sleeper?: (ms: number) => Promise<void> },
  bookChain: BookChain = bookChainStub(),
): Promise<TestServer> {
  const store = new FakeMembershipStore();
  const walletStore = new FakeWalletStore();
  const authStore = new FakeAuthStore();
  const app = createApp({
    store,
    walletStore,
    authStore,
    authSecret: SECRET,
    origin: ORIGIN,
    bookChain,
    paymentChain,
    confirmPolicy,
  });
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, server, store, walletStore, authStore };
}

async function post(base: string, path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function get(base: string, path: string, token?: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// Completes the full sign-in flow and returns a bearer token for the address.
async function tokenFor(base: string, address: string, priv: Uint8Array): Promise<string> {
  const challenge = await post(base, "/api/auth/challenge", { address });
  expect(challenge.status).toBe(200);
  const { message } = (await challenge.json()) as { message: string };
  const signature = signMessage(message, priv);
  const session = await post(base, "/api/auth/session", { message, signature });
  expect(session.status).toBe(200);
  return ((await session.json()) as { token: string }).token;
}

describe("HTTP API", () => {
  let testServer: TestServer;

  afterEach(async () => {
    testServer.server.close();
    testServer.store.close();
    testServer.walletStore.close();
    testServer.authStore.close();
  });

  it("serves a health check", async () => {
    testServer = await startServer();
    const response = await fetch(`${testServer.base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("refuses an unauthenticated home request", async () => {
    testServer = await startServer();
    const response = await fetch(`${testServer.base}/api/memberships`);
    expect(response.status).toBe(401);
  });

  it("returns an unregistered home for a new user", async () => {
    testServer = await startServer();
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    const response = await get(testServer.base, "/api/memberships", token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ identity: null, members: [], chamas: [] });
  });

  it("adds a member from the book and reflects it on both homes", async () => {
    testServer = await startServer(undefined, undefined, bookChainWithParty(USER_ADDRESS));
    const groupToken = await tokenFor(testServer.base, VALID_CODE, GROUP_PRIV);
    const userToken = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    await post(testServer.base, "/api/wallets/register", { name: "Plot", kind: "group" }, groupToken);
    await post(testServer.base, "/api/wallets/register", { name: "Amina", kind: "user" }, userToken);

    const added = await post(
      testServer.base,
      "/api/memberships",
      { group_address: VALID_CODE, member_address: USER_ADDRESS },
      groupToken,
    );
    expect(added.status).toBe(201);
    expect((await added.json()) as unknown).toMatchObject({
      membership: { user_address: USER_ADDRESS, chama_address: VALID_CODE },
    });

    const personHome = await get(testServer.base, "/api/memberships", userToken);
    expect(await personHome.json()).toMatchObject({
      identity: { address: USER_ADDRESS, name: "Amina", kind: "user" },
      members: [],
      chamas: [{ address: VALID_CODE, name: "Plot", kind: "group" }],
    });

    const groupHome = await get(testServer.base, "/api/memberships", groupToken);
    expect(await groupHome.json()).toMatchObject({
      identity: { address: VALID_CODE, name: "Plot", kind: "group" },
      members: [{ address: USER_ADDRESS, name: "Amina", kind: "user" }],
      chamas: [],
    });
  });

  it("refuses a non-group who tries to add a member", async () => {
    testServer = await startServer(undefined, undefined, bookChainWithParty(USER_ADDRESS));
    const userToken = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    const response = await post(
      testServer.base,
      "/api/memberships",
      { group_address: VALID_CODE, member_address: USER_ADDRESS },
      userToken,
    );
    expect(response.status).toBe(401);
  });

  it("refuses to add a member who has not transacted with the group", async () => {
    testServer = await startServer();
    const groupToken = await tokenFor(testServer.base, VALID_CODE, GROUP_PRIV);
    const userToken = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    await post(testServer.base, "/api/wallets/register", { name: "Plot", kind: "group" }, groupToken);
    await post(testServer.base, "/api/wallets/register", { name: "Amina", kind: "user" }, userToken);
    const response = await post(
      testServer.base,
      "/api/memberships",
      { group_address: VALID_CODE, member_address: USER_ADDRESS },
      groupToken,
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      "This wallet hasn't paid into the chama.",
    );
  });

  it("refuses to add a member who is not registered in the app", async () => {
    testServer = await startServer(undefined, undefined, bookChainWithParty(USER_ADDRESS));
    const groupToken = await tokenFor(testServer.base, VALID_CODE, GROUP_PRIV);
    await post(testServer.base, "/api/wallets/register", { name: "Plot", kind: "group" }, groupToken);
    const response = await post(
      testServer.base,
      "/api/memberships",
      { group_address: VALID_CODE, member_address: USER_ADDRESS },
      groupToken,
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      "Only registered members can join. Ask them to name their wallet in the app first.",
    );
  });

  it("refuses to add a member when the group is not registered", async () => {
    testServer = await startServer(undefined, undefined, bookChainWithParty(USER_ADDRESS));
    const groupToken = await tokenFor(testServer.base, VALID_CODE, GROUP_PRIV);
    const response = await post(
      testServer.base,
      "/api/memberships",
      { group_address: VALID_CODE, member_address: USER_ADDRESS },
      groupToken,
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      "This isn't a registered group.",
    );
  });

  it("registers a wallet through the API for the authenticated address", async () => {
    testServer = await startServer();
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    const response = await post(testServer.base, "/api/wallets/register", { name: "Amina", kind: "user" }, token);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { wallet: { address: string; name: string; kind: string } };
    expect(body.wallet).toMatchObject({ address: USER_ADDRESS, name: "Amina", kind: "user" });
  });

  it("rejects a second registration of the same wallet with a conflict", async () => {
    testServer = await startServer();
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    await post(testServer.base, "/api/wallets/register", { name: "Amina", kind: "user" }, token);
    const response = await post(testServer.base, "/api/wallets/register", { name: "Bob", kind: "group" }, token);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe("conflict");
  });

  it("resolves registered names in bulk and omits the unknown", async () => {
    testServer = await startServer();
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    await post(testServer.base, "/api/wallets/register", { name: "Amina", kind: "user" }, token);

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
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    const response = await get(testServer.base, "/api/chamas/not-a-code/book", token);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("invalid");
  });

  it("refuses an unregistered group code on the book with the exact copy", async () => {
    testServer = await startServer();
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    const response = await get(testServer.base, `/api/chamas/${encodeURIComponent(VALID_CODE)}/book`, token);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { kind: "invalid", message: "This isn't a registered group." },
    });
  });

  it("refuses a registered user wallet as a chama on the book", async () => {
    testServer = await startServer();
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    await post(testServer.base, "/api/wallets/register", { name: "Amina", kind: "user" }, token);
    const response = await get(testServer.base, `/api/chamas/${encodeURIComponent(VALID_CODE)}/book`, token);
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      "This isn't a registered group.",
    );
  });

  it("reads the book from the chain for a registered group and enriches it", async () => {
    testServer = await startServer();
    const groupToken = await tokenFor(testServer.base, VALID_CODE, GROUP_PRIV);
    await post(testServer.base, "/api/wallets/register", { name: "Plot", kind: "group" }, groupToken);
    const response = await get(testServer.base, `/api/chamas/${encodeURIComponent(VALID_CODE)}/book`, groupToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      balance_sompi: "12500000000",
      rows: [],
      group: { address: VALID_CODE, name: "Plot", kind: "group" },
    });
  });

  it("refuses a non-member with the member-only copy", async () => {
    testServer = await startServer();
    const groupToken = await tokenFor(testServer.base, VALID_CODE, GROUP_PRIV);
    const userToken = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    await post(testServer.base, "/api/wallets/register", { name: "Plot", kind: "group" }, groupToken);
    await post(testServer.base, "/api/wallets/register", { name: "Amina", kind: "user" }, userToken);
    const response = await get(testServer.base, `/api/chamas/${encodeURIComponent(VALID_CODE)}/book`, userToken);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { kind: "policy", message: "Only members can see this chama." },
    });
  });

  it("lets a member read the book with membership marked on the rows", async () => {
    testServer = await startServer(undefined, undefined, bookChainWithParty(USER_ADDRESS));
    const groupToken = await tokenFor(testServer.base, VALID_CODE, GROUP_PRIV);
    const userToken = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    await post(testServer.base, "/api/wallets/register", { name: "Plot", kind: "group" }, groupToken);
    await post(testServer.base, "/api/wallets/register", { name: "Amina", kind: "user" }, userToken);
    await post(
      testServer.base,
      "/api/memberships",
      { group_address: VALID_CODE, member_address: USER_ADDRESS },
      groupToken,
    );

    const response = await get(testServer.base, `/api/chamas/${encodeURIComponent(VALID_CODE)}/book`, userToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rows: Array<{ other_address: string; other_is_member: boolean }> };
    expect(body.rows[0]).toMatchObject({
      other_address: USER_ADDRESS,
      other_is_member: true,
    });
  });

  it("rejects a payment prepare with missing fields", async () => {
    testServer = await startServer();
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    const response = await post(testServer.base, "/api/payments/prepare", {}, token);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe("invalid");
  });

  it("rejects an unaffordable payment as a policy error", async () => {
    testServer = await startServer();
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    await post(testServer.base, "/api/wallets/register", { name: "Amina", kind: "user" }, token);
    const response = await post(
      testServer.base,
      "/api/payments/prepare",
      { chama_address: VALID_CODE, amount_sompi: "100000000" },
      token,
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe("policy");
  });

  it("rejects a payment from an unregistered user", async () => {
    testServer = await startServer();
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    const response = await post(
      testServer.base,
      "/api/payments/prepare",
      { chama_address: VALID_CODE, amount_sompi: "100000000" },
      token,
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      "Name your wallet in the app before you can pay.",
    );
  });

  it("rejects a payment finalize without a signed transaction", async () => {
    testServer = await startServer();
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    const response = await post(testServer.base, "/api/payments/finalize", {}, token);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe("invalid");
  });

  it("records a finalized payment that is accepted on chain", async () => {
    const chain = paymentChainStub();
    testServer = await startServer(chain);
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    const response = await post(testServer.base, "/api/payments/finalize", { signed: validSignedTx() }, token);
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
    const token = await tokenFor(testServer.base, USER_ADDRESS, USER_PRIV);
    const response = await post(testServer.base, "/api/payments/finalize", { signed: validSignedTx() }, token);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      status: "pending",
      txid: "dd".repeat(32),
      explorer_url: `https://explorer.kaspa.org/tn10/txs/${"dd".repeat(32)}`,
    });
  });
});
