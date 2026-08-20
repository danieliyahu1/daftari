import { describe, expect, it, vi } from "vitest";
import { NetworkError, UpstreamError } from "./kaspa-client";
import type {
  FeeEstimateResponse,
  SubmitTransactionResponse,
  SubmitTxModel,
  TxModel,
  UtxoResponse,
} from "./kaspa-api-types";
import {
  handleFinalizePayment,
  handlePreparePayment,
  UNREGISTERED_PAYER_COPY,
  waitForAcceptance,
} from "./payments-api";
import type { PaymentChain } from "./payments-api";
import { FakeWalletStore } from "./test-stores";
import { buildTransfer } from "./tx-builder";

const USER = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const GROUP = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";

const USER_SCRIPT =
  "20c526ba87b87d4db186d74143da44444d2b782b7d8eb307ff2c0cde8c85986676ac";
const GROUP_SCRIPT =
  "2098128e28322ae663f5aff740dfac52054124ca6e7c0001cd8de5f1d2235c27a7ac";

const FEE: FeeEstimateResponse = {
  priorityBucket: { feerate: 100, estimatedSeconds: 5 },
  normalBuckets: [{ feerate: 50, estimatedSeconds: 10 }],
  lowBuckets: [{ feerate: 10, estimatedSeconds: 60 }],
};

const SIG = "01".repeat(32);
const TXID = "a".repeat(64);

