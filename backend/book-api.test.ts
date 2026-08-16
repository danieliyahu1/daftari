import { describe, expect, it, vi } from "vitest";
import { getNetworkConfig } from "../shared/network";
import type { Book, BookRow, Wallet, WalletKind } from "../shared/types";
import type { TxModel } from "./kaspa-api-types";
import {
  bookRowsForPage,
  deriveBookRow,
  deriveDirection,
  handleGetBook,
  selectOtherParty,
  UNREGISTERED_GROUP_COPY,
} from "./book-api";
import type { BookChain, BookWalletResolver } from "./book-api";
import { UpstreamError } from "./kaspa-client";

const GROUP = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";
const ALICE = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const BOB = "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhqrxplya";
const INVALID_CODE = "kaspatest:not-an-address";

const NETWORK = getNetworkConfig();

interface TxOpts {
  txid?: string;
  block_time?: number;
  is_accepted?: boolean;
  inputs?: Array<{ address?: string; amount?: number; resolved?: boolean }>;
  outputs?: Array<{ address?: string; amount?: number }>;
}

function tx(opts: TxOpts = {}): TxModel {
  const txid = opts.txid ?? "a".repeat(64);
  return {
    subnetwork_id: "0".repeat(64),
    transaction_id: txid,
    hash: txid,
    mass: "100",
    payload: "",
    block_hash: [],
    block_time: opts.block_time ?? 0,
    version: 0,
    is_accepted: opts.is_accepted ?? true,
    accepting_block_hash: "",
    accepting_block_blue_score: 0,
    accepting_block_time: 0,
    inputs: (opts.inputs ?? []).map((input) => ({
      transaction_id: txid,
      index: 0,
      previous_outpoint_hash: "0".repeat(64),
      previous_outpoint_index: "0",
      signature_script: "",
      sig_op_count: "1",
      ...(input.resolved
        ? {
            previous_outpoint_resolved: {
              transaction_id: txid,
              index: 0,
              amount: input.amount ?? 0,
              script_public_key: "20..",
              script_public_key_address: input.address,
            },
          }
        : input.address !== undefined && input.address !== null
          ? {
              previous_outpoint_address: input.address,
              previous_outpoint_amount: input.amount,
            }
          : {}),
    })),
    outputs: (opts.outputs ?? []).map((output, index) => ({
      transaction_id: txid,
      index,
      amount: output.amount ?? 0,
      script_public_key: "20..",
      ...(output.address !== undefined && output.address !== null
        ? { script_public_key_address: output.address }
        : {}),
    })),
  };
}

function makeChain(overrides: Partial<BookChain> = {}): {
  chain: BookChain;
  getBalance: ReturnType<typeof vi.fn>;
  getFullTransactions: ReturnType<typeof vi.fn>;
} {
  const getBalance = vi.fn(async () => ({ address: GROUP, balance: 1_000_000_000 }));
  const getFullTransactions = vi.fn(async (): Promise<TxModel[]> => []);
  const chain: BookChain = { getBalance, getFullTransactions };
  return {
    chain: { ...chain, ...overrides },
    getBalance,
    getFullTransactions,
  };
}

function makeWallets(
  registered: Array<{ address: string; name: string; kind: WalletKind; created_at?: number }> = [],
): BookWalletResolver {
  const byAddress = new Map(
    registered.map((wallet) => [
      wallet.address,
      {
        address: wallet.address,
        name: wallet.name,
        kind: wallet.kind,
        created_at: wallet.created_at ?? 0,
      },
    ]),
  );
  return {
    get: (address) => byAddress.get(address) ?? null,
    resolveMany: (addresses) =>
      addresses
        .map((address) => byAddress.get(address))
        .filter((wallet): wallet is Wallet => wallet !== undefined),
  };
}

