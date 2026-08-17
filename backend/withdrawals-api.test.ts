import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FeeEstimateResponse,
  SubmitTransactionResponse,
  SubmitTxModel,
  TxModel,
  UtxoResponse,
} from "./kaspa-api-types";
import { SqliteMembershipStore } from "./membership-store";
import type { MembershipStore } from "./membership-store";
import { SqliteWalletStore } from "./wallet-store";
import type { WalletStore } from "./wallet-store";
import { buildTransfer } from "./tx-builder";
import {
  handleFinalizeWithdrawal,
  handlePrepareWithdrawal,
  NOT_A_GROUP_COPY,
  ONLY_MEMBER_RECIPIENT_COPY,
} from "./withdrawals-api";
import type { PaymentChain } from "./payments-api";

const FUND = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";
const MEMBER = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const OTHER = "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhqrxplya";
const MAINNET_CODE =
  "kaspa:qp0l70zd5x85ttwd6jv7g3s3a8llzj96d8dncn4zmhv4tlzx5k2jyqh70xmfj";

const FUND_SCRIPT =
  "2098128e28322ae663f5aff740dfac52054124ca6e7c0001cd8de5f1d2235c27a7ac";
const MEMBER_SCRIPT =
  "20c526ba87b87d4db186d74143da44444d2b782b7d8eb307ff2c0cde8c85986676ac";

const FEE: FeeEstimateResponse = {
  priorityBucket: { feerate: 100, estimatedSeconds: 5 },
  normalBuckets: [{ feerate: 50, estimatedSeconds: 10 }],
  lowBuckets: [{ feerate: 10, estimatedSeconds: 60 }],
};

const SIG = "01".repeat(32);
const PARENT_TXID = "a".repeat(64);
const NEW_TXID = "b".repeat(64);
const AMOUNT = "500000000";

const stores: MembershipStore[] = [];
const wallets: WalletStore[] = [];

function membershipStore(entries: Array<[string, string]> = []): MembershipStore {
  const s = new SqliteMembershipStore({ now: () => 1_000 });
  stores.push(s);
  for (const [chama, member] of entries) s.addMember(chama, member);
  return s;
}

function walletStore(registered: Array<{ address: string; name: string; kind: "user" | "group" }> = []): WalletStore {
  const w = new SqliteWalletStore({ now: () => 1_000 });
  wallets.push(w);
  for (const entry of registered) w.register(entry.address, entry.name, entry.kind);
  return w;
}

afterEach(() => {
  for (const s of stores) s.close();
  for (const w of wallets) w.close();
  stores.length = 0;
  wallets.length = 0;
});

function utxo(
  transactionId: string,
  index: number,
  amount: string,
  scriptPublicKey = FUND_SCRIPT,
): UtxoResponse {
  return {
    outpoint: { transactionId, index },
    utxoEntry: {
      amount,
      scriptPublicKey: { scriptPublicKey },
      blockDaaScore: "1",
      isCoinbase: false,
    },
  };
}

// A parent tx whose output at `index` belongs to `address`.
function parentTx(amount: number, address: string, index = 0): TxModel {
  return {
    subnetwork_id: "0".repeat(64),
    transaction_id: PARENT_TXID,
    hash: PARENT_TXID,
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
        transaction_id: PARENT_TXID,
        index,
        amount,
        script_public_key: FUND_SCRIPT,
        script_public_key_address: address,
      },
    ],
  };
}

function signedTx(opts: {
  inputs?: Array<{ transactionId?: string; index?: number }>;
  outputs?: Array<{ value?: string; scriptPublicKey?: string }>;
} = {}): string {
  return JSON.stringify({
    id: "0".repeat(64),
    version: 0,
    inputs: (opts.inputs ?? [{ transactionId: PARENT_TXID, index: 0 }]).map((i) => ({
      transactionId: i.transactionId ?? PARENT_TXID,
      index: i.index ?? 0,
      sequence: "0",
      sigOpCount: 1,
      computeBudget: 0,
      signatureScript: SIG,
      utxo: {
        amount: "0",
        scriptPublicKey: `0000${FUND_SCRIPT}`,
        blockDaaScore: "0",
        isCoinbase: false,
      },
    })),
    outputs: (opts.outputs ?? [{ value: AMOUNT, scriptPublicKey: `0000${MEMBER_SCRIPT}` }]).map((o) => ({
      value: o.value ?? AMOUNT,
      scriptPublicKey: o.scriptPublicKey ?? `0000${MEMBER_SCRIPT}`,
      covenant: null,
    })),
    subnetworkId: "0".repeat(40),
    lockTime: "0",
    gas: "0",
    storageMass: "20000",
    payload: "",
  });
}