function utxo(
  transactionId: string,
  index: number,
  amount: string,
  scriptPublicKey = USER_SCRIPT,
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

function txModel(
  outputs: Array<{ index: number; amount: number }>,
): TxModel {
  return {
    subnetwork_id: "0".repeat(64),
    transaction_id: TXID,
    hash: TXID,
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
    outputs: outputs.map((o) => ({
      transaction_id: TXID,
      index: o.index,
      amount: o.amount,
      script_public_key: USER_SCRIPT,
    })),
  };
}

function signedTx(opts: {
  version?: unknown;
  inputs?: Array<{
    transactionId?: unknown;
    index?: unknown;
    sequence?: unknown;
    sigOpCount?: unknown;
    signatureScript?: unknown;
  }>;
  outputs?: Array<{ value?: unknown; scriptPublicKey?: unknown }>;
} = {}): string {
  const inputs = opts.inputs ?? [{ transactionId: TXID, index: 0 }];
  return JSON.stringify({
    id: "0".repeat(64),
    version: opts.version ?? 0,
    inputs: inputs.map((i) => ({
      transactionId: i.transactionId ?? TXID,
      index: i.index ?? 0,
      sequence: i.sequence ?? "0",
      sigOpCount: i.sigOpCount ?? 1,
      computeBudget: 0,
      signatureScript: i.signatureScript ?? SIG,
      utxo: {
        amount: "0",
        scriptPublicKey: `0000${USER_SCRIPT}`,
        blockDaaScore: "0",
        isCoinbase: false,
      },
    })),
    outputs: (opts.outputs ?? [{ value: "500000000" }]).map((o) => ({
      value: o.value ?? "500000000",
      scriptPublicKey: o.scriptPublicKey ?? `0000${GROUP_SCRIPT}`,
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
  const getTransaction = vi.fn(async (): Promise<TxModel> => txModel([]));
  const getFeeEstimate = vi.fn(async (): Promise<FeeEstimateResponse> => FEE);
  const broadcastTransaction = vi.fn(
    async (): Promise<SubmitTransactionResponse> => ({ transactionId: TXID }),
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

function prepareInput(overrides: {
  chama_address?: unknown;
  amount_sompi?: unknown;
} = {}) {
  return {
    chama_address: GROUP,
    amount_sompi: "500000000",
    ...overrides,
  };
}

describe("handlePreparePayment", () => {
  it("returns 400 when chama_address is missing", async () => {
    const { chain } = makeChain();
    const result = await handlePreparePayment(
      USER,
      prepareInput({ chama_address: undefined }),
      chain,
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns 400 when amount_sompi is missing", async () => {
    const { chain } = makeChain();
    const result = await handlePreparePayment(
      USER,
      prepareInput({ amount_sompi: undefined }),
      chain,
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns 422 validation for a malformed chama address", async () => {
    const { chain, getUtxos } = makeChain();
    const result = await handlePreparePayment(
      USER,
      prepareInput({ chama_address: "kaspatest:not-an-address" }),
      chain,
    );
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
    expect(getUtxos).not.toHaveBeenCalled();
  });

  it("returns 422 validation for zero, negative, and non-numeric amounts", async () => {
    const { chain, getUtxos } = makeChain();
    for (const amount_sompi of ["0", "-1", "abc", "1.5"]) {
      const result = await handlePreparePayment(
        USER,
        prepareInput({ amount_sompi }),
        chain,
      );
      expect(result.status).toBe(422);
      expect(result.body).toMatchObject({ error: { kind: "invalid" } });
    }
    expect(getUtxos).not.toHaveBeenCalled();
  });

  it("fetches the user's UTXOs and returns the signing template as a string", async () => {
    const { chain, getUtxos, getFeeEstimate } = makeChain();
    const utxos = [utxo("a", 0, "1000000000")];
    getUtxos.mockResolvedValue(utxos);

    const result = await handlePreparePayment(USER, prepareInput(), chain);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      signing_template: expect.any(String),
    });
    expect(getUtxos).toHaveBeenCalledWith(USER);
    expect(getFeeEstimate).toHaveBeenCalled();

    const template = JSON.parse(
      (result.body as { signing_template: string }).signing_template,
    );
    const expected = buildTransfer({
      utxos,
      userAddress: USER,
      groupAddress: GROUP,
      amountSompi: "500000000",
      feerate: 50,
    }).signing_template;
    expect(template).toEqual(expected);
  });

  it("does not echo sign_inputs or the amount", async () => {
    const { chain, getUtxos } = makeChain();
    getUtxos.mockResolvedValue([utxo("a", 0, "1000000000")]);

    const result = await handlePreparePayment(USER, prepareInput(), chain);

    expect(result.status).toBe(200);
    expect(Object.keys(result.body as object)).toEqual(["signing_template"]);
  });

  it("returns 422 policy when the user has no spendable UTXOs", async () => {
    const { chain } = makeChain();
    const result = await handlePreparePayment(USER, prepareInput(), chain);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "policy" } });
  });

  it("refuses an unregistered payer when a wallet store is provided", async () => {
    const { chain, getUtxos } = makeChain();
    const wallets = new FakeWalletStore();
    const result = await handlePreparePayment(USER, prepareInput(), chain, wallets);
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: UNREGISTERED_PAYER_COPY },
    });
    expect(getUtxos).not.toHaveBeenCalled();
    wallets.close();
  });

  it("refuses a registered group-kind payer when a wallet store is provided", async () => {
    const { chain, getUtxos } = makeChain();
    const wallets = new FakeWalletStore();
    await wallets.register(GROUP, "Plot", "group");
    const result = await handlePreparePayment(USER, prepareInput(), chain, wallets);
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: UNREGISTERED_PAYER_COPY },
    });
    expect(getUtxos).not.toHaveBeenCalled();
    wallets.close();
  });

  it("allows a registered user payer when a wallet store is provided", async () => {
    const { chain, getUtxos } = makeChain();
    getUtxos.mockResolvedValue([utxo("a", 0, "1000000000")]);
    const wallets = new FakeWalletStore();
    await wallets.register(USER, "Amina", "user");
    const result = await handlePreparePayment(USER, prepareInput(), chain, wallets);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ signing_template: expect.any(String) });
    wallets.close();
  });

  it("returns 422 policy when the UTXOs cannot cover amount plus fee", async () => {
    const { chain, getUtxos } = makeChain();
    getUtxos.mockResolvedValue([utxo("a", 0, "1000")]);
    const result = await handlePreparePayment(USER, prepareInput(), chain);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "policy" } });
  });

  it("maps an upstream rejection on the UTXO fetch", async () => {
    const { chain, getUtxos } = makeChain();
    getUtxos.mockRejectedValue(
      new UpstreamError("upstream down", 503, "unavailable", { error: "busy" }),
    );
    const result = await handlePreparePayment(USER, prepareInput(), chain);
    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      error: { kind: "upstream", source: "unavailable", message: "busy" },
    });
  });
});