const GROUP_WALLET: Wallet = { address: GROUP, name: "Plot", kind: "group", created_at: 0 };
const ALICE_WALLET: Wallet = { address: ALICE, name: "Amina", kind: "user", created_at: 0 };
const BOB_WALLET: Wallet = { address: BOB, name: "Kamau Traders", kind: "group", created_at: 0 };

describe("deriveDirection", () => {
  it("is in when the group address is among the outputs", () => {
    const t = tx({
      inputs: [{ address: ALICE, amount: 100 }],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(deriveDirection(GROUP, t)).toBe("in");
  });

  it("is out when the group address is among the inputs", () => {
    const t = tx({
      inputs: [{ address: GROUP, amount: 100 }],
      outputs: [{ address: ALICE, amount: 100 }],
    });
    expect(deriveDirection(GROUP, t)).toBe("out");
  });

  it("prefers in when the group is on both sides", () => {
    const t = tx({
      inputs: [{ address: GROUP, amount: 100 }],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(deriveDirection(GROUP, t)).toBe("in");
  });

  it("is null when the group address does not appear", () => {
    const t = tx({
      inputs: [{ address: ALICE, amount: 100 }],
      outputs: [{ address: BOB, amount: 100 }],
    });
    expect(deriveDirection(GROUP, t)).toBeNull();
  });
});

describe("selectOtherParty", () => {
  it("picks the sender for money coming in", () => {
    const t = tx({
      inputs: [
        { address: ALICE, amount: 80 },
        { address: BOB, amount: 20 },
      ],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(selectOtherParty(GROUP, t, "in")).toBe(ALICE);
  });

  it("picks the receiver for money going out", () => {
    const t = tx({
      inputs: [{ address: GROUP, amount: 100 }],
      outputs: [
        { address: ALICE, amount: 80 },
        { address: BOB, amount: 20 },
      ],
    });
    expect(selectOtherParty(GROUP, t, "out")).toBe(ALICE);
  });

  it("skips the group itself when choosing the counterparty", () => {
    const t = tx({
      inputs: [
        { address: GROUP, amount: 50 },
        { address: BOB, amount: 50 },
      ],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(selectOtherParty(GROUP, t, "in")).toBe(BOB);
  });

  it("reads the counterparty from the resolved input output when the address is not inline", () => {
    const t = tx({
      inputs: [{ address: ALICE, amount: 100, resolved: true }],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(selectOtherParty(GROUP, t, "in")).toBe(ALICE);
  });

  it("returns null when there is no other party", () => {
    const t = tx({
      inputs: [],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(selectOtherParty(GROUP, t, "in")).toBeNull();
  });
});

describe("deriveBookRow", () => {
  it("formats an incoming row with the group-facing amount", () => {
    const t = tx({
      txid: "c".repeat(64),
      block_time: 1_720_000_000,
      inputs: [{ address: ALICE, amount: 100 }],
      outputs: [
        { address: GROUP, amount: 90 },
        { address: ALICE, amount: 10 },
      ],
    });
    const row = deriveBookRow(GROUP, t, NETWORK);
    expect(row).toEqual<BookRow>({
      direction: "in",
      amount_sompi: "90",
      other_address: ALICE,
      date: 1_720_000_000,
      txid: "c".repeat(64),
      proof_url: `https://explorer-tn10.kaspa.org/txs/${"c".repeat(64)}`,
    });
  });

  it("sums every group output on an incoming row", () => {
    const t = tx({
      inputs: [{ address: ALICE, amount: 100 }],
      outputs: [
        { address: GROUP, amount: 60 },
        { address: GROUP, amount: 40 },
      ],
    });
    const row = deriveBookRow(GROUP, t, NETWORK);
    expect(row?.amount_sompi).toBe("100");
  });

  it("sums every group input on an outgoing row", () => {
    const t = tx({
      inputs: [
        { address: GROUP, amount: 60 },
        { address: GROUP, amount: 40 },
      ],
      outputs: [{ address: ALICE, amount: 100 }],
    });
    const row = deriveBookRow(GROUP, t, NETWORK);
    expect(row?.amount_sompi).toBe("100");
  });

  it("returns null when the group does not appear", () => {
    const t = tx({
      inputs: [{ address: ALICE, amount: 100 }],
      outputs: [{ address: BOB, amount: 100 }],
    });
    expect(deriveBookRow(GROUP, t, NETWORK)).toBeNull();
  });

  it("returns null when no counterparty can be identified", () => {
    const t = tx({
      inputs: [],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(deriveBookRow(GROUP, t, NETWORK)).toBeNull();
  });

  it("returns null when the group-facing amount is unknowable", () => {
    const t = tx({
      inputs: [{ address: GROUP }],
      outputs: [{ address: ALICE, amount: 100 }],
    });
    expect(deriveBookRow(GROUP, t, NETWORK)).toBeNull();
  });
});

describe("bookRowsForPage", () => {
  it("keeps only accepted rows and sorts newest first by block_time", () => {
    const older = tx({ txid: "a".repeat(64), block_time: 100, is_accepted: true, inputs: [{ address: ALICE, amount: 10 }], outputs: [{ address: GROUP, amount: 10 }] });
    const rejected = tx({ txid: "b".repeat(64), block_time: 200, is_accepted: false, inputs: [{ address: BOB, amount: 20 }], outputs: [{ address: GROUP, amount: 20 }] });
    const newest = tx({ txid: "c".repeat(64), block_time: 300, is_accepted: true, inputs: [{ address: BOB, amount: 30 }], outputs: [{ address: GROUP, amount: 30 }] });

    const rows = bookRowsForPage(GROUP, [older, rejected, newest], NETWORK);

    expect(rows.map((row) => row.txid)).toEqual(["c".repeat(64), "a".repeat(64)]);
  });

  it("breaks block_time ties by txid for determinism", () => {
    const t1 = tx({ txid: "b".repeat(64), block_time: 100, inputs: [{ address: ALICE, amount: 1 }], outputs: [{ address: GROUP, amount: 1 }] });
    const t2 = tx({ txid: "a".repeat(64), block_time: 100, inputs: [{ address: BOB, amount: 1 }], outputs: [{ address: GROUP, amount: 1 }] });

    const rows = bookRowsForPage(GROUP, [t1, t2], NETWORK);

    expect(rows.map((row) => row.txid)).toEqual(["a".repeat(64), "b".repeat(64)]);
  });

  it("never invents a row when the chain does not support it", () => {
    const unsupported = tx({ txid: "d".repeat(64), is_accepted: true, inputs: [], outputs: [{ address: GROUP, amount: 5 }] });
    const rows = bookRowsForPage(GROUP, [unsupported], NETWORK);
    expect(rows).toEqual([]);
  });
});

describe("handleGetBook", () => {
  it("returns balance, the group, and empty rows for an empty book", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]));
    expect(result.status).toBe(200);
    expect(result.body).toEqual<Book>({
      balance_sompi: "1000000000",
      rows: [],
      group: { address: GROUP, name: "Plot", kind: "group" },
    });
  });

  it("paginates with default limit and offset", async () => {
    const { chain, getFullTransactions } = makeChain();
    await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]));
    expect(getFullTransactions).toHaveBeenCalledWith(GROUP, { limit: 50, offset: 0 });
  });

  it("honours custom limit and offset", async () => {
    const { chain, getFullTransactions } = makeChain();
    await handleGetBook(GROUP, { limit: 20, offset: 40 }, chain, makeWallets([GROUP_WALLET]));
    expect(getFullTransactions).toHaveBeenCalledWith(GROUP, { limit: 20, offset: 40 });
  });

  it("returns the formatted rows from the chain page", async () => {
    const { chain } = makeChain({
      getFullTransactions: vi.fn(async () => [
        tx({
          txid: "c".repeat(64),
          block_time: 300,
          inputs: [{ address: ALICE, amount: 30 }],
          outputs: [{ address: GROUP, amount: 30 }],
        }),
      ]),
    });
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      balance_sompi: "1000000000",
      rows: [
        {
          direction: "in",
          amount_sompi: "30",
          other_address: ALICE,
          date: 300,
          txid: "c".repeat(64),
          proof_url: `https://explorer-tn10.kaspa.org/txs/${"c".repeat(64)}`,
        },
      ],
      group: { address: GROUP, name: "Plot", kind: "group" },
    });
  });

  it("enriches rows with the registered counterparty's name and kind", async () => {
    const { chain } = makeChain({
      getFullTransactions: vi.fn(async () => [
        tx({
          txid: "c".repeat(64),
          block_time: 300,
          inputs: [
            { address: ALICE, amount: 30 },
            { address: BOB, amount: 70 },
          ],
          outputs: [{ address: GROUP, amount: 100 }],
        }),
      ]),
    });
    const result = await handleGetBook(
      GROUP,
      {},
      chain,
      makeWallets([GROUP_WALLET, ALICE_WALLET, BOB_WALLET]),
    );
    expect(result.status).toBe(200);
    const [row] = (result.body as Book).rows;
    expect(row).toMatchObject({
      other_address: ALICE,
      other_name: "Amina",
      other_kind: "user",
    });
  });

  it("leaves unregistered counterparties as their address", async () => {
    const { chain } = makeChain({
      getFullTransactions: vi.fn(async () => [
        tx({
          txid: "c".repeat(64),
          block_time: 300,
          inputs: [{ address: ALICE, amount: 30 }],
          outputs: [{ address: GROUP, amount: 30 }],
        }),
      ]),
    });
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]));
    expect(result.status).toBe(200);
    const [row] = (result.body as Book).rows;
    expect(row).not.toHaveProperty("other_name");
    expect(row).not.toHaveProperty("other_kind");
    expect(row?.other_address).toBe(ALICE);
  });

  it("fetches balance and transactions together", async () => {
    const { chain, getBalance, getFullTransactions } = makeChain();
    await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]));
    expect(getBalance).toHaveBeenCalledWith(GROUP);
    expect(getFullTransactions).toHaveBeenCalled();
  });

  it("returns 400 when the code is missing", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(undefined, {}, chain, makeWallets([GROUP_WALLET]));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns 422 invalid for an invalid code", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(INVALID_CODE, {}, chain, makeWallets([GROUP_WALLET]));
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns 422 validation for a non-positive limit or negative offset", async () => {
    const { chain } = makeChain();
    const wallets = makeWallets([GROUP_WALLET]);
    expect((await handleGetBook(GROUP, { limit: 0 }, chain, wallets)).status).toBe(422);
    expect((await handleGetBook(GROUP, { limit: -1 }, chain, wallets)).status).toBe(422);
    expect((await handleGetBook(GROUP, { offset: -1 }, chain, wallets)).status).toBe(422);
  });

  it("refuses a code that is not a registered group with the exact copy", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([]));
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: UNREGISTERED_GROUP_COPY },
    });
  });

  it("refuses a registered user wallet the same way", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(
      GROUP,
      {},
      chain,
      makeWallets([{ address: GROUP, name: "Amina", kind: "user" }]),
    );
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: UNREGISTERED_GROUP_COPY },
    });
  });

  it("does not touch the chain when the code is not a registered group", async () => {
    const { chain, getBalance, getFullTransactions } = makeChain();
    await handleGetBook(GROUP, {}, chain, makeWallets([]));
    expect(getBalance).not.toHaveBeenCalled();
    expect(getFullTransactions).not.toHaveBeenCalled();
  });

  it("maps an upstream rejection to a structured error", async () => {
    const { chain } = makeChain({
      getBalance: vi.fn(async () => {
        throw new UpstreamError("upstream down", 503, "unavailable", { error: "busy" });
      }),
    });
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]));
    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      error: { kind: "upstream", source: "unavailable", message: "busy" },
    });
  });
});