function makeChain(overrides: Partial<PaymentChain> = {}): {
  chain: PaymentChain;
  getUtxos: ReturnType<typeof vi.fn>;
  getTransaction: ReturnType<typeof vi.fn>;
  getFeeEstimate: ReturnType<typeof vi.fn>;
  broadcastTransaction: ReturnType<typeof vi.fn>;
} {
  const getUtxos = vi.fn(async (): Promise<UtxoResponse[]> => []);
  const getTransaction = vi.fn(async (): Promise<TxModel> => parentTx(1_000_000_000, FUND));
  const getFeeEstimate = vi.fn(async (): Promise<FeeEstimateResponse> => FEE);
  const broadcastTransaction = vi.fn(
    async (): Promise<SubmitTransactionResponse> => ({ transactionId: NEW_TXID }),
  );
  const chain: PaymentChain = {
    getUtxos,
    getTransaction,
    getFeeEstimate,
    broadcastTransaction,
  };
  return {
    chain: { ...chain, ...overrides },
    getUtxos,
    getTransaction,
    getFeeEstimate,
    broadcastTransaction,
  };
}

function defaultStores(): { store: MembershipStore; wallets: WalletStore } {
  return {
    store: membershipStore([[FUND, MEMBER]]),
    wallets: walletStore([{ address: FUND, name: "Plot", kind: "group" }]),
  };
}

function prepareInput(overrides: {
  fund_address?: unknown;
  recipient_address?: unknown;
  amount_sompi?: unknown;
} = {}) {
  return {
    fund_address: FUND,
    recipient_address: MEMBER,
    amount_sompi: AMOUNT,
    ...overrides,
  };
}

function finalizeInput(overrides: {
  fund_address?: unknown;
  recipient_address?: unknown;
  amount_sompi?: unknown;
  signed?: unknown;
} = {}) {
  return {
    fund_address: FUND,
    recipient_address: MEMBER,
    amount_sompi: AMOUNT,
    signed: signedTx(),
    ...overrides,
  };
}

describe("handlePrepareWithdrawal", () => {
  it("returns 400 when fund_address is missing", async () => {
    const { store, wallets } = defaultStores();
    const { chain } = makeChain();
    const result = await handlePrepareWithdrawal(
      store,
      wallets,
      prepareInput({ fund_address: undefined }),
      chain,
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns 400 when recipient_address is missing", async () => {
    const { store, wallets } = defaultStores();
    const { chain } = makeChain();
    const result = await handlePrepareWithdrawal(
      store,
      wallets,
      prepareInput({ recipient_address: undefined }),
      chain,
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns 422 validation for an address on another network", async () => {
    const { store, wallets } = defaultStores();
    const { chain } = makeChain();
    const result = await handlePrepareWithdrawal(
      store,
      wallets,
      prepareInput({ recipient_address: MAINNET_CODE }),
      chain,
    );
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns 422 validation for zero, negative, and non-numeric amounts", async () => {
    const { store, wallets } = defaultStores();
    const { chain } = makeChain();
    for (const amount_sompi of ["0", "-1", "abc", "1.5"]) {
      const result = await handlePrepareWithdrawal(
        store,
        wallets,
        prepareInput({ amount_sompi }),
        chain,
      );
      expect(result.status).toBe(422);
      expect(result.body).toMatchObject({ error: { kind: "invalid" } });
    }
  });

  it("refuses a fund that is not a registered group", async () => {
    const store = membershipStore();
    const wallets = walletStore();
    const { chain } = makeChain();
    const result = await handlePrepareWithdrawal(store, wallets, prepareInput(), chain);
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: NOT_A_GROUP_COPY },
    });
  });

  it("refuses a recipient who is not a member", async () => {
    const { store, wallets } = defaultStores();
    const { chain } = makeChain();
    const result = await handlePrepareWithdrawal(
      store,
      wallets,
      prepareInput({ recipient_address: OTHER }),
      chain,
    );
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "policy", message: ONLY_MEMBER_RECIPIENT_COPY },
    });
  });

  it("refuses a fund sending to itself", async () => {
    const { store, wallets } = defaultStores();
    const { chain } = makeChain();
    const result = await handlePrepareWithdrawal(
      store,
      wallets,
      prepareInput({ recipient_address: FUND }),
      chain,
    );
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("builds the template from the fund's UTXOs for a member recipient", async () => {
    const { store, wallets } = defaultStores();
    const { chain, getUtxos, getFeeEstimate } = makeChain();
    const utxos = [utxo("c", 0, "1000000000")];
    getUtxos.mockResolvedValue(utxos);

    const result = await handlePrepareWithdrawal(store, wallets, prepareInput(), chain);

    expect(result.status).toBe(200);
    expect(Object.keys(result.body as object)).toEqual(["signing_template"]);
    expect(getUtxos).toHaveBeenCalledWith(FUND);
    expect(getFeeEstimate).toHaveBeenCalled();

    const template = JSON.parse(
      (result.body as { signing_template: string }).signing_template,
    );
    const expected = buildTransfer({
      utxos,
      userAddress: FUND,
      groupAddress: MEMBER,
      amountSompi: AMOUNT,
      feerate: 50,
    }).signing_template;
    expect(template).toEqual(expected);
  });

  it("returns 422 policy when the fund cannot cover amount plus fee", async () => {
    const { store, wallets } = defaultStores();
    const { chain, getUtxos } = makeChain();
    getUtxos.mockResolvedValue([utxo("c", 0, "1000")]);
    const result = await handlePrepareWithdrawal(store, wallets, prepareInput(), chain);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "policy" } });
  });
});