describe("handleFinalizePayment", () => {
  it("returns 400 invalid when signed is missing", async () => {
    const { chain } = makeChain();
    const result = await handleFinalizePayment({ signed: undefined }, chain);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns 422 invalid for invalid JSON", async () => {
    const { chain, broadcastTransaction } = makeChain();
    const result = await handleFinalizePayment({ signed: "{nope" }, chain);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("returns 422 validation when inputs or outputs are missing", async () => {
    const { chain, broadcastTransaction } = makeChain();
    const noInputs = signedTx({ inputs: [] });
    expect((await handleFinalizePayment({ signed: noInputs }, chain)).status).toBe(422);

    const noOutputs = signedTx({ outputs: [] });
    expect((await handleFinalizePayment({ signed: noOutputs }, chain)).status).toBe(422);

    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("returns 422 validation for a malformed input or output", async () => {
    const { chain, broadcastTransaction } = makeChain();
    const badTxid = signedTx({ inputs: [{ transactionId: "zz", index: 0 }] });
    expect((await handleFinalizePayment({ signed: badTxid }, chain)).status).toBe(422);

    const badSig = signedTx({ inputs: [{ signatureScript: "nothex" }] });
    expect((await handleFinalizePayment({ signed: badSig }, chain)).status).toBe(422);

    const badValue = signedTx({ outputs: [{ value: "5.5" }] });
    expect((await handleFinalizePayment({ signed: badValue }, chain)).status).toBe(422);

    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("returns 422 validation for a non-zero signed version", async () => {
    const { chain, broadcastTransaction } = makeChain();
    const result = await handleFinalizePayment(
      { signed: signedTx({ version: 1 }) },
      chain,
    );
    expect(result.status).toBe(422);
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("returns 422 invalid for duplicate input outpoints", async () => {
    const { chain, broadcastTransaction } = makeChain();
    const dup = signedTx({
      inputs: [
        { transactionId: TXID, index: 0 },
        { transactionId: TXID, index: 0 },
      ],
    });
    const result = await handleFinalizePayment({ signed: dup }, chain);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("re-fetches each input's UTXO by outpoint and broadcasts", async () => {
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockImplementation(async (txid: string) => {
      if (txid === "a".repeat(64)) return txModel([{ index: 0, amount: 300000000 }]);
      if (txid === "b".repeat(64)) return txModel([{ index: 1, amount: 400000000 }]);
      return txModel([]);
    });

    const result = await handleFinalizePayment(
      {
        signed: signedTx({
          inputs: [
            { transactionId: "a".repeat(64), index: 0 },
            { transactionId: "b".repeat(64), index: 1 },
          ],
        }),
      },
      chain,
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "recorded", txid: TXID });
    expect(getTransaction).toHaveBeenCalledWith("a".repeat(64));
    expect(getTransaction).toHaveBeenCalledWith("b".repeat(64));
    expect(broadcastTransaction).toHaveBeenCalledTimes(1);

    const submitted = broadcastTransaction.mock.calls[0][0] as SubmitTxModel;
    expect(submitted.version).toBe(0);
    expect(submitted.inputs).toEqual([
      {
        previousOutpoint: { transactionId: "a".repeat(64), index: 0 },
        signatureScript: SIG,
        sequence: 0,
        sigOpCount: 1,
      },
      {
        previousOutpoint: { transactionId: "b".repeat(64), index: 1 },
        signatureScript: SIG,
        sequence: 0,
        sigOpCount: 1,
      },
    ]);
    expect(submitted.outputs).toEqual([
      {
        amount: 500000000,
        scriptPublicKey: { version: 0, scriptPublicKey: GROUP_SCRIPT },
      },
    ]);
    expect(submitted.subnetworkId).toBe("0".repeat(40));
  });

  it("returns 422 validation when a referenced output does not exist", async () => {
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockResolvedValue(txModel([{ index: 0, amount: 1 }]));

    const result = await handleFinalizePayment(
      { signed: signedTx({ inputs: [{ transactionId: TXID, index: 5 }] }) },
      chain,
    );

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("returns 422 policy when inputs cannot cover outputs and fee", async () => {
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockResolvedValue(txModel([{ index: 0, amount: 1000 }]));

    const result = await handleFinalizePayment(
      { signed: signedTx({ outputs: [{ value: "2000" }] }) },
      chain,
    );

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "policy" } });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("maps a conflict rejection from the node", async () => {
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockResolvedValue(txModel([{ index: 0, amount: 1000000000 }]));
    broadcastTransaction.mockRejectedValue(
      new UpstreamError("double spend", 409, "conflict", {
        error: "Transaction spends the same outpoint",
      }),
    );

    const result = await handleFinalizePayment({ signed: signedTx() }, chain);

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: {
        kind: "upstream",
        source: "conflict",
        message: "Transaction spends the same outpoint",
      },
    });
  });

  it("maps an invalid submission as an upstream bad_request", async () => {
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockResolvedValue(txModel([{ index: 0, amount: 1000000000 }]));
    broadcastTransaction.mockRejectedValue(
      new UpstreamError("invalid", 400, "bad_request", {
        error: "Transaction is invalid",
      }),
    );

    const result = await handleFinalizePayment({ signed: signedTx() }, chain);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: { kind: "upstream", source: "bad_request", message: "Transaction is invalid" },
    });
  });

  it("maps a network failure as a network error", async () => {
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockResolvedValue(txModel([{ index: 0, amount: 1000000000 }]));
    broadcastTransaction.mockRejectedValue(
      new NetworkError("connection refused"),
    );

    const result = await handleFinalizePayment({ signed: signedTx() }, chain);

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { kind: "network" } });
  });

  it("returns a recorded verdict when the tx is accepted", async () => {
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockResolvedValue({
      ...txModel([{ index: 0, amount: 1000000000 }]),
      is_accepted: true,
    });
    broadcastTransaction.mockResolvedValue({ transactionId: TXID });

    const result = await handleFinalizePayment(
      { signed: signedTx() },
      chain,
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleeper: async () => {} },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "recorded", txid: TXID });
  });

  it("returns a pending verdict with explorer link when the budget is spent", async () => {
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockResolvedValue({
      ...txModel([{ index: 0, amount: 1000000000 }]),
      is_accepted: false,
    });
    broadcastTransaction.mockResolvedValue({ transactionId: TXID });

    const result = await handleFinalizePayment(
      { signed: signedTx() },
      chain,
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleeper: async () => {} },
    );

    expect(result.status).toBe(202);
    expect(result.body).toEqual({
      status: "pending",
      txid: TXID,
    });
  });

  it("rejects the broadcast verdict as a conflict when the node declines", async () => {
    const { chain, getTransaction, broadcastTransaction } = makeChain();
    getTransaction.mockResolvedValue({
      ...txModel([{ index: 0, amount: 1000000000 }]),
      is_accepted: false,
    });
    broadcastTransaction.mockResolvedValue({ error: "double spend" });

    const result = await handleFinalizePayment(
      { signed: signedTx() },
      chain,
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleeper: async () => {} },
    );

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: { kind: "conflict" } });
  });

  it("waits out a not-yet-accepted tx and reports acceptance", async () => {
    const { chain } = makeChain();
    const calls = [
      { ...txModel([]), is_accepted: false },
      { ...txModel([]), is_accepted: false },
      { ...txModel([]), is_accepted: true },
    ];
    chain.getTransaction = vi.fn(async () => calls.shift() as TxModel);

    const accepted = await waitForAcceptance(chain, TXID, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 1,
      sleeper: async () => {},
    });

    expect(accepted).toBe(true);
    expect(chain.getTransaction).toHaveBeenCalledTimes(3);
  });

  it("treats a tx that never becomes accepted as pending after the budget", async () => {
    const { chain } = makeChain();
    chain.getTransaction = vi.fn(
      async () => ({ ...txModel([]), is_accepted: false }) as TxModel,
    );

    const accepted = await waitForAcceptance(chain, TXID, {
      maxAttempts: 4,
      baseDelayMs: 1,
      maxDelayMs: 1,
      sleeper: async () => {},
    });

    expect(accepted).toBe(false);
    expect(chain.getTransaction).toHaveBeenCalledTimes(4);
  });
});