describe("handleFinalizeWithdrawal", () => {
  it("returns 400 when signed is missing", async () => {
    const { store, wallets } = defaultStores();
    const { chain, broadcastTransaction } = makeChain();
    const result = await handleFinalizeWithdrawal(
      store,
      wallets,
      finalizeInput({ signed: undefined }),
      chain,
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("re-checks membership and refuses a recipient who is not a member", async () => {
    const { store, wallets } = defaultStores();
    const { chain, broadcastTransaction } = makeChain();
    const result = await handleFinalizeWithdrawal(
      store,
      wallets,
      finalizeInput({ recipient_address: OTHER }),
      chain,
    );
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "policy", message: ONLY_MEMBER_RECIPIENT_COPY },
    });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("rejects a signed transaction that spends from outside the fund", async () => {
    const { store, wallets } = defaultStores();
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockResolvedValue(parentTx(1_000_000_000, MEMBER));

    const result = await handleFinalizeWithdrawal(
      store,
      wallets,
      finalizeInput(),
      chain,
    );

    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "policy", message: "A withdrawal must spend from the fund wallet" },
    });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("rejects a signed transaction that does not pay exactly the recipient the amount", async () => {
    const { store, wallets } = defaultStores();
    const { chain, broadcastTransaction } = makeChain();
    const wrongAmount = finalizeInput({
      signed: signedTx({ outputs: [{ value: "999999999" }] }),
    });
    const result = await handleFinalizeWithdrawal(store, wallets, wrongAmount, chain);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "policy" } });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("broadcasts a valid member withdrawal and reports it recorded", async () => {
    const { store, wallets } = defaultStores();
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockImplementation(async (txid: string) => {
      if (txid === PARENT_TXID) return parentTx(1_000_000_000, FUND);
      return { ...parentTx(1_000_000_000, FUND), transaction_id: NEW_TXID, hash: NEW_TXID, is_accepted: true };
    });

    const result = await handleFinalizeWithdrawal(
      store,
      wallets,
      finalizeInput(),
      chain,
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleeper: async () => {} },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "recorded", txid: NEW_TXID });
    expect(broadcastTransaction).toHaveBeenCalledTimes(1);

    const submitted = broadcastTransaction.mock.calls[0][0] as SubmitTxModel;
    expect(submitted.inputs).toEqual([
      {
        previousOutpoint: { transactionId: PARENT_TXID, index: 0 },
        signatureScript: SIG,
        sequence: 0,
        sigOpCount: 1,
      },
    ]);
    expect(submitted.outputs).toEqual([
      { amount: 500_000_000, scriptPublicKey: { version: 0, scriptPublicKey: MEMBER_SCRIPT } },
    ]);
  });

  it("returns a pending verdict with an explorer link when acceptance is not seen", async () => {
    const { store, wallets } = defaultStores();
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockImplementation(async (txid: string) => {
      if (txid === PARENT_TXID) return parentTx(1_000_000_000, FUND);
      return { ...parentTx(1_000_000_000, FUND), transaction_id: NEW_TXID, hash: NEW_TXID, is_accepted: false };
    });

    const result = await handleFinalizeWithdrawal(
      store,
      wallets,
      finalizeInput(),
      chain,
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleeper: async () => {} },
    );

    expect(result.status).toBe(202);
    expect(result.body).toEqual({
      status: "pending",
      txid: NEW_TXID,
      explorer_url: `https://explorer-tn10.kaspa.org/txs/${NEW_TXID}`,
    });
  });

  it("returns 422 policy when the inputs cannot cover the outputs and fee", async () => {
    const { store, wallets } = defaultStores();
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockResolvedValue(parentTx(1_000, FUND));

    const result = await handleFinalizeWithdrawal(store, wallets, finalizeInput(), chain);

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "policy" } });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });
});
